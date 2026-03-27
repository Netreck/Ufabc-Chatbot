"""Repository for auth-related database operations."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ufabc_chatbot.domain.auth import RefreshTokenRecord, UserCreate, UserRecord
from ufabc_chatbot.infrastructure.db.auth_models import RefreshTokenORM, UserORM


class AuthRepository:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    # ── Users ──

    async def get_user_by_email(self, email: str) -> UserRecord | None:
        async with self._session_factory() as session:
            stmt = select(UserORM).where(UserORM.email == email.lower())
            result = await session.execute(stmt)
            user = result.scalar_one_or_none()
            return self._user_to_domain(user) if user else None

    async def get_user_by_id(self, user_id: str) -> UserRecord | None:
        async with self._session_factory() as session:
            user = await session.get(UserORM, user_id)
            return self._user_to_domain(user) if user else None

    async def get_password_hash(self, email: str) -> str | None:
        async with self._session_factory() as session:
            stmt = select(UserORM.password_hash).where(UserORM.email == email.lower())
            result = await session.execute(stmt)
            return result.scalar_one_or_none()

    async def create_user(self, payload: UserCreate, password_hash: str) -> UserRecord:
        user_id = str(uuid4())
        now = datetime.now(timezone.utc)
        entity = UserORM(
            id=user_id,
            email=payload.email.lower(),
            password_hash=password_hash,
            role=payload.role,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        async with self._session_factory() as session:
            session.add(entity)
            await session.commit()
            await session.refresh(entity)
            return self._user_to_domain(entity)

    async def user_exists(self, email: str) -> bool:
        async with self._session_factory() as session:
            stmt = select(UserORM.id).where(UserORM.email == email.lower())
            result = await session.execute(stmt)
            return result.scalar_one_or_none() is not None

    # ── Refresh Tokens ──

    async def create_refresh_token(
        self, user_id: str, token_hash: str, expires_at: datetime
    ) -> RefreshTokenRecord:
        token_id = str(uuid4())
        now = datetime.now(timezone.utc)
        entity = RefreshTokenORM(
            id=token_id,
            user_id=user_id,
            token_hash=token_hash,
            expires_at=expires_at,
            created_at=now,
        )
        async with self._session_factory() as session:
            session.add(entity)
            await session.commit()
            await session.refresh(entity)
            return self._token_to_domain(entity)

    async def get_refresh_token_by_hash(self, token_hash: str) -> RefreshTokenRecord | None:
        async with self._session_factory() as session:
            stmt = select(RefreshTokenORM).where(RefreshTokenORM.token_hash == token_hash)
            result = await session.execute(stmt)
            token = result.scalar_one_or_none()
            return self._token_to_domain(token) if token else None

    async def revoke_refresh_token(self, token_id: str) -> None:
        async with self._session_factory() as session:
            stmt = (
                update(RefreshTokenORM)
                .where(RefreshTokenORM.id == token_id)
                .values(revoked_at=datetime.now(timezone.utc))
            )
            await session.execute(stmt)
            await session.commit()

    async def revoke_all_user_tokens(self, user_id: str) -> None:
        async with self._session_factory() as session:
            stmt = (
                update(RefreshTokenORM)
                .where(
                    RefreshTokenORM.user_id == user_id,
                    RefreshTokenORM.revoked_at.is_(None),
                )
                .values(revoked_at=datetime.now(timezone.utc))
            )
            await session.execute(stmt)
            await session.commit()

    # ── Mappers ──

    @staticmethod
    def _user_to_domain(orm: UserORM) -> UserRecord:
        return UserRecord(
            id=orm.id,
            email=orm.email,
            role=orm.role,
            is_active=orm.is_active,
            created_at=orm.created_at,
            updated_at=orm.updated_at,
        )

    @staticmethod
    def _token_to_domain(orm: RefreshTokenORM) -> RefreshTokenRecord:
        return RefreshTokenRecord(
            id=orm.id,
            user_id=orm.user_id,
            token_hash=orm.token_hash,
            expires_at=orm.expires_at,
            revoked_at=orm.revoked_at,
            created_at=orm.created_at,
        )
