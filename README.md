# UFABC Chatbot

Backend + frontend scaffold for UFABC chatbot workflows with a dedicated file-feed API for an external RAG vector database pipeline.

## Project Structure

```
.
├── docker-compose.yml
├── docker
│   ├── backend
│   └── frontend
├── docs
├── frontend
├── pyproject.toml
├── src/ufabc_chatbot
│   ├── application
│   ├── core
│   ├── domain
│   ├── infrastructure
│   ├── presentation
│   └── main.py
└── tests
```

## Docker (Frontend + Backend + Database + Seaweed)

```bash
cp .env.example .env
docker compose up --build
```

If you already have an older `file_feed_items` table/volume from a previous schema, reset volumes once:

```bash
docker compose down -v
docker compose up --build
```

- Frontend: `http://localhost:8080`
- Backend API: `http://localhost:8000`
- Backend docs: `http://localhost:8000/docs`
- PostgreSQL: `localhost:5433`
- Seaweed S3 endpoint: `http://localhost:8333`
- Seaweed filer UI: `http://localhost:8888`
- Seaweed master UI: `http://localhost:9333`

In Docker, the backend is configured to use Seaweed as feed storage (`FEED_STORAGE_BACKEND=seaweed`).
Seaweed credentials are local-only and configured in [docker/seaweed/s3-config.json](/Users/gabriel_goncalves/Desktop/UFABC/ChatBot/Ufabc-Chatbot/docker/seaweed/s3-config.json).

## File Feed API

- `POST /api/v1/files/feed` upload one Markdown file (`multipart/form-data`)
- `GET /api/v1/files/feed` list uploaded files
- `GET /api/v1/files/tree` list filesystem tree (folders + files)
- `POST /api/v1/files/folders` create folder path
- `GET /api/v1/files/feed/{file_id}/download` download raw file content
- `GET /api/v1/files/feed/{file_id}/preview` return metadata + markdown text for UI inspection
- `GET /api/v1/files/feed/{file_id}/preview/frame` html preview for iframe
- `PATCH /api/v1/files/feed/{file_id}/move` move file to target folder path
- `PATCH /api/v1/files/feed/{file_id}/status` set status (`pending`, `processing`, `indexed`, `failed`)
- `DELETE /api/v1/files/feed/{file_id}` remove file from queue and storage

### Upload contract (`POST /api/v1/files/feed`)

Required form fields:
- `file`: must be `.md`, UTF-8 encoded, with YAML front matter at the top.

Optional form fields:
- `storage_metadata`: JSON object string for storage-level metadata (useful for Seaweed-native metadata).
- `folder_path`: bucket folder path where this file should be stored (filesystem mode).

Stored metadata behavior:
- `document_metadata` extracted from front matter is persisted in PostgreSQL.
- A normalized metadata projection is also written as object metadata on Seaweed S3.
- Any custom `storage_metadata` sent in upload is merged and sent to Seaweed S3 metadata as well.

Required front matter keys:
- `id`
- `titulo`
- `tipo`
- `dominio`
- `subdominio`
- `versao`
- `status`
- `tags`
- `fonte`
- `atualizado_em`

See detailed format in [docs/rag-file-preparation.md](/Users/gabriel_goncalves/Desktop/UFABC/ChatBot/Ufabc-Chatbot/docs/rag-file-preparation.md).

This feed API is intentionally focused on ingestion handoff and preparation. It does not run retrieval or vector search inside this project.

## Frontend Filesystem Queue

- The feed queue is shown as a filesystem-style tree for the Seaweed bucket.
- You can create folders, upload directly to the selected folder, and drag files onto folders to move them.
- File preview opens inside an iframe using `GET /api/v1/files/feed/{file_id}/preview/frame`.

## Existing Chat API

- `POST /api/v1/chat` uses OpenAI when `OPENAI_API_KEY` is configured.
- Without key, it falls back to a local stub response for smoke tests.
- You can pass `context_file_ids` to include selected feed files as context in smoke test chat.

## Testing

```bash
pytest -q
```
