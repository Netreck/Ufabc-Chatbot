# Agents Guide

This file defines architecture rules and contributor responsibilities for the UFABC chatbot project.

## Scope Right Now

- Keep `Python + FastAPI` as backend stack.
- Do not implement retrieval/vector search logic in this repository yet.
- Implement and maintain a file-feed workflow that another system can consume to build/update the vector database.
- Keep deployment split into separate `frontend`, `backend`, `database`, and `seaweed` containers.
- Enforce Markdown front matter for feed documents following `docs/rag-file-preparation.md`.

## Architecture Style

Use layered clean architecture with strict dependency direction:

1. `presentation` depends on `application`
2. `application` depends on `domain`
3. `infrastructure` implements contracts declared in `application`
4. `domain` depends on no framework or external SDK

## Folder Contracts

- `src/ufabc_chatbot/domain`
  - Pure models/rules (`chat`, `file feed records`, `status types`).
- `src/ufabc_chatbot/application`
  - Use cases and contracts (LLM provider, file-feed repository/storage ports).
- `src/ufabc_chatbot/infrastructure`
  - Adapters for OpenAI stub, SQLAlchemy persistence, local file storage, Seaweed S3 storage.
- `src/ufabc_chatbot/presentation`
  - HTTP endpoints and request/response schemas.
- `src/ufabc_chatbot/core`
  - Settings and dependency assembly.
- `frontend`
  - UI for upload/list/download/status operations.

## Agent Responsibilities

- Architecture Agent
  - Protect layer boundaries and dependency direction.
  - Prevent direct SDK/database usage inside route handlers.
- API Agent
  - Keep handlers thin and delegate behavior to application services.
- Data Agent
  - Own database schema and repository adapters.
  - Keep persistence objects out of domain/application APIs.
- Feed Agent
  - Own file ingestion workflow and feed lifecycle statuses.
  - Preserve compatibility for external vector DB consumers.
  - Enforce required document metadata keys in front matter.
  - Keep support for optional `storage_metadata` used by Seaweed-native metadata.
- Frontend Agent
  - Keep frontend focused on feed operations and API health checks.
- QA Agent
  - Maintain endpoint tests and service contract coverage.

## Quality Gates

- Every API endpoint must have at least one automated test.
- File feed uploads must persist metadata and raw content.
- File feed uploads must reject invalid/missing YAML front matter.
- `presentation` must not instantiate database drivers or external SDK clients directly.
- Config must be environment-based.
- Docker compose must keep frontend/backend/database as distinct services.
- Docker compose must include Seaweed service when feed backend is configured as Seaweed.

## Next Milestones

1. Add authenticated API access (token-based or JWT).
2. Add file validation policies (MIME allowlist, antivirus hook, max count per request).
3. Add event/webhook or queue output so the external vector DB system can consume feed changes automatically.
4. Replace chat stub provider with a real OpenAI provider adapter.
