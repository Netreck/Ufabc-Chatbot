from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

FileFeedStatus = Literal["pending", "processing", "indexed", "failed"]


class RAGDocumentMetadata(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    titulo: str = Field(min_length=1, max_length=255)
    resumo: str = Field(min_length=1, max_length=1200)
    tipo: str = Field(min_length=1, max_length=120)
    dominio: str = Field(min_length=1, max_length=120)
    subdominio: str = Field(min_length=1, max_length=120)
    intencao: str = Field(min_length=1, max_length=120)
    publico_alvo: str = Field(min_length=1, max_length=120)
    versao: int = Field(ge=1)
    status: str = Field(min_length=1, max_length=60)
    idioma: str = Field(min_length=2, max_length=20)
    tags: list[str] = Field(min_length=1, max_length=30)
    palavras_chave: list[str] = Field(min_length=1, max_length=40)
    fonte: str = Field(min_length=1, max_length=120)
    autor: str = Field(min_length=1, max_length=120)
    confiabilidade: str = Field(min_length=1, max_length=60)
    relacionados: list[str] = Field(default_factory=list, max_length=40)
    atualizado_em: date
    criado_em: date

    model_config = ConfigDict(extra="allow")

    @staticmethod
    def _parse_date_field(value: Any, field_name: str) -> date:
        if isinstance(value, date):
            return value

        if isinstance(value, datetime):
            return value.date()

        if not isinstance(value, str):
            raise ValueError(f"{field_name} must be a date string in YYYY-MM-DD format.")

        cleaned = (
            value.strip()
            .replace("\u2011", "-")
            .replace("\u2013", "-")
            .replace("\u2014", "-")
            .replace("\u2212", "-")
        )

        try:
            return date.fromisoformat(cleaned)
        except ValueError:
            pass

        try:
            return datetime.strptime(cleaned, "%d/%m/%Y").date()
        except ValueError as exc:
            raise ValueError(
                f"{field_name} must be YYYY-MM-DD (or DD/MM/YYYY). Received: {value!r}"
            ) from exc

    @field_validator("atualizado_em", mode="before")
    @classmethod
    def validate_atualizado_em(cls, value: Any) -> date:
        return cls._parse_date_field(value, "atualizado_em")

    @field_validator("criado_em", mode="before")
    @classmethod
    def validate_criado_em(cls, value: Any) -> date:
        return cls._parse_date_field(value, "criado_em")


class FileFeedCreate(BaseModel):
    id: UUID
    original_filename: str = Field(min_length=1, max_length=255)
    stored_filename: str = Field(min_length=1, max_length=255)
    content_type: str | None = Field(default=None, max_length=255)
    size_bytes: int = Field(gt=0)
    status: FileFeedStatus = "pending"
    document_metadata: RAGDocumentMetadata
    storage_metadata: dict[str, Any] = Field(default_factory=dict)


class FileFeedRecord(FileFeedCreate):
    created_at: datetime
