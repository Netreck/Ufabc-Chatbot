from uuid import UUID

from pydantic import BaseModel, Field

from ufabc_chatbot.domain.models import ChatMessage


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=30)
    context_file_ids: list[UUID] = Field(default_factory=list, max_length=10)


class ChatResponse(BaseModel):
    reply: str
    context_files_loaded: list[UUID] = Field(default_factory=list)
