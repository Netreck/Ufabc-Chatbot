import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from ufabc_chatbot.application.services import ChatService
from ufabc_chatbot.core.dependencies import get_chat_service, get_file_feed_service
from ufabc_chatbot.application.file_feed_service import FileFeedService
from ufabc_chatbot.presentation.api.schemas import ChatRequest, ChatResponse

router = APIRouter()


async def _load_context_blocks(
    file_ids: list[UUID],
    file_feed_service: FileFeedService,
) -> list[str]:
    blocks: list[str] = []
    max_document_chars = 3500

    for file_id in file_ids:
        try:
            record, markdown_text = await file_feed_service.preview(file_id)
        except FileNotFoundError as exc:
            raise HTTPException(
                status_code=404,
                detail=f"Context file {file_id} was not found.",
            ) from exc

        metadata_json = json.dumps(
            record.document_metadata.model_dump(mode="json"),
            ensure_ascii=False,
            indent=2,
        )
        excerpt = markdown_text[:max_document_chars]
        suffix = "" if len(markdown_text) <= max_document_chars else "\n...[truncated]"

        blocks.append(
            (
                f"Arquivo: {record.original_filename}\n"
                f"ID: {record.id}\n"
                f"Metadata:\n{metadata_json}\n\n"
                f"Conteudo:\n{excerpt}{suffix}"
            )
        )

    return blocks


@router.post("/chat", response_model=ChatResponse)
async def create_chat_completion(
    payload: ChatRequest,
    service: ChatService = Depends(get_chat_service),
    file_feed_service: FileFeedService = Depends(get_file_feed_service),
) -> ChatResponse:
    deduped_context_ids = list(dict.fromkeys(payload.context_file_ids))
    context_blocks = await _load_context_blocks(deduped_context_ids, file_feed_service)

    try:
        reply = await service.reply(payload.messages, context_blocks=context_blocks)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ChatResponse(reply=reply, context_files_loaded=deduped_context_ids)
