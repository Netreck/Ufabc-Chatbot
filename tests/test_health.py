from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_chat_stub(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        "/api/v1/chat",
        json={"messages": [{"role": "user", "content": "Oi"}]},
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert "reply" in response.json()


def test_chat_with_context_files(client: TestClient, auth_headers: dict[str, str]) -> None:
    markdown = """---
id: faq-bolsas-2026
titulo: FAQ Bolsas UFABC
resumo: Perguntas e respostas sobre bolsas da UFABC.
tipo: faq
dominio: academico
subdominio: bolsas
intencao: explicar_bolsas
publico_alvo: estudantes
versao: 1
status: ativo
idioma: pt-BR
tags:
  - ufabc
  - bolsas
palavras_chave:
  - bolsa permanencia
  - edital
fonte: documento_oficial
autor: ufabc
confiabilidade: alta
relacionados:
  - editais-bolsas
atualizado_em: 2026-03-22
criado_em: 2026-01-15
---

# FAQ Bolsas UFABC

Bolsa permanencia tem edital anual.
"""
    upload_response = client.post(
        "/api/v1/files/feed",
        files={"file": ("faq-bolsas.md", markdown, "text/markdown")},
        headers=auth_headers,
    )
    assert upload_response.status_code == 201
    file_id = upload_response.json()["id"]

    response = client.post(
        "/api/v1/chat",
        json={
            "messages": [{"role": "user", "content": "Quais bolsas existem?"}],
            "context_file_ids": [file_id],
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert "reply" in payload
    assert payload["context_files_loaded"] == [file_id]
