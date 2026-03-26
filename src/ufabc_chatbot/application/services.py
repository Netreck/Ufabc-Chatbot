from typing import Sequence

from ufabc_chatbot.application.contracts import LLMProvider
from ufabc_chatbot.domain.models import ChatMessage


class ChatService:
    def __init__(self, llm_provider: LLMProvider) -> None:
        self._llm_provider = llm_provider

    async def reply(
        self,
        messages: Sequence[ChatMessage],
        *,
        context_blocks: Sequence[str] | None = None,
    ) -> str:
        if not messages:
            raise ValueError("At least one message is required.")

        final_messages = list(messages)
        if context_blocks:
            system_messages: list[ChatMessage] = [
                ChatMessage(
                    role="system",
                    content=(
                        "Use os documentos de contexto fornecidos quando forem relevantes. Nao invente informacoes e responda breve e objetivamente. "
                        "para responder a pergunta do usuario."
                    ),
                )
            ]
            for block in context_blocks:
                system_messages.append(
                    ChatMessage(role="system", content=block[:7000]),
                )

            final_messages = [*system_messages, *final_messages]

        return await self._llm_provider.generate(final_messages)
