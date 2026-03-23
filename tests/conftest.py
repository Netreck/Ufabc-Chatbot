from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ufabc_chatbot.core.config import get_settings
from ufabc_chatbot.core.dependencies import (
    get_chat_service,
    get_engine,
    get_file_feed_service,
    get_session_factory,
)
from ufabc_chatbot.main import create_app


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    database_path = tmp_path / "test.sqlite3"
    feed_storage_dir = tmp_path / "feed_files"

    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{database_path}")
    monkeypatch.setenv("FEED_STORAGE_DIR", str(feed_storage_dir))
    monkeypatch.setenv("FEED_STORAGE_BACKEND", "local")
    monkeypatch.setenv("MAX_FEED_FILE_SIZE_MB", "5")

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    get_chat_service.cache_clear()
    get_file_feed_service.cache_clear()

    app = create_app()

    with TestClient(app) as test_client:
        yield test_client

    get_file_feed_service.cache_clear()
    get_chat_service.cache_clear()
    get_session_factory.cache_clear()
    get_engine.cache_clear()
    get_settings.cache_clear()
