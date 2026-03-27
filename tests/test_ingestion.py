from fastapi.testclient import TestClient


def test_ingestion_prepare_requires_openai(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/ingestion/prepare",
        json={
            "source_text": (
                "Este texto precisa ser convertido para o formato RAG de ingestao com "
                "metadados estruturados e secoes em markdown."
            ),
        },
        headers=auth_headers,
    )
    assert response.status_code == 503
    assert "OpenAI API nao configurada" in response.json()["detail"]


def test_ingestion_commit_uploads_markdown(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    markdown = """---
id: guia-ingestao-2026
titulo: Guia de Ingestao
resumo: Documento de ingestao para pipeline RAG.
tipo: guia
dominio: academico
subdominio: matricula
intencao: orientar_ingestao
publico_alvo: equipe_tecnica
versao: 1
status: ativo
idioma: pt-BR
tags:
  - ufabc
  - ingestao
palavras_chave:
  - ingestao
  - rag
fonte: documento_oficial
autor: ufabc
confiabilidade: alta
relacionados:
  - manual-rag
atualizado_em: 2026-03-25
criado_em: 2026-03-25
---

# Guia de Ingestao

## Objetivo
Documento preparado via endpoint de ingestao.
"""
    response = client.post(
        "/api/v1/ingestion/commit",
        json={
            "markdown_text": markdown,
            "filename": "guia-ingestao",
            "folder_path": "ingestao/2026",
            "storage_metadata": {"pipeline": "ingestion-ui"},
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    payload = response.json()["file"]
    assert payload["original_filename"] == "guia-ingestao.md"
    assert payload["folder_path"] == "ingestao/2026"
    assert payload["document_metadata"]["id"] == "guia-ingestao-2026"
    assert payload["storage_metadata"]["pipeline"] == "ingestion-ui"
