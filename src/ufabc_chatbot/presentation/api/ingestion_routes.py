import json
import re
import unicodedata
from datetime import date
from pathlib import Path, PurePosixPath
from typing import Any

import yaml
from fastapi import APIRouter, Depends, HTTPException, status

from ufabc_chatbot.application.file_feed_service import FileFeedService, IncomingFeedFile
from ufabc_chatbot.core.auth_dependencies import get_current_user
from ufabc_chatbot.core.config import Settings, get_settings
from ufabc_chatbot.core.dependencies import get_file_feed_service
from ufabc_chatbot.domain.auth import UserRecord
from ufabc_chatbot.domain.file_feed import FileFeedRecord, RAGDocumentMetadata
from ufabc_chatbot.presentation.api.file_feed_schemas import FileFeedResponse
from ufabc_chatbot.presentation.api.ingestion_schemas import (
    IngestionCommitRequest,
    IngestionCommitResponse,
    IngestionPrepareRequest,
    IngestionPrepareResponse,
)

try:
    from openai import AsyncOpenAI
except ModuleNotFoundError:  # pragma: no cover - optional dependency in local setup
    AsyncOpenAI = None  # type: ignore[assignment]

router = APIRouter()

INGESTION_MODEL = "gpt-4o"


def _upload_error_message(exc: Exception) -> str:
    text = str(exc)
    if "Non ascii characters found in S3 metadata" in text:
        return (
            "Falha ao confirmar upload: metadados S3 aceitam apenas ASCII. "
            "Ajuste campos com acento (ex.: tipo/dominio) ou use valores sem acento."
        )
    return text or "Falha interna ao confirmar upload."


def _extract_folder_path(stored_filename: str) -> str:
    parent = str(PurePosixPath(stored_filename).parent)
    return "" if parent == "." else parent


def _to_file_response(record: FileFeedRecord) -> FileFeedResponse:
    return FileFeedResponse(
        id=record.id,
        original_filename=record.original_filename,
        stored_filename=record.stored_filename,
        folder_path=_extract_folder_path(record.stored_filename),
        content_type=record.content_type,
        size_bytes=record.size_bytes,
        status=record.status,
        document_metadata=record.document_metadata,
        storage_metadata=record.storage_metadata,
        created_at=record.created_at,
    )


def _slugify(value: str, fallback: str = "documento-rag") -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    ascii_text = ascii_text.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text).strip("-")
    return slug or fallback


def _normalize_tags(raw_tags: Any) -> list[str]:
    if isinstance(raw_tags, list):
        tags = [str(tag).strip() for tag in raw_tags if str(tag).strip()]
        if tags:
            return tags[:30]
    return ["ufabc"]


def _normalize_keywords(raw_keywords: Any) -> list[str]:
    if isinstance(raw_keywords, list):
        keywords = [str(item).strip() for item in raw_keywords if str(item).strip()]
        if keywords:
            return keywords[:40]
    return ["ufabc"]


def _safe_int(raw_value: Any, default: int = 1) -> int:
    if raw_value in (None, ""):
        return default
    try:
        return max(1, int(float(str(raw_value).strip().replace(",", "."))))
    except (TypeError, ValueError):
        return default


def _normalize_metadata(payload: dict[str, Any], source_text: str) -> dict[str, Any]:
    today_iso = date.today().isoformat()
    title = str(payload.get("titulo") or payload.get("title") or "Documento UFABC").strip()
    if not title:
        title = "Documento UFABC"

    document_id = str(payload.get("id") or _slugify(title)).strip()
    metadata: dict[str, Any] = {
        "id": _slugify(document_id),
        "titulo": title,
        "resumo": str(payload.get("resumo") or source_text[:300]).strip() or source_text[:300].strip(),
        "tipo": str(payload.get("tipo") or "informativo").strip() or "informativo",
        "dominio": str(payload.get("dominio") or "institucional").strip() or "institucional",
        "subdominio": str(payload.get("subdominio") or "geral").strip() or "geral",
        "intencao": str(payload.get("intencao") or "informar").strip() or "informar",
        "publico_alvo": str(payload.get("publico_alvo") or "estudantes").strip() or "estudantes",
        "versao": _safe_int(payload.get("versao"), 1),
        "status": str(payload.get("status") or "ativo").strip() or "ativo",
        "idioma": str(payload.get("idioma") or "pt-BR").strip() or "pt-BR",
        "tags": _normalize_tags(payload.get("tags")),
        "palavras_chave": _normalize_keywords(payload.get("palavras_chave")),
        "fonte": str(payload.get("fonte") or "documento_transformado").strip() or "documento_transformado",
        "autor": str(payload.get("autor") or "ufabc").strip() or "ufabc",
        "confiabilidade": str(payload.get("confiabilidade") or "media").strip() or "media",
        "relacionados": payload.get("relacionados") if isinstance(payload.get("relacionados"), list) else [],
        "atualizado_em": str(payload.get("atualizado_em") or today_iso).strip() or today_iso,
        "criado_em": str(payload.get("criado_em") or today_iso).strip() or today_iso,
    }
    return metadata


