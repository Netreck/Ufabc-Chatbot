from fastapi.testclient import TestClient


VALID_MARKDOWN = """---
id: regulamento-ufabc-2026
titulo: Regulamento Geral UFABC
tipo: regulamento
dominio: academico
subdominio: matricula
versao: 1
status: ativo
tags:
  - ufabc
  - matricula
  - regulamento
fonte: documento_oficial
atualizado_em: 2026-03-22
---

# Regulamento Geral UFABC

## Sumario
1. Disposicoes gerais
2. Matricula

## 1. Disposicoes gerais
Conteudo.
"""


def test_file_feed_upload_list_download_and_status_update(client: TestClient) -> None:
    upload_response = client.post(
        "/api/v1/files/feed",
        files={"file": ("regulamento-matricula.md", VALID_MARKDOWN, "text/markdown")},
        data={"storage_metadata": '{"seaweed_collection":"ufabc-rag"}'},
    )
    assert upload_response.status_code == 201

    uploaded = upload_response.json()
    file_id = uploaded["id"]
    assert uploaded["status"] == "pending"
    assert uploaded["folder_path"] == ""
    assert uploaded["document_metadata"]["id"] == "regulamento-ufabc-2026"
    assert uploaded["storage_metadata"]["seaweed_collection"] == "ufabc-rag"

    create_folder_response = client.post(
        "/api/v1/files/folders",
        json={"path": "regulamentos/2026"},
    )
    assert create_folder_response.status_code == 201
    assert create_folder_response.json()["path"] == "regulamentos/2026"

    move_response = client.patch(
        f"/api/v1/files/feed/{file_id}/move",
        json={"target_folder_path": "regulamentos/2026"},
    )
    assert move_response.status_code == 200
    moved = move_response.json()
    assert moved["folder_path"] == "regulamentos/2026"
    assert moved["stored_filename"].startswith("regulamentos/2026/")

    list_response = client.get("/api/v1/files/feed")
    assert list_response.status_code == 200
    assert any(item["id"] == file_id for item in list_response.json())

    tree_response = client.get("/api/v1/files/tree")
    assert tree_response.status_code == 200
    tree_payload = tree_response.json()
    assert any(folder["path"] == "regulamentos/2026" for folder in tree_payload["folders"])
    assert any(item["id"] == file_id for item in tree_payload["files"])

    download_response = client.get(f"/api/v1/files/feed/{file_id}/download")
    assert download_response.status_code == 200
    assert download_response.text == VALID_MARKDOWN

    preview_response = client.get(f"/api/v1/files/feed/{file_id}/preview")
    assert preview_response.status_code == 200
    preview_payload = preview_response.json()
    assert preview_payload["id"] == file_id
    assert preview_payload["document_metadata"]["id"] == "regulamento-ufabc-2026"
    assert "Regulamento Geral UFABC" in preview_payload["markdown_text"]

    update_response = client.patch(
        f"/api/v1/files/feed/{file_id}/status",
        json={"status": "indexed"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["status"] == "indexed"

    delete_response = client.delete(f"/api/v1/files/feed/{file_id}")
    assert delete_response.status_code == 204

    list_after_delete_response = client.get("/api/v1/files/feed")
    assert list_after_delete_response.status_code == 200
    assert all(item["id"] != file_id for item in list_after_delete_response.json())


def test_empty_file_is_rejected(client: TestClient) -> None:
    upload_response = client.post(
        "/api/v1/files/feed",
        files={"file": ("empty.txt", b"", "text/plain")},
    )
    assert upload_response.status_code == 400


def test_markdown_without_front_matter_is_rejected(client: TestClient) -> None:
    upload_response = client.post(
        "/api/v1/files/feed",
        files={"file": ("bad.md", "# Sem front matter\n\nTexto", "text/markdown")},
    )
    assert upload_response.status_code == 400


def test_non_markdown_file_is_rejected(client: TestClient) -> None:
    upload_response = client.post(
        "/api/v1/files/feed",
        files={"file": ("bad.txt", b"plain text", "text/plain")},
    )
    assert upload_response.status_code == 400


def test_front_matter_date_with_slashes_is_accepted(client: TestClient) -> None:
    markdown = VALID_MARKDOWN.replace("2026-03-22", "22/03/2026")
    upload_response = client.post(
        "/api/v1/files/feed",
        files={"file": ("regulamento-matricula.md", markdown, "text/markdown")},
    )
    assert upload_response.status_code == 201
    payload = upload_response.json()
    assert payload["document_metadata"]["atualizado_em"] == "2026-03-22"
