"""Domain models for authentication."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

UserRole = Literal["admin", "editor", "viewer"]


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    role: UserRole = "viewer"


class UserRecord(BaseModel):
    id: str
    email: str
    role: UserRole
    is_active: bool
    created_at: datetime
    updated_at: datetime


class RefreshTokenRecord(BaseModel):
    id: str
    user_id: str
    token_hash: str
    expires_at: datetime
    revoked_at: datetime | None
    created_at: datetime
