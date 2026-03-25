from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from ufabc_chatbot.domain.file_feed import FileFeedStatus, RAGDocumentMetadata


class FileFeedResponse(BaseModel):
    id: UUID
    original_filename: str
    stored_filename: str
    folder_path: str
    content_type: str | None = None
    size_bytes: int
    status: FileFeedStatus
    document_metadata: RAGDocumentMetadata
    storage_metadata: dict[str, Any]
    created_at: datetime


class UpdateFileFeedStatusRequest(BaseModel):
    status: FileFeedStatus = Field(...)


class FileFeedPreviewResponse(BaseModel):
    id: UUID
    original_filename: str
    status: FileFeedStatus
    document_metadata: RAGDocumentMetadata
    storage_metadata: dict[str, Any]
    markdown_text: str


class CreateFolderRequest(BaseModel):
    path: str = Field(min_length=1, max_length=255)


class CreateFolderResponse(BaseModel):
    path: str


class MoveFeedFileRequest(BaseModel):
    target_folder_path: str = Field(default="", max_length=255)


class RenameFeedFileRequest(BaseModel):
    new_filename: str = Field(min_length=1, max_length=255)


class RenameFolderRequest(BaseModel):
    new_name: str = Field(min_length=1, max_length=120)


class MoveFolderRequest(BaseModel):
    target_parent_path: str = Field(default="", max_length=255)


class UpdateFileFeedContentRequest(BaseModel):
    markdown_text: str


class FileTreeFolderResponse(BaseModel):
    path: str
    name: str
    depth: int


class FileTreeResponse(BaseModel):
    folders: list[FileTreeFolderResponse]
    files: list[FileFeedResponse]


class BatchUploadFileResult(BaseModel):
    filename: str
    success: bool
    file: FileFeedResponse | None = None
    error: str | None = None


class BatchUploadResponse(BaseModel):
    total: int
    succeeded: int
    failed: int
    results: list[BatchUploadFileResult]


class ValidateFileResult(BaseModel):
    filename: str
    valid: bool
    errors: list[str] = []


class BatchValidateResponse(BaseModel):
    results: list[ValidateFileResult]
