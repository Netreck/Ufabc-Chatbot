from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ufabc_chatbot.core.auth_dependencies import get_current_user
from ufabc_chatbot.core.config import get_settings
from ufabc_chatbot.core.dependencies import get_auth_service, get_engine
from ufabc_chatbot.infrastructure.db.bootstrap import init_database
from ufabc_chatbot.presentation.api.auth_routes import router as auth_router
from ufabc_chatbot.presentation.api.file_feed_routes import router as file_feed_router
from ufabc_chatbot.presentation.api.ingestion_routes import router as ingestion_router
from ufabc_chatbot.presentation.api.routes import router as chat_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    engine = get_engine()
    await init_database(engine)

    # Seed admin user from env vars (idempotent)
    settings = get_settings()
    if settings.admin_email and settings.admin_password:
        auth_service = get_auth_service()
        await auth_service.seed_admin(settings.admin_email, settings.admin_password)

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

    # CORS for React dev server
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://localhost:3000",
            "http://localhost:8080",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["health"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    # Auth routes — public (login, refresh, logout) + protected (me, register)
    app.include_router(auth_router, prefix="/api/v1", tags=["auth"])

    # Chat — protected
    app.include_router(
        chat_router,
        prefix="/api/v1",
        tags=["chat"],
        dependencies=[Depends(get_current_user)],
    )

    # Files — protected
    app.include_router(
        file_feed_router,
        prefix="/api/v1",
        tags=["file-feed"],
        dependencies=[Depends(get_current_user)],
    )

    # Ingestion — protected
    app.include_router(
        ingestion_router,
        prefix="/api/v1",
        tags=["ingestion"],
        dependencies=[Depends(get_current_user)],
    )

    return app


app = create_app()
