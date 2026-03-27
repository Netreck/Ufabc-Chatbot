import logging
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
import re
from typing import Any
from uuid import UUID, uuid4

import yaml
from pydantic import ValidationError

from ufabc_chatbot.application.contracts import FileFeedRepository, FileFeedStorage
from ufabc_chatbot.domain.file_feed import (
    FileFeedCreate,
    FileFeedRecord,
    FileFeedStatus,
    RAGDocumentMetadata,
)


@dataclass(frozen=True)
class IncomingFeedFile:
    filename: str
    content_type: str | None
    content: bytes


logger = logging.getLogger(__name__)


class FileFeedService:
    def __init__(
        self,
        repository: FileFeedRepository,
        storage: FileFeedStorage,
        max_file_size_mb: int,
    ) -> None:
        self._repository = repository
        self._storage = storage
        self._max_file_size_bytes = max_file_size_mb * 1024 * 1024

    async def ingest(
        self,
        incoming_file: IncomingFeedFile,
        *,
        storage_metadata: dict[str, Any] | None = None,
        folder_path: str | None = None,
    ) -> FileFeedRecord:
        filename = Path(incoming_file.filename).name.strip()
        if not filename:
            raise ValueError("Filename is required.")

        if Path(filename).suffix.lower() != ".md":
            raise ValueError("Only Markdown (.md) files are accepted in the feed.")

        if not incoming_file.content:
            raise ValueError("Uploaded file is empty.")

        if len(incoming_file.content) > self._max_file_size_bytes:
            raise ValueError(
                f"Uploaded file exceeds max size of {self._max_file_size_bytes} bytes."
            )

        document_metadata = self._extract_document_metadata(incoming_file.content)
        final_storage_metadata = self._build_storage_metadata(
            document_metadata=document_metadata,
            custom_storage_metadata=storage_metadata,
        )

        normalized_folder = self._normalize_folder_path(folder_path or "")
        if normalized_folder:
            await self._storage.create_folder(normalized_folder)

        file_id = uuid4()
        extension = Path(filename).suffix.lower()[:15]
        basename = f"{file_id}{extension}"
        stored_filename = (
            f"{normalized_folder}/{basename}" if normalized_folder else basename
        )

        await self._storage.save(
            stored_filename=stored_filename,
            content=incoming_file.content,
            metadata=final_storage_metadata,
        )

        record = FileFeedCreate(
            id=file_id,
            original_filename=filename,
            stored_filename=stored_filename,
            content_type=incoming_file.content_type or "text/markdown",
            size_bytes=len(incoming_file.content),
            status="pending",
            document_metadata=document_metadata,
            storage_metadata=final_storage_metadata,
        )
        return await self._repository.create(record)

    async def list_files(
        self,
        *,
        status: FileFeedStatus | None,
        limit: int,
        offset: int,
    ) -> list[FileFeedRecord]:
        return await self._repository.list(
            status=status,
            limit=limit,
            offset=offset,
        )

    async def download(self, file_id: UUID) -> tuple[FileFeedRecord, bytes]:
        record = await self._repository.get(file_id)
        if record is None:
            raise FileNotFoundError("Feed file record not found.")

        content = await self._storage.read(record.stored_filename)
        return record, content

    async def update_status(
        self,
        file_id: UUID,
        status: FileFeedStatus,
    ) -> FileFeedRecord | None:
        return await self._repository.update_status(file_id=file_id, status=status)

    async def preview(self, file_id: UUID) -> tuple[FileFeedRecord, str]:
        record, content = await self.download(file_id)
        return record, content.decode("utf-8", errors="replace")

    async def update_content(self, file_id: UUID, markdown_text: str) -> FileFeedRecord:
        return await self.update_content_with_actor(
            file_id=file_id,
            markdown_text=markdown_text,
            actor=None,
        )

    async def update_content_with_actor(
        self,
        *,
        file_id: UUID,
        markdown_text: str,
        actor: str | None,
    ) -> FileFeedRecord:
        record = await self._repository.get(file_id)
        if record is None:
            raise FileNotFoundError("Feed file record not found.")
        content_bytes = markdown_text.encode("utf-8")
        document_metadata = self._extract_document_metadata(content_bytes)
        preserved_storage_metadata = {
            key: value
            for key, value in record.storage_metadata.items()
            if not key.startswith("document_")
        }
        if actor:
            preserved_storage_metadata["audit_last_modified_by"] = actor
        storage_metadata = self._build_storage_metadata(
            document_metadata=document_metadata,
            custom_storage_metadata=preserved_storage_metadata,
        )

        await self._storage.save(
            record.stored_filename,
            content_bytes,
            metadata=storage_metadata,
        )

        updated = await self._repository.update_content_metadata(
            file_id=file_id,
            size_bytes=len(content_bytes),
            document_metadata=document_metadata,
            storage_metadata=storage_metadata,
        )
        if updated is None:
            raise FileNotFoundError("Feed file record not found.")
        return updated

    async def merge_storage_metadata(
        self,
        *,
        file_id: UUID,
        updates: dict[str, Any],
    ) -> FileFeedRecord | None:
        record = await self._repository.get(file_id)
        if record is None:
            return None
        merged = dict(record.storage_metadata)
        merged.update(updates)
        return await self._repository.update_storage_metadata(
            file_id=file_id,
            storage_metadata=merged,
        )

    async def delete(self, file_id: UUID) -> FileFeedRecord | None:
        record = await self._repository.get(file_id)
        if record is None:
            return None

        try:
            await self._storage.delete(record.stored_filename)
        except Exception:
            logger.warning(
                "Storage deletion failed for %s (file_id=%s), proceeding with DB cleanup.",
                record.stored_filename,
                file_id,
                exc_info=True,
            )

        deleted = await self._repository.delete(file_id)
        logger.info("Deleted file record %s (status=%s) from database.", file_id, record.status)
        return deleted

    async def create_folder(self, folder_path: str) -> str:
        normalized = self._normalize_folder_path(folder_path)
        if not normalized:
            raise ValueError("Folder path must not be empty.")

        await self._storage.create_folder(normalized)
        return normalized

    async def delete_folder(self, folder_path: str) -> int:
        normalized = self._normalize_folder_path(folder_path)
        if not normalized:
            raise ValueError("Folder path must not be empty.")

        try:
            await self._storage.delete_folder(normalized)
        except Exception:
            logger.warning(
                "Storage folder deletion failed for '%s', proceeding with DB cleanup.",
                normalized,
                exc_info=True,
            )

        count = await self._repository.delete_by_folder_prefix(normalized)
        logger.info("Deleted folder '%s' — removed %d file records from database.", normalized, count)
        return count

    async def rename_file(
        self,
        *,
        file_id: UUID,
        new_filename: str,
    ) -> FileFeedRecord | None:
        filename = Path(new_filename).name.strip()
        if not filename:
            raise ValueError("Filename is required.")
        if Path(filename).suffix.lower() != ".md":
            raise ValueError("Filename must end with .md extension.")

        record = await self._repository.get(file_id)
        if record is None:
            return None

        return await self._repository.update_original_filename(file_id, filename)

    async def rename_folder(
        self,
        *,
        old_path: str,
        new_name: str,
    ) -> str:
        old_normalized = self._normalize_folder_path(old_path)
        if not old_normalized:
            raise ValueError("Folder path must not be empty.")

        # Build new path: replace the last segment with new_name
        parts = old_normalized.split("/")
        parts[-1] = new_name
        new_normalized = self._normalize_folder_path("/".join(parts))
        if not new_normalized:
            raise ValueError("New folder name is invalid.")

        if old_normalized == new_normalized:
            return new_normalized

        # Move all files in storage from old path to new path
        files = await self._repository.list(status=None, limit=10_000, offset=0)
        old_prefix = old_normalized + "/"
        for record in files:
            if not record.stored_filename.startswith(old_prefix):
                continue
            suffix = record.stored_filename[len(old_prefix):]
            new_key = f"{new_normalized}/{suffix}"
            try:
                await self._storage.move(record.stored_filename, new_key)
            except Exception:
                logger.warning(
                    "Failed to move '%s' → '%s' during folder rename.",
                    record.stored_filename,
                    new_key,
                    exc_info=True,
                )
            await self._repository.update_stored_filename(record.id, new_key)

        # Swap folder markers
        try:
            await self._storage.delete_folder(old_normalized)
        except Exception:
            logger.warning("Failed to delete old folder marker '%s'.", old_normalized, exc_info=True)

        await self._storage.create_folder(new_normalized)
        logger.info("Renamed folder '%s' → '%s'.", old_normalized, new_normalized)
        return new_normalized

    async def move_folder(
        self,
        *,
        source_path: str,
        target_parent_path: str,
    ) -> str:
        old_normalized = self._normalize_folder_path(source_path)
        if not old_normalized:
            raise ValueError("Source folder path must not be empty.")

        target_normalized = self._normalize_folder_path(target_parent_path)

        if target_normalized == old_normalized:
            raise ValueError("Cannot move a folder into itself.")
        if target_normalized and target_normalized.startswith(old_normalized + "/"):
            raise ValueError("Cannot move a folder into one of its own subfolders.")

        source_name = old_normalized.split("/")[-1]
        new_normalized = (
            f"{target_normalized}/{source_name}" if target_normalized else source_name
        )

        if old_normalized == new_normalized:
            return new_normalized

        if target_normalized:
            await self._storage.create_folder(target_normalized)

        # Snapshot subfolder markers before deleting old folder
        all_folders = await self._storage.list_folders()
        old_prefix = old_normalized + "/"
        subfolder_suffixes = [
            folder[len(old_prefix):]
            for folder in all_folders
            if folder.startswith(old_prefix)
        ]

        # Move all files in storage from old path to new path
        files = await self._repository.list(status=None, limit=10_000, offset=0)
        new_prefix = new_normalized + "/"
        for record in files:
            if not record.stored_filename.startswith(old_prefix):
                continue
            suffix = record.stored_filename[len(old_prefix):]
            new_key = f"{new_prefix}{suffix}"
            try:
                await self._storage.move(record.stored_filename, new_key)
            except Exception:
                logger.warning(
                    "Failed to move '%s' → '%s' during folder move.",
                    record.stored_filename,
                    new_key,
                    exc_info=True,
                )
            await self._repository.update_stored_filename(record.id, new_key)

        # Delete old folder markers
        try:
            await self._storage.delete_folder(old_normalized)
        except Exception:
            logger.warning(
                "Failed to delete old folder marker '%s'.",
                old_normalized,
                exc_info=True,
            )

        # Recreate folder marker and subfolder markers under new path
        await self._storage.create_folder(new_normalized)
        for sub_suffix in subfolder_suffixes:
            await self._storage.create_folder(f"{new_prefix}{sub_suffix}")

        logger.info("Moved folder '%s' → '%s'.", old_normalized, new_normalized)
        return new_normalized

    async def move_file(
        self,
        *,
        file_id: UUID,
        target_folder_path: str,
    ) -> FileFeedRecord | None:
        record = await self._repository.get(file_id)
        if record is None:
            return None

        normalized_target_folder = self._normalize_folder_path(target_folder_path)
        _, basename = self._split_storage_key(record.stored_filename)
        target_key = (
            f"{normalized_target_folder}/{basename}"
            if normalized_target_folder
            else basename
        )

        if target_key == record.stored_filename:
            return record

        if normalized_target_folder:
            await self._storage.create_folder(normalized_target_folder)

        await self._storage.move(record.stored_filename, target_key)
        return await self._repository.update_stored_filename(file_id, target_key)

    async def list_tree(self) -> tuple[list[str], list[FileFeedRecord]]:
        files = await self._repository.list(status=None, limit=10_000, offset=0)
        folder_set = set(await self._storage.list_folders())

        for record in files:
            folder_path, _ = self._split_storage_key(record.stored_filename)
            if not folder_path:
                continue
            folder_set.update(self._expand_folder_hierarchy(folder_path))

        folders = sorted(folder_set)
        return folders, files

    @staticmethod
    def _extract_document_metadata(content: bytes) -> RAGDocumentMetadata:
        try:
            markdown_text = content.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("Markdown files must be UTF-8 encoded.") from exc

        lines = markdown_text.splitlines()
        if not lines or lines[0].strip() != "---":
            raise ValueError("Markdown must start with YAML front matter delimited by '---'.")

        closing_index = None
        for index, line in enumerate(lines[1:], start=1):
            if line.strip() == "---":
                closing_index = index
                break

        if closing_index is None:
            raise ValueError("YAML front matter is missing closing delimiter '---'.")

        front_matter_raw = "\n".join(lines[1:closing_index])
        body = "\n".join(lines[closing_index + 1 :]).strip()
        if not body:
            raise ValueError("Markdown body cannot be empty.")
        if not body.startswith("# "):
            raise ValueError("Markdown body must start with a level-1 heading ('# Titulo').")

        try:
            parsed_front_matter = yaml.load(front_matter_raw, Loader=yaml.BaseLoader)
        except yaml.YAMLError as exc:
            raise ValueError("Invalid YAML front matter.") from exc

        if not isinstance(parsed_front_matter, dict):
            raise ValueError("Front matter must be a YAML object.")

        try:
            return RAGDocumentMetadata.model_validate(parsed_front_matter)
        except ValidationError as exc:
            raise ValueError(f"Invalid RAG metadata format: {exc}") from exc

    @staticmethod
    def _build_storage_metadata(
        *,
        document_metadata: RAGDocumentMetadata,
        custom_storage_metadata: dict[str, Any] | None,
    ) -> dict[str, Any]:
        metadata = {
            "document_id": document_metadata.id,
            "document_tipo": document_metadata.tipo,
            "document_dominio": document_metadata.dominio,
            "document_subdominio": document_metadata.subdominio,
            "document_versao": document_metadata.versao,
            "document_atualizado_em": document_metadata.atualizado_em.isoformat(),
        }

        if custom_storage_metadata:
            metadata.update(custom_storage_metadata)

        return metadata

    @staticmethod
    def _normalize_folder_path(raw_path: str) -> str:
        normalized = raw_path.strip().replace("\\", "/").strip("/")
        if not normalized:
            return ""

        parts = [part.strip() for part in normalized.split("/") if part.strip()]
        if not parts:
            return ""

        for part in parts:
            if part in {".", ".."}:
                raise ValueError("Folder path cannot contain '.' or '..'.")
            if not re.fullmatch(r"[A-Za-z0-9._-]{1,120}", part):
                raise ValueError(
                    "Folder names must use only letters, numbers, '.', '_' or '-'."
                )

        return "/".join(parts)

    @staticmethod
    def _split_storage_key(storage_key: str) -> tuple[str, str]:
        path = PurePosixPath(storage_key)
        folder = "" if str(path.parent) == "." else str(path.parent)
        return folder, path.name

    @staticmethod
    def _expand_folder_hierarchy(folder_path: str) -> set[str]:
        parts = folder_path.split("/")
        expanded: set[str] = set()
        for index in range(1, len(parts) + 1):
            expanded.add("/".join(parts[:index]))
        return expanded
