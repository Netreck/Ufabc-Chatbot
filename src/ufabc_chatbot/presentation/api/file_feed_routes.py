import json
from html import escape
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import quote
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import HTMLResponse

from ufabc_chatbot.application.file_feed_service import FileFeedService, IncomingFeedFile
from ufabc_chatbot.core.dependencies import get_file_feed_service
from ufabc_chatbot.domain.file_feed import FileFeedRecord, FileFeedStatus
from ufabc_chatbot.presentation.api.file_feed_schemas import (
    BatchUploadFileResult,
    BatchUploadResponse,
    BatchValidateResponse,
    CreateFolderRequest,
    CreateFolderResponse,
    FileTreeFolderResponse,
    FileTreeResponse,
    FileFeedPreviewResponse,
    FileFeedResponse,
    MoveFeedFileRequest,
    MoveFolderRequest,
    RenameFeedFileRequest,
    RenameFolderRequest,
    UpdateFileFeedStatusRequest,
    ValidateFileResult,
)

router = APIRouter()


def _to_response(record: FileFeedRecord) -> FileFeedResponse:
    folder_path = _extract_folder_path(record.stored_filename)
    return FileFeedResponse(
        id=record.id,
        original_filename=record.original_filename,
        stored_filename=record.stored_filename,
        folder_path=folder_path,
        content_type=record.content_type,
        size_bytes=record.size_bytes,
        status=record.status,
        document_metadata=record.document_metadata,
        storage_metadata=record.storage_metadata,
        created_at=record.created_at,
    )


def _extract_folder_path(stored_filename: str) -> str:
    parent = str(PurePosixPath(stored_filename).parent)
    return "" if parent == "." else parent


def _to_tree_folder(path: str) -> FileTreeFolderResponse:
    name = path.split("/")[-1]
    return FileTreeFolderResponse(
        path=path,
        name=name,
        depth=path.count("/"),
    )


def _parse_storage_metadata(raw_storage_metadata: str | None) -> dict[str, Any]:
    if raw_storage_metadata is None or raw_storage_metadata.strip() == "":
        return {}

    try:
        parsed = json.loads(raw_storage_metadata)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail="storage_metadata must be a valid JSON object.",
        ) from exc

    if not isinstance(parsed, dict):
        raise HTTPException(
            status_code=400,
            detail="storage_metadata must be a JSON object.",
        )

    return parsed