def _build_markdown(metadata: dict[str, Any], body_markdown: str) -> str:
    dumped = yaml.safe_dump(
        metadata,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
    ).strip()
    body = body_markdown.strip()
    if not body.startswith("# "):
        body = f"# {metadata['titulo']}\n\n{body}"

    return f"---\n{dumped}\n---\n\n{body}\n"


def _extract_json_object(raw_content: str) -> dict[str, Any]:
    text = raw_content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("Model response must be a JSON object.")
    return parsed


async def _transform_text_with_openai(source_text: str, settings: Settings) -> tuple[str, dict[str, Any]]:
    if AsyncOpenAI is None or not settings.openai_api_key:
        raise RuntimeError(
            "OpenAI API nao configurada. Defina OPENAI_API_KEY e instale o pacote openai."
        )

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    system_prompt = (
        "Voce transforma texto bruto no padrao RAG em portugues (pt-BR). "
        "Responda somente JSON valido com as chaves: "
        "metadata (objeto) e body_markdown (string). "
        "Metadata deve incluir id, titulo, resumo, tipo, dominio, subdominio, intencao, "
        "publico_alvo, versao, status, idioma, tags, palavras_chave, fonte, autor, "
        "confiabilidade, relacionados, atualizado_em e criado_em. "
        "O body deve iniciar com titulo H1 e secoes claras."
    )
    user_prompt = (
        "Converta o texto abaixo para um documento RAG pronto para ingestao.\n\n"
        f"{source_text}"
    )

    response = await client.chat.completions.create(
        model=INGESTION_MODEL,
        temperature=0.2,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )

    message = response.choices[0].message if response.choices else None
    content = (message.content or "").strip() if message else ""
    if not content:
        raise RuntimeError("OpenAI retornou resposta vazia.")

    parsed = _extract_json_object(content)
    raw_metadata = parsed.get("metadata")
    if not isinstance(raw_metadata, dict):
        raise RuntimeError("Resposta da OpenAI nao trouxe 'metadata' em formato objeto.")

    body_markdown = str(parsed.get("body_markdown") or "").strip()
    if not body_markdown:
        raise RuntimeError("Resposta da OpenAI nao trouxe 'body_markdown'.")

    return body_markdown, raw_metadata


@router.post(
    "/ingestion/prepare",
    response_model=IngestionPrepareResponse,
)
async def prepare_ingestion(
    payload: IngestionPrepareRequest,
    settings: Settings = Depends(get_settings),
) -> IngestionPrepareResponse:
    source_text = payload.source_text.strip()
    if not source_text:
        raise HTTPException(status_code=400, detail="source_text is required.")

    try:
        body_markdown, model_metadata = await _transform_text_with_openai(source_text, settings)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Falha ao transformar texto com OpenAI: {type(exc).__name__}: {exc}",
        ) from exc

    try:
        metadata = _normalize_metadata(model_metadata, source_text)
        markdown_text = _build_markdown(metadata, body_markdown)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Falha ao normalizar resposta da OpenAI: {type(exc).__name__}: {exc}",
        ) from exc

    try:
        parsed_metadata = FileFeedService._extract_document_metadata(markdown_text.encode("utf-8"))
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Markdown gerado nao passou na validacao RAG: {exc}",
        ) from exc

    suggested_filename = f"{_slugify(parsed_metadata.id)}.md"
    return IngestionPrepareResponse(
        markdown_text=markdown_text,
        suggested_filename=suggested_filename,
        metadata=parsed_metadata,
        model=INGESTION_MODEL,
    )


@router.post(
    "/ingestion/commit",
    response_model=IngestionCommitResponse,
    status_code=status.HTTP_201_CREATED,
)
async def commit_ingestion(
    payload: IngestionCommitRequest,
    service: FileFeedService = Depends(get_file_feed_service),
    current_user: UserRecord = Depends(get_current_user),
) -> IngestionCommitResponse:
    filename = Path(payload.filename).name.strip()
    if not filename:
        raise HTTPException(status_code=400, detail="filename is required.")
    if not filename.lower().endswith(".md"):
        filename = f"{filename}.md"

    incoming = IncomingFeedFile(
        filename=filename,
        content_type="text/markdown",
        content=payload.markdown_text.encode("utf-8"),
    )
    try:
        enriched_storage_metadata = dict(payload.storage_metadata)
        enriched_storage_metadata["audit_uploaded_by"] = current_user.email
        enriched_storage_metadata["audit_last_modified_by"] = current_user.email
        record = await service.ingest(
            incoming,
            storage_metadata=enriched_storage_metadata,
            folder_path=payload.folder_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_upload_error_message(exc)) from exc

    return IngestionCommitResponse(file=_to_file_response(record))
