from typing import Sequence

try:
    from openai import AsyncOpenAI
except ModuleNotFoundError:  # pragma: no cover - optional dependency in local smoke runs
    AsyncOpenAI = None  # type: ignore[assignment]

from ufabc_chatbot.core.config import Settings
from ufabc_chatbot.domain.models import ChatMessage


class OpenAIProvider:
    """LLM provider backed by OpenAI."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: AsyncOpenAI | None = None
        if settings.openai_api_key and AsyncOpenAI is not None:
            self._client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def generate(self, messages: Sequence[ChatMessage]) -> str:
        if self._client is None:
            return (
                "[openai-not-configured] Defina OPENAI_API_KEY e instale o pacote "
                "`openai` para habilitar respostas via API."
            )

        try:
            response = await self._client.chat.completions.create(
                model=self._settings.openai_model,
                messages=[
                    {"role": message.role, "content": message.content}
                    for message in messages
                ],
            )
        except Exception as exc:
            return f"[openai-error] {type(exc).__name__}: {exc}"
        message = response.choices[0].message if response.choices else None
        content = (message.content or "").strip() if message else ""
        if content:
            return content

        return "[openai-empty-response]"


# Backward-compatible alias for imports created during scaffold phase.
OpenAIStubProvider = OpenAIProvider