@router.post("/files/feed", response_model=FileFeedResponse, status_code=status.HTTP_201_CREATED)
async def upload_feed_file(
    file: UploadFile = File(...),
    storage_metadata: str | None = Form(default=None),
    folder_path: str | None = Form(default=None),
    service: FileFeedService = Depends(get_file_feed_service),
) -> FileFeedResponse:
    content = await file.read()
    parsed_storage_metadata = _parse_storage_metadata(storage_metadata)
    incoming_file = IncomingFeedFile(
        filename=file.filename or "upload.bin",
        content_type=file.content_type,
        content=content,
    )

    try:
        record = await service.ingest(
            incoming_file,
            storage_metadata=parsed_storage_metadata,
            folder_path=folder_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _to_response(record)


@router.post("/files/feed/batch", response_model=BatchUploadResponse)
async def batch_upload_feed_files(
    files: list[UploadFile] = File(...),
    storage_metadata: str | None = Form(default=None),
    folder_path: str | None = Form(default=None),
    service: FileFeedService = Depends(get_file_feed_service),
) -> BatchUploadResponse:
    parsed_storage_metadata = _parse_storage_metadata(storage_metadata)
    results: list[BatchUploadFileResult] = []
    succeeded = 0

    for upload_file in files:
        filename = upload_file.filename or "upload.bin"
        try:
            content = await upload_file.read()
            incoming = IncomingFeedFile(
                filename=filename,
                content_type=upload_file.content_type,
                content=content,
            )
            record = await service.ingest(
                incoming,
                storage_metadata=parsed_storage_metadata,
                folder_path=folder_path,
            )
            results.append(BatchUploadFileResult(
                filename=filename,
                success=True,
                file=_to_response(record),
            ))
            succeeded += 1
        except Exception as exc:
            results.append(BatchUploadFileResult(
                filename=filename,
                success=False,
                error=str(exc),
            ))

    return BatchUploadResponse(
        total=len(files),
        succeeded=succeeded,
        failed=len(files) - succeeded,
        results=results,
    )


@router.post("/files/feed/validate", response_model=BatchValidateResponse)
async def validate_feed_files(
    files: list[UploadFile] = File(...),
    service: FileFeedService = Depends(get_file_feed_service),
) -> BatchValidateResponse:
    results: list[ValidateFileResult] = []

    for upload_file in files:
        filename = upload_file.filename or "upload.bin"
        errors: list[str] = []

        try:
            content = await upload_file.read()
        except Exception as exc:
            results.append(ValidateFileResult(
                filename=filename, valid=False, errors=[f"Failed to read file: {exc}"],
            ))
            continue

        if not filename.lower().endswith(".md"):
            errors.append("Only Markdown (.md) files are accepted.")

        if not content:
            errors.append("File is empty.")
        elif len(content) > service._max_file_size_bytes:
            errors.append(
                f"File exceeds max size of {service._max_file_size_bytes // (1024 * 1024)} MB."
            )

        if content and filename.lower().endswith(".md"):
            try:
                service._extract_document_metadata(content)
            except ValueError as exc:
                errors.append(str(exc))

        results.append(ValidateFileResult(
            filename=filename,
            valid=len(errors) == 0,
            errors=errors,
        ))

    return BatchValidateResponse(results=results)


@router.get("/files/tree", response_model=FileTreeResponse)
async def list_file_tree(
    service: FileFeedService = Depends(get_file_feed_service),
) -> FileTreeResponse:
    folders, files = await service.list_tree()
    folder_items = [_to_tree_folder(path) for path in folders]
    file_items = [_to_response(record) for record in files]
    return FileTreeResponse(folders=folder_items, files=file_items)


@router.post("/files/folders", response_model=CreateFolderResponse, status_code=status.HTTP_201_CREATED)
async def create_folder(
    payload: CreateFolderRequest,
    service: FileFeedService = Depends(get_file_feed_service),
) -> CreateFolderResponse:
    try:
        created_path = await service.create_folder(payload.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return CreateFolderResponse(path=created_path)


@router.delete("/files/folders/{folder_path:path}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(
    folder_path: str,
    service: FileFeedService = Depends(get_file_feed_service),
) -> Response:
    try:
        await service.delete_folder(folder_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/files/feed", response_model=list[FileFeedResponse])
async def list_feed_files(
    service: FileFeedService = Depends(get_file_feed_service),
    status_filter: FileFeedStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[FileFeedResponse]:
    records = await service.list_files(status=status_filter, limit=limit, offset=offset)
    return [_to_response(record) for record in records]


@router.get("/files/feed/{file_id}/download")
async def download_feed_file(
    file_id: UUID,
    service: FileFeedService = Depends(get_file_feed_service),
) -> Response:
    try:
        record, content = await service.download(file_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    filename = quote(record.original_filename)
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"}

    return Response(
        content=content,
        media_type=record.content_type or "application/octet-stream",
        headers=headers,
    )


@router.patch("/files/feed/{file_id}/status", response_model=FileFeedResponse)
async def update_feed_file_status(
    file_id: UUID,
    payload: UpdateFileFeedStatusRequest,
    service: FileFeedService = Depends(get_file_feed_service),
) -> FileFeedResponse:
    record = await service.update_status(file_id=file_id, status=payload.status)
    if record is None:
        raise HTTPException(status_code=404, detail="Feed file record not found.")

    return _to_response(record)


@router.patch("/files/feed/{file_id}/move", response_model=FileFeedResponse)
async def move_feed_file(
    file_id: UUID,
    payload: MoveFeedFileRequest,
    service: FileFeedService = Depends(get_file_feed_service),
) -> FileFeedResponse:
    try:
        record = await service.move_file(
            file_id=file_id,
            target_folder_path=payload.target_folder_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if record is None:
        raise HTTPException(status_code=404, detail="Feed file record not found.")

    return _to_response(record)


@router.patch("/files/feed/{file_id}/rename", response_model=FileFeedResponse)
async def rename_feed_file(
    file_id: UUID,
    payload: RenameFeedFileRequest,
    service: FileFeedService = Depends(get_file_feed_service),
) -> FileFeedResponse:
    try:
        record = await service.rename_file(
            file_id=file_id,
            new_filename=payload.new_filename,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if record is None:
        raise HTTPException(status_code=404, detail="Feed file record not found.")

    return _to_response(record)


@router.patch("/files/folders/{folder_path:path}/rename")
async def rename_folder(
    folder_path: str,
    payload: RenameFolderRequest,
    service: FileFeedService = Depends(get_file_feed_service),
) -> CreateFolderResponse:
    try:
        new_path = await service.rename_folder(
            old_path=folder_path,
            new_name=payload.new_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return CreateFolderResponse(path=new_path)


@router.patch("/files/folders/{folder_path:path}/move")
async def move_folder(
    folder_path: str,
    payload: MoveFolderRequest,
    service: FileFeedService = Depends(get_file_feed_service),
) -> CreateFolderResponse:
    try:
        new_path = await service.move_folder(
            source_path=folder_path,
            target_parent_path=payload.target_parent_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return CreateFolderResponse(path=new_path)


@router.get("/files/feed/{file_id}/preview", response_model=FileFeedPreviewResponse)
async def preview_feed_file(
    file_id: UUID,
    service: FileFeedService = Depends(get_file_feed_service),
) -> FileFeedPreviewResponse:
    try:
        record, markdown_text = await service.preview(file_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return FileFeedPreviewResponse(
        id=record.id,
        original_filename=record.original_filename,
        status=record.status,
        document_metadata=record.document_metadata,
        storage_metadata=record.storage_metadata,
        markdown_text=markdown_text,
    )


@router.get("/files/feed/{file_id}/preview/frame", response_class=HTMLResponse)
async def preview_feed_file_frame(
    file_id: UUID,
    service: FileFeedService = Depends(get_file_feed_service),
) -> HTMLResponse:
    try:
        record, markdown_text = await service.preview(file_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    metadata_json = json.dumps(
        record.document_metadata.model_dump(mode="json"),
        ensure_ascii=False,
        indent=2,
    )
    storage_json = json.dumps(
        record.storage_metadata,
        ensure_ascii=False,
        indent=2,
    )

    html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{escape(record.original_filename)}</title>
    <style>
      body {{
        margin: 0;
        background: #081a1d;
        color: #f6fbfa;
        font-family: "IBM Plex Mono", "Courier New", monospace;
      }}
      .wrapper {{
        padding: 14px;
        display: grid;
        gap: 12px;
      }}
      .card {{
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 10px;
        padding: 10px;
        background: rgba(255,255,255,0.03);
      }}
      h2 {{
        margin: 0 0 8px;
        font-size: 14px;
        color: #ffb36d;
      }}
      pre {{
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 12px;
        line-height: 1.4;
      }}
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="card">
        <h2>Document Metadata</h2>
        <pre>{escape(metadata_json)}</pre>
      </div>
      <div class="card">
        <h2>Storage Metadata</h2>
        <pre>{escape(storage_json)}</pre>
      </div>
      <div class="card">
        <h2>Markdown Content</h2>
        <pre>{escape(markdown_text)}</pre>
      </div>
    </div>
  </body>
</html>
"""
    return HTMLResponse(content=html)


@router.delete("/files/feed/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_feed_file(
    file_id: UUID,
    service: FileFeedService = Depends(get_file_feed_service),
) -> Response:
    deleted = await service.delete(file_id)
    if deleted is None:
        raise HTTPException(status_code=404, detail="Feed file record not found.")

    return Response(status_code=status.HTTP_204_NO_CONTENT)
