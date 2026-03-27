from typing import Any, Protocol, Sequence
from uuid import UUID

from ufabc_chatbot.domain.file_feed import (
    FileFeedCreate,
    FileFeedRecord,
    FileFeedStatus,
    RAGDocumentMetadata,
)
from ufabc_chatbot.domain.models import ChatMessage


class LLMProvider(Protocol):
    async def generate(self, messages: Sequence[ChatMessage]) -> str:
        """Generate an assistant response from a message sequence."""


class FileFeedRepository(Protocol):
    async def create(self, payload: FileFeedCreate) -> FileFeedRecord:
        """Persist a new feed file record."""

    async def list(
        self,
        *,
        status: FileFeedStatus | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[FileFeedRecord]:
        """List feed file records ordered by newest first."""

    async def get(self, file_id: UUID) -> FileFeedRecord | None:
        """Get a feed record by id."""

    async def update_status(
        self,
        file_id: UUID,
        status: FileFeedStatus,
    ) -> FileFeedRecord | None:
        """Update processing status for a feed file record."""

    async def delete(self, file_id: UUID) -> FileFeedRecord | None:
        """Delete a feed file record and return the removed record."""

    async def update_stored_filename(
        self,
        file_id: UUID,
        stored_filename: str,
    ) -> FileFeedRecord | None:
        """Update storage key (path/key inside bucket) for a feed file."""

    async def update_content_metadata(
        self,
        *,
        file_id: UUID,
        size_bytes: int,
        document_metadata: RAGDocumentMetadata,
        storage_metadata: dict[str, Any],
    ) -> FileFeedRecord | None:
        """Update content-derived fields after file body changes."""

    async def update_storage_metadata(
        self,
        *,
        file_id: UUID,
        storage_metadata: dict[str, Any],
    ) -> FileFeedRecord | None:
        """Update storage metadata fields for a feed file record."""

    async def delete_by_folder_prefix(self, folder_prefix: str) -> int:
        """Delete all records whose stored_filename starts with the folder prefix."""


class FileFeedStorage(Protocol):
    async def save(
        self,
        stored_filename: str,
        content: bytes,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Store raw file bytes using the generated stored filename."""

    async def read(self, stored_filename: str) -> bytes:
        """Read file bytes by stored filename."""

    async def delete(self, stored_filename: str) -> None:
        """Delete file bytes by stored filename."""

    async def move(self, source_stored_filename: str, target_stored_filename: str) -> None:
        """Move file bytes from source key to target key."""

    async def create_folder(self, folder_path: str) -> None:
        """Create a virtual folder path inside storage."""

    async def delete_folder(self, folder_path: str) -> None:
        """Delete a virtual folder and all objects inside it from storage."""

    async def list_folders(self) -> list[str]:
        """List virtual folder paths available in storage."""
