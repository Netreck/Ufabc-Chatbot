# RAG File Preparation Guide

Este documento define o padrao para armazenamento e organizacao de arquivos antes da etapa de vetorizacao (embeddings) no pipeline de RAG.

Objetivos:
- dados semanticamente claros
- dados consistentes
- dados versionaveis
- chunking eficiente no pipeline
- uso por agentes (Agentic RAG)

## Principios Fundamentais

### 1. Documento != Chunk

- Documento e a unidade semantica completa.
- Chunk e a unidade de busca gerada no pipeline.

Nao dividir documentos manualmente em chunks. Manter documentos completos e estruturados.

### 2. Um Documento = Um Assunto

Cada arquivo deve responder uma pergunta clara ou cobrir um unico tema.

Correto:
- `regulamento-matricula.md`
- `fluxo-trancamento.md`

Incorreto:
- `documentacao-geral.md` com varios assuntos misturados.

### 3. Markdown como formato padrao

Usar `.md` como formato principal.

Opcional:
- `.json` ou `.yaml` para metadados adicionais externos

Evitar enviar diretamente:
- PDF
- DOCX
- XLSX

Esses formatos devem ser convertidos para Markdown antes do upload.

## Estrutura Obrigatoria

Todos os documentos devem seguir este padrao:

```md
---
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
3. Avaliacao

## 1. Disposicoes gerais
...

## 2. Matricula
...

## 3. Avaliacao
...
```

## Metadados para Seaweed

Se o Seaweed estiver em uso, enviar `storage_metadata` no upload como JSON (`multipart/form-data`).

Exemplo:

```json
{
  "seaweed_collection": "ufabc-rag",
  "seaweed_replication": "001"
}
```

O backend combina:
- metadados obrigatorios extraidos do front matter
- metadados adicionais enviados em `storage_metadata`

Assim o sistema externo pode usar metadados nativos do Seaweed sem perder o padrao semantico dos documentos.
