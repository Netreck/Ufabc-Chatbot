"""Authentication business logic."""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from ufabc_chatbot.core.config import Settings
from ufabc_chatbot.domain.auth import UserCreate, UserRecord
from ufabc_chatbot.infrastructure.db.auth_repository import AuthRepository


class AuthError(Exception):
    pass


class AuthService:
    def __init__(self, repository: AuthRepository, settings: Settings) -> None:
        self._repo = repository
        self._settings = settings

    # ── Password hashing ──

    @staticmethod
    def hash_password(password: str) -> str:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    @staticmethod
    def verify_password(plain: str, hashed: str) -> bool:
        return bcrypt.checkpw(plain.encode(), hashed.encode())

    # ── Token helpers ──

    @staticmethod
    def _hash_token(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def create_access_token(self, user_id: str, role: str) -> str:
        now = datetime.now(timezone.utc)
        payload = {
            "sub": user_id,
            "role": role,
            "exp": now + timedelta(minutes=self._settings.access_token_expire_minutes),
            "iat": now,
            "type": "access",
        }
        return jwt.encode(payload, self._settings.jwt_secret_key, algorithm=self._settings.jwt_algorithm)

    def decode_access_token(self, token: str) -> dict:
        try:
            payload = jwt.decode(
                token,
                self._settings.jwt_secret_key,
                algorithms=[self._settings.jwt_algorithm],
            )
            if payload.get("type") != "access":
                raise AuthError("Invalid token type")
            return payload
        except JWTError as exc:
            raise AuthError(f"Invalid token: {exc}") from exc

    # ── Registration ──

    async def register(self, payload: UserCreate) -> UserRecord:
        if await self._repo.user_exists(payload.email):
            raise AuthError("Email already registered")
        password_hash = self.hash_password(payload.password)
        return await self._repo.create_user(payload, password_hash)

    # ── Login ──

    async def login(self, email: str, password: str) -> tuple[str, str, UserRecord]:
        """Returns (access_token, refresh_token_raw, user)."""
        user = await self._repo.get_user_by_email(email)
        if not user:
            raise AuthError("Invalid credentials")

        if not user.is_active:
            raise AuthError("Account is deactivated")

        stored_hash = await self._repo.get_password_hash(email)
        if not stored_hash or not self.verify_password(password, stored_hash):
            raise AuthError("Invalid credentials")

        access_token = self.create_access_token(user.id, user.role)
        refresh_token_raw = secrets.token_urlsafe(48)
        refresh_token_hash = self._hash_token(refresh_token_raw)
        expires_at = datetime.now(timezone.utc) + timedelta(days=self._settings.refresh_token_expire_days)

        await self._repo.create_refresh_token(user.id, refresh_token_hash, expires_at)

        return access_token, refresh_token_raw, user

    # ── Refresh ──

    async def refresh(self, refresh_token_raw: str) -> tuple[str, str]:
        """Returns (new_access_token, new_refresh_token_raw) with rotation."""
        token_hash = self._hash_token(refresh_token_raw)
        record = await self._repo.get_refresh_token_by_hash(token_hash)

        if not record:
            raise AuthError("Invalid refresh token")
        if record.revoked_at is not None:
            raise AuthError("Refresh token revoked")
        if record.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
            raise AuthError("Refresh token expired")

        user = await self._repo.get_user_by_id(record.user_id)
        if not user or not user.is_active:
            raise AuthError("User not found or inactive")

        # Revoke old token (rotation)
        await self._repo.revoke_refresh_token(record.id)

        # Issue new pair
        new_access = self.create_access_token(user.id, user.role)
        new_refresh_raw = secrets.token_urlsafe(48)
        new_refresh_hash = self._hash_token(new_refresh_raw)
        expires_at = datetime.now(timezone.utc) + timedelta(days=self._settings.refresh_token_expire_days)
        await self._repo.create_refresh_token(user.id, new_refresh_hash, expires_at)

        return new_access, new_refresh_raw

    # ── Logout ──

    async def logout(self, refresh_token_raw: str) -> None:
        token_hash = self._hash_token(refresh_token_raw)
        record = await self._repo.get_refresh_token_by_hash(token_hash)
        if record and record.revoked_at is None:
            await self._repo.revoke_refresh_token(record.id)

    # ── Get current user ──

    async def get_user_by_id(self, user_id: str) -> UserRecord | None:
        return await self._repo.get_user_by_id(user_id)

    # ── Seed admin ──

    async def seed_admin(self, email: str, password: str) -> None:
        if await self._repo.user_exists(email):
            return
        payload = UserCreate(email=email, password=password, role="admin")
        password_hash = self.hash_password(password)
        await self._repo.create_user(payload, password_hash)
