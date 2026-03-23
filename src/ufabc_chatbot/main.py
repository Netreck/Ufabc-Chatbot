from contextlib import asynccontextmanager

from fastapi import FastAPI

from ufabc_chatbot.core.config import get_settings
from ufabc_chatbot.core.dependencies import get_engine
from ufabc_chatbot.infrastructure.db.bootstrap import init_database
from ufabc_chatbot.presentation.api.file_feed_routes import router as file_feed_router
from ufabc_chatbot.presentation.api.routes import router as chat_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    engine = get_engine()
    await init_database(engine)
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    @app.get("/health", tags=["health"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(chat_router, prefix="/api/v1", tags=["chat"])
    app.include_router(file_feed_router, prefix="/api/v1", tags=["file-feed"])
    return app


app = create_app()
