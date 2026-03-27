from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = Field(default="UFABC Chatbot API", alias="APP_NAME")
    app_env: str = Field(default="dev", alias="APP_ENV")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-4o-mini", alias="OPENAI_MODEL")
    database_url: str = Field(
        default="sqlite+aiosqlite:///./data/ufabc_chatbot.db",
        alias="DATABASE_URL",
    )
    feed_storage_dir: str = Field(default="./data/feed_files", alias="FEED_STORAGE_DIR")
    feed_storage_backend: Literal["local", "seaweed"] = Field(
        default="local",
        alias="FEED_STORAGE_BACKEND",
    )
    seaweed_s3_endpoint: str = Field(
        default="http://localhost:8333",
        alias="SEAWEED_S3_ENDPOINT",
    )
    seaweed_s3_access_key: str = Field(default="admin", alias="SEAWEED_S3_ACCESS_KEY")
    seaweed_s3_secret_key: str = Field(default="key", alias="SEAWEED_S3_SECRET_KEY")
    seaweed_s3_region: str = Field(default="us-east-1", alias="SEAWEED_S3_REGION")
    seaweed_s3_bucket: str = Field(default="ufabc-feed", alias="SEAWEED_S3_BUCKET")
    seaweed_s3_secure: bool = Field(default=False, alias="SEAWEED_S3_SECURE")
    seaweed_s3_create_bucket_if_missing: bool = Field(
        default=True,
        alias="SEAWEED_S3_CREATE_BUCKET_IF_MISSING",
    )
    max_feed_file_size_mb: int = Field(default=25, alias="MAX_FEED_FILE_SIZE_MB")

    # ── Auth ──
    jwt_secret_key: str = Field(
        default="CHANGE-ME-IN-PRODUCTION-use-openssl-rand-hex-32",
        alias="JWT_SECRET_KEY",
    )
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    access_token_expire_minutes: int = Field(default=15, alias="ACCESS_TOKEN_EXPIRE_MINUTES")
    refresh_token_expire_days: int = Field(default=7, alias="REFRESH_TOKEN_EXPIRE_DAYS")
    cookie_secure: bool = Field(default=False, alias="COOKIE_SECURE")
    cookie_samesite: Literal["lax", "strict", "none"] = Field(
        default="lax", alias="COOKIE_SAMESITE"
    )
    admin_email: str | None = Field(default=None, alias="ADMIN_EMAIL")
    admin_password: str | None = Field(default=None, alias="ADMIN_PASSWORD")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
