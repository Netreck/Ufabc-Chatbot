from sqlalchemy.ext.asyncio import AsyncEngine

from ufabc_chatbot.infrastructure.db.models import Base

# Import auth models so Base.metadata knows about them
import ufabc_chatbot.infrastructure.db.auth_models  # noqa: F401


async def init_database(engine: AsyncEngine) -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
