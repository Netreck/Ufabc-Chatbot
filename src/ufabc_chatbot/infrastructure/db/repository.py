from datetime import date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ufabc_chatbot.application.contracts import FileFeedRepository
from ufabc_chatbot.domain.file_feed import (
    FileFeedCreate,
    FileFeedRecord,
    FileFeedStatus,
    RAGDocumentMetadata,
)
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

    async def update_content_metadata(
        self,
        *,
        file_id: UUID,
        size_bytes: int,
        document_metadata: RAGDocumentMetadata,
        storage_metadata: dict[str, Any],
    ) -> FileFeedRecord | None:
        statement = select(FileFeedItemORM).where(FileFeedItemORM.id == str(file_id))

        async with self._session_factory() as session:
            entity = await session.scalar(statement)
            if entity is None:
                return None

            entity.size_bytes = size_bytes
            entity.document_metadata = document_metadata.model_dump(mode="json")
            entity.storage_metadata = storage_metadata
            await session.commit()
            await session.refresh(entity)
            return self._to_domain(entity)

    async def update_storage_metadata(
        self,
        *,
        file_id: UUID,
        storage_metadata: dict[str, Any],
    ) -> FileFeedRecord | None:
        statement = select(FileFeedItemORM).where(FileFeedItemORM.id == str(file_id))

        async with self._session_factory() as session:
            entity = await session.scalar(statement)
            if entity is None:
                return None

            entity.storage_metadata = storage_metadata
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
        raw_metadata = (
            entity.document_metadata if isinstance(entity.document_metadata, dict) else {}
        )
        normalized_metadata = SQLAlchemyFileFeedRepository._normalize_document_metadata(
            raw_metadata
        )
        return FileFeedRecord(
            id=UUID(entity.id),
            original_filename=entity.original_filename,
            stored_filename=entity.stored_filename,
            content_type=entity.content_type,
            size_bytes=entity.size_bytes,
            status=entity.status,
            document_metadata=normalized_metadata,
            storage_metadata=entity.storage_metadata,
            created_at=entity.created_at,
        )

    @staticmethod
    def _normalize_date_string(raw_value: object, fallback_iso: str) -> str:
        if isinstance(raw_value, date):
            return raw_value.isoformat()
        if isinstance(raw_value, datetime):
            return raw_value.date().isoformat()
        if not isinstance(raw_value, str):
            return fallback_iso

        cleaned = (
            raw_value.strip()
            .replace("\u2011", "-")
            .replace("\u2013", "-")
            .replace("\u2014", "-")
            .replace("\u2212", "-")
        )
        if not cleaned:
            return fallback_iso

        try:
            return date.fromisoformat(cleaned).isoformat()
        except ValueError:
            pass

        try:
            return datetime.strptime(cleaned, "%d/%m/%Y").date().isoformat()
        except ValueError:
            return fallback_iso

    @staticmethod
    def _normalize_document_metadata(metadata: dict) -> dict:
        today_iso = date.today().isoformat()

        titulo = str(metadata.get("titulo") or "Documento UFABC").strip() or "Documento UFABC"
        raw_versao = metadata.get("versao", 1)
        try:
            versao = max(1, int(float(str(raw_versao).strip().replace(",", "."))))
        except (TypeError, ValueError):
            versao = 1

        tags = metadata.get("tags")
        normalized_tags = []
        if isinstance(tags, list):
            normalized_tags = [str(tag).strip() for tag in tags if str(tag).strip()]
        if not normalized_tags:
            normalized_tags = ["ufabc"]

        palavras_chave = metadata.get("palavras_chave")
        normalized_keywords = []
        if isinstance(palavras_chave, list):
            normalized_keywords = [str(item).strip() for item in palavras_chave if str(item).strip()]
        if not normalized_keywords:
            normalized_keywords = normalized_tags[:]

        relacionados = metadata.get("relacionados")
        normalized_relacionados = []
        if isinstance(relacionados, list):
            normalized_relacionados = [str(item).strip() for item in relacionados if str(item).strip()]

        return {
            "id": str(metadata.get("id") or "legacy-documento").strip() or "legacy-documento",
            "titulo": titulo,
            "resumo": str(metadata.get("resumo") or f"Documento legado: {titulo}").strip()
            or f"Documento legado: {titulo}",
            "tipo": str(metadata.get("tipo") or "informativo").strip() or "informativo",
            "dominio": str(metadata.get("dominio") or "institucional").strip() or "institucional",
            "subdominio": str(metadata.get("subdominio") or "geral").strip() or "geral",
            "intencao": str(metadata.get("intencao") or "informar").strip() or "informar",
            "publico_alvo": str(metadata.get("publico_alvo") or "estudantes").strip() or "estudantes",
            "versao": versao,
            "status": str(metadata.get("status") or "ativo").strip() or "ativo",
            "idioma": str(metadata.get("idioma") or "pt-BR").strip() or "pt-BR",
            "tags": normalized_tags[:30],
            "palavras_chave": normalized_keywords[:40],
            "fonte": str(metadata.get("fonte") or "documento_legado").strip() or "documento_legado",
            "autor": str(metadata.get("autor") or "ufabc").strip() or "ufabc",
            "confiabilidade": str(metadata.get("confiabilidade") or "media").strip() or "media",
            "relacionados": normalized_relacionados[:40],
            "atualizado_em": SQLAlchemyFileFeedRepository._normalize_date_string(
                metadata.get("atualizado_em"),
                today_iso,
            ),
            "criado_em": SQLAlchemyFileFeedRepository._normalize_date_string(
                metadata.get("criado_em"),
                today_iso,
            ),
        }
