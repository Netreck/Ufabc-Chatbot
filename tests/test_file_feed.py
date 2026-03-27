from fastapi.testclient import TestClient
from sqlalchemy import insert

from ufabc_chatbot.core.dependencies import get_engine
from ufabc_chatbot.infrastructure.db.models import FileFeedItemORM


VALID_MARKDOWN = """---
id: regulamento-ufabc-2026
titulo: Regulamento Geral UFABC
resumo: Regras gerais de matricula e avaliacao da universidade.
tipo: regulamento
dominio: academico
subdominio: matricula
intencao: explicar_regras_academicas
publico_alvo: estudantes
versao: 1
status: ativo
idioma: pt-BR
tags:
  - ufabc
  - matricula
  - regulamento
palavras_chave:
  - matricula
  - trancamento
fonte: documento_oficial
autor: ufabc
confiabilidade: alta
relacionados:
  - fluxo-matricula
atualizado_em: 2026-03-22
criado_em: 2026-01-10
---

# Regulamento Geral UFABC

## Sumario
1. Disposicoes gerais
2. Matricula

## 1. Disposicoes gerais
Conteudo.
"""

UPDATED_MARKDOWN = """---
id: regulamento-ufabc-2026
titulo: Regulamento Geral UFABC
resumo: Regras gerais de matricula e avaliacao da universidade.
tipo: guia
dominio: academico
subdominio: matricula
intencao: explicar_regras_academicas
publico_alvo: estudantes
versao: 2
status: ativo
idioma: pt-BR
tags:
  - ufabc
  - atualizado
  - aprovacao
palavras_chave:
  - aprovacao
  - fluxo
fonte: documento_oficial
autor: ufabc
confiabilidade: alta
relacionados:
  - fluxo-matricula
atualizado_em: 2026-03-27
criado_em: 2026-01-10
---

# Regulamento Geral UFABC

## Sumario
1. Disposicoes gerais
2. Matricula

## 1. Disposicoes gerais
Conteudo atualizado.
"""


