from uuid import UUID

from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ufabc_chatbot.application.contracts import FileFeedRepository
from ufabc_chatbot.domain.file_feed import FileFeedCreate, FileFeedRecord, FileFeedStatus
from ufabc_chatbot.infrastructure.db.models import FileFeedItemORM


class SQLAlchemyFileFeedRepository(FileFeedRepository):
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    async def create(self, payload: FileFeedCreate) -> FileFeedRecord:
        entity = FileFeedItemORM(
            id=str(payload.id),
            original_filename=payload.original_filename,
            stored_filename=payload.stored_filename,
            content_type=payload.content_type,
            size_bytes=payload.size_bytes,
            status=payload.status,
            document_metadata=payload.document_metadata.model_dump(mode="json"),
            storage_metadata=payload.storage_metadata,
        )

        async with self._session_factory() as session:
            session.add(entity)
            await session.commit()
            await session.refresh(entity)
            return self._to_domain(entity)

    async def list(
        self,
        *,
        status: FileFeedStatus | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[FileFeedRecord]:
        statement = (
            select(FileFeedItemORM)
            .order_by(FileFeedItemORM.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        if status is not None:
            statement = statement.where(FileFeedItemORM.status == status)

        async with self._session_factory() as session:
            entities = (await session.scalars(statement)).all()
            return [self._to_domain(entity) for entity in entities]

    async def get(self, file_id: UUID) -> FileFeedRecord | None:
        statement = select(FileFeedItemORM).where(FileFeedItemORM.id == str(file_id))

        async with self._session_factory() as session:
            entity = await session.scalar(statement)
            if entity is None:
                return None
            return self._to_domain(entity)

    async def update_status(
        self,
        file_id: UUID,
        status: FileFeedStatus,
    ) -> FileFeedRecord | None:
        statement = select(FileFeedItemORM).where(FileFeedItemORM.id == str(file_id))

        async with self._session_factory() as session:
            entity = await session.scalar(statement)
            if entity is None:
                return None

            entity.status = status
            await session.commit()
            await session.refresh(entity)
            return self._to_domain(entity)

    async def delete(self, file_id: UUID) -> FileFeedRecord | None:
        statement = select(FileFeedItemORM).where(FileFeedItemORM.id == str(file_id))

        async with self._session_factory() as session:
            entity = await session.scalar(statement)
            if entity is None:
                return None

            removed = self._to_domain(entity)
            await session.delete(entity)
            await session.commit()
            return removed

    async def update_stored_filename(
        self,
        file_id: UUID,
        stored_filename: str,
    ) -> FileFeedRecord | None:
        statement = select(FileFeedItemORM).where(FileFeedItemORM.id == str(file_id))

        async with self._session_factory() as session:
            entity = await session.scalar(statement)
            if entity is None:
                return None

            entity.stored_filename = stored_filename
            await session.commit()
            await session.refresh(entity)
            return self._to_domain(entity)

    async def update_original_filename(
        self,
        file_id: UUID,
        original_filename: str,
    ) -> FileFeedRecord | None:
        statement = select(FileFeedItemORM).where(FileFeedItemORM.id == str(file_id))

        async with self._session_factory() as session:
            entity = await session.scalar(statement)
            if entity is None:
                return None

            entity.original_filename = original_filename
            await session.commit()
            await session.refresh(entity)
            return self._to_domain(entity)

    async def delete_by_folder_prefix(self, folder_prefix: str) -> int:
        prefix = folder_prefix.rstrip("/") + "/"
        statement = sa_delete(FileFeedItemORM).where(
            FileFeedItemORM.stored_filename.startswith(prefix)
        )

        async with self._session_factory() as session:
            result = await session.execute(statement)
            await session.commit()
            return result.rowcount  # type: ignore[return-value]

    @staticmethod
    def _to_domain(entity: FileFeedItemORM) -> FileFeedRecord:
        return FileFeedRecord(
            id=UUID(entity.id),
            original_filename=entity.original_filename,
            stored_filename=entity.stored_filename,
            content_type=entity.content_type,
            size_bytes=entity.size_bytes,
            status=entity.status,
            document_metadata=entity.document_metadata,
            storage_metadata=entity.storage_metadata,
            created_at=entity.created_at,
        )
