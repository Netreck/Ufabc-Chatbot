from typing import Any

from pydantic import BaseModel, Field

from ufabc_chatbot.domain.file_feed import RAGDocumentMetadata
from ufabc_chatbot.presentation.api.file_feed_schemas import FileFeedResponse


class IngestionPrepareRequest(BaseModel):
    source_text: str = Field(min_length=20, max_length=120_000)
    source_filename: str | None = Field(default=None, max_length=255)


class IngestionPrepareResponse(BaseModel):
    markdown_text: str
    suggested_filename: str
    metadata: RAGDocumentMetadata
    model: str


class IngestionCommitRequest(BaseModel):
    markdown_text: str = Field(min_length=40, max_length=200_000)
    filename: str = Field(min_length=1, max_length=255)
    folder_path: str = Field(default="", max_length=255)
    storage_metadata: dict[str, Any] = Field(default_factory=dict)


class IngestionCommitResponse(BaseModel):
    file: FileFeedResponse

