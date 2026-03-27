# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY pyproject.toml README.md /app/

RUN --mount=type=cache,target=/root/.cache/pip \
    python - <<'PY' > /tmp/requirements.txt
import tomllib
from pathlib import Path

project = tomllib.loads(Path("/app/pyproject.toml").read_text())["project"]
for dep in project.get("dependencies", []):
    print(dep)
PY

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install -r /tmp/requirements.txt

COPY src /app/src

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-deps .

EXPOSE 8000

CMD ["uvicorn", "ufabc_chatbot.main:app", "--host", "0.0.0.0", "--port", "8000"]
