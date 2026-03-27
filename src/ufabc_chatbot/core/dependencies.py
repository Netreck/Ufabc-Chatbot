from functools import lru_cache
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from ufabc_chatbot.application.auth_service import AuthService
from ufabc_chatbot.application.file_feed_service import FileFeedService
from ufabc_chatbot.application.services import ChatService
from ufabc_chatbot.core.config import get_settings
from ufabc_chatbot.infrastructure.db.auth_repository import AuthRepository
from ufabc_chatbot.infrastructure.db.repository import SQLAlchemyFileFeedRepository
from ufabc_chatbot.infrastructure.llm.openai_provider import OpenAIProvider
from ufabc_chatbot.infrastructure.storage.local_feed_storage import LocalFeedStorage
from ufabc_chatbot.infrastructure.storage.seaweed_s3_storage import SeaweedS3Storage


def _prepare_sqlite_directory(database_url: str) -> None:
    prefix = "sqlite+aiosqlite:///"
    if not database_url.startswith(prefix):
        return

    sqlite_path = database_url.removeprefix(prefix)
    if sqlite_path in {"", ":memory:"}:
        return

    Path(sqlite_path).parent.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    _prepare_sqlite_directory(settings.database_url)
    return create_async_engine(settings.database_url, pool_pre_ping=True)


@lru_cache
def get_session_factory() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(bind=get_engine(), expire_on_commit=False)


@lru_cache
def get_chat_service() -> ChatService:
    settings = get_settings()
    provider = OpenAIProvider(settings)
    return ChatService(llm_provider=provider)


@lru_cache
def get_file_feed_service() -> FileFeedService:
    settings = get_settings()
    repository = SQLAlchemyFileFeedRepository(get_session_factory())

    if settings.feed_storage_backend == "seaweed":
        storage = SeaweedS3Storage(
            endpoint_url=settings.seaweed_s3_endpoint,
            access_key=settings.seaweed_s3_access_key,
            secret_key=settings.seaweed_s3_secret_key,
            bucket=settings.seaweed_s3_bucket,
            region=settings.seaweed_s3_region,
            secure=settings.seaweed_s3_secure,
            create_bucket_if_missing=settings.seaweed_s3_create_bucket_if_missing,
        )
    else:
        storage = LocalFeedStorage(settings.feed_storage_dir)

    return FileFeedService(
        repository=repository,
        storage=storage,
        max_file_size_mb=settings.max_feed_file_size_mb,
    )


@lru_cache
def get_auth_service() -> AuthService:
    settings = get_settings()
    repository = AuthRepository(get_session_factory())
    return AuthService(repository=repository, settings=settings)