def test_file_feed_upload_list_download_and_status_update(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    upload_response = client.post(
        "/api/v1/files/feed",
        files={"file": ("regulamento-matricula.md", VALID_MARKDOWN, "text/markdown")},
        data={"storage_metadata": '{"seaweed_collection":"ufabc-rag"}'},
        headers=auth_headers,
    )
    assert upload_response.status_code == 201

    uploaded = upload_response.json()
    file_id = uploaded["id"]
    assert uploaded["status"] == "pending"
    assert uploaded["folder_path"] == ""
    assert uploaded["document_metadata"]["id"] == "regulamento-ufabc-2026"
    assert uploaded["storage_metadata"]["seaweed_collection"] == "ufabc-rag"
    assert uploaded["storage_metadata"]["audit_uploaded_by"] == "admin@test.com"
    assert uploaded["storage_metadata"]["audit_last_modified_by"] == "admin@test.com"

    create_folder_response = client.post(
        "/api/v1/files/folders",
        json={"path": "regulamentos/2026"},
        headers=auth_headers,
    )
    assert create_folder_response.status_code == 201
    assert create_folder_response.json()["path"] == "regulamentos/2026"

    move_response = client.patch(
        f"/api/v1/files/feed/{file_id}/move",
        json={"target_folder_path": "regulamentos/2026"},
        headers=auth_headers,
    )
    assert move_response.status_code == 200
    moved = move_response.json()
    assert moved["folder_path"] == "regulamentos/2026"
    assert moved["stored_filename"].startswith("regulamentos/2026/")

    list_response = client.get("/api/v1/files/feed", headers=auth_headers)
    assert list_response.status_code == 200
    assert any(item["id"] == file_id for item in list_response.json())

    tree_response = client.get("/api/v1/files/tree", headers=auth_headers)
    assert tree_response.status_code == 200
    tree_payload = tree_response.json()
    assert any(folder["path"] == "regulamentos/2026" for folder in tree_payload["folders"])
    assert any(item["id"] == file_id for item in tree_payload["files"])

    download_response = client.get(
        f"/api/v1/files/feed/{file_id}/download", headers=auth_headers
    )
    assert download_response.status_code == 200
    assert download_response.text == VALID_MARKDOWN

    preview_response = client.get(
        f"/api/v1/files/feed/{file_id}/preview", headers=auth_headers
    )
    assert preview_response.status_code == 200
    preview_payload = preview_response.json()
    assert preview_payload["id"] == file_id
    assert preview_payload["document_metadata"]["id"] == "regulamento-ufabc-2026"
    assert "Regulamento Geral UFABC" in preview_payload["markdown_text"]

    update_response = client.patch(
        f"/api/v1/files/feed/{file_id}/status",
        json={"status": "indexed"},
        headers=auth_headers,
    )
    assert update_response.status_code == 200
    assert update_response.json()["status"] == "indexed"
    assert update_response.json()["storage_metadata"]["audit_approved_by"] == "admin@test.com"

    delete_response = client.delete(
        f"/api/v1/files/feed/{file_id}", headers=auth_headers
    )
    assert delete_response.status_code == 204

    list_after_delete_response = client.get("/api/v1/files/feed", headers=auth_headers)
    assert list_after_delete_response.status_code == 200
    assert all(item["id"] != file_id for item in list_after_delete_response.json())


def test_empty_file_is_rejected(client: TestClient, auth_headers: dict[str, str]) -> None:
    upload_response = client.post(
        "/api/v1/files/feed",
        files={"file": ("empty.txt", b"", "text/plain")},
        headers=auth_headers,
    )
    assert upload_response.status_code == 400


def test_update_content_refreshes_document_and_storage_metadata(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    upload_response = client.post(
        "/api/v1/files/feed",
        files={"file": ("regulamento-matricula.md", VALID_MARKDOWN, "text/markdown")},
        data={"storage_metadata": '{"tenant":"qa"}'},
        headers=auth_headers,
    )
    assert upload_response.status_code == 201
    file_id = upload_response.json()["id"]

    update_response = client.patch(
        f"/api/v1/files/feed/{file_id}/content",
        json={"markdown_text": UPDATED_MARKDOWN},
        headers=auth_headers,
    )
    assert update_response.status_code == 204

    preview_response = client.get(
        f"/api/v1/files/feed/{file_id}/preview",
        headers=auth_headers,
    )
    assert preview_response.status_code == 200
    payload = preview_response.json()

    assert payload["document_metadata"]["versao"] == 2
    assert payload["document_metadata"]["tipo"] == "guia"
    assert payload["document_metadata"]["tags"] == ["ufabc", "atualizado", "aprovacao"]
    assert payload["storage_metadata"]["document_tipo"] == "guia"
    assert payload["storage_metadata"]["tenant"] == "qa"
    assert payload["storage_metadata"]["audit_uploaded_by"] == "admin@test.com"
    assert payload["storage_metadata"]["audit_last_modified_by"] == "admin@test.com"


def test_markdown_without_front_matter_is_rejected(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    upload_response = client.post(
        "/api/v1/files/feed",
        files={"file": ("bad.md", "# Sem front matter\n\nTexto", "text/markdown")},
        headers=auth_headers,
    )
    assert upload_response.status_code == 400


def test_non_markdown_file_is_rejected(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    upload_response = client.post(
        "/api/v1/files/feed",
        files={"file": ("bad.txt", b"plain text", "text/plain")},
        headers=auth_headers,
    )
    assert upload_response.status_code == 400


def test_front_matter_date_with_slashes_is_accepted(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    markdown = VALID_MARKDOWN.replace("2026-03-22", "22/03/2026")
    upload_response = client.post(
        "/api/v1/files/feed",
        files={"file": ("regulamento-matricula.md", markdown, "text/markdown")},
        headers=auth_headers,
    )
    assert upload_response.status_code == 201
    payload = upload_response.json()
    assert payload["document_metadata"]["atualizado_em"] == "2026-03-22"


def test_old_metadata_structure_is_rejected(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    old_schema_markdown = """---
id: antigo
titulo: Documento Antigo
tipo: faq
dominio: academico
subdominio: geral
versao: 1
status: ativo
tags:
  - ufabc
fonte: documento_oficial
atualizado_em: 2026-03-25
---

# Documento Antigo

Conteudo.
"""
    upload_response = client.post(
        "/api/v1/files/feed",
        files={"file": ("old-schema.md", old_schema_markdown, "text/markdown")},
        headers=auth_headers,
    )
    assert upload_response.status_code == 400


def test_list_tree_handles_legacy_metadata_records(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    async def seed_legacy_record() -> None:
        engine = get_engine()
        async with engine.begin() as conn:
            await conn.execute(
                insert(FileFeedItemORM).values(
                    id="11111111-1111-1111-1111-111111111111",
                    original_filename="legacy.md",
                    stored_filename="legacy/legacy.md",
                    content_type="text/markdown",
                    size_bytes=120,
                    status="pending",
                    document_metadata={
                        "id": "legacy-doc",
                        "titulo": "Legacy",
                        "tipo": "faq",
                        "dominio": "academico",
                        "subdominio": "geral",
                        "versao": 1,
                        "status": "ativo",
                        "tags": ["ufabc"],
                        "fonte": "documento_oficial",
                        "atualizado_em": "data-invalida",
                        "criado_em": "",
                    },
                    storage_metadata={},
                )
            )

    import asyncio
    asyncio.run(seed_legacy_record())

    response = client.get("/api/v1/files/tree", headers=auth_headers)
    assert response.status_code == 200
    payload = response.json()
    item = next((f for f in payload["files"] if f["id"] == "11111111-1111-1111-1111-111111111111"), None)
    assert item is not None
    assert item["document_metadata"]["titulo"] == "Legacy"
