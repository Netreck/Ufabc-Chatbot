# RAG File Preparation Guide (Agentic Ready)

Este documento define o padrão para criação, estruturação e armazenamento de arquivos antes da etapa de vetorização (embeddings) em pipelines de **RAG e Agentic RAG**.

---

## Objetivos

- Maximizar compreensão semântica
- Melhorar recuperação contextual (retrieval)
- Facilitar reasoning por agentes
- Garantir consistência e versionamento
- Otimizar chunking automático
- Permitir composição de respostas multi-documento

---

## Princípios Fundamentais

### 1. Documento ≠ Chunk

- **Documento**: unidade semântica completa e autocontida  
- **Chunk**: unidade técnica gerada no pipeline  

👉 Nunca criar chunks manualmente  
👉 Sempre estruturar documentos de forma lógica e navegável  

---

### 2. Um Documento = Uma Intenção Clara

Cada documento deve responder:

> “Qual pergunta este documento resolve?”

**Exemplos corretos:**
- `como-funciona-matricula.md`
- `regras-trancamento-curso.md`

**Incorreto:**
- `tudo-sobre-universidade.md`

---

### 3. Pensar em "Agent Readability"

Documentos devem ser compreensíveis para:
- LLMs
- agentes autônomos
- pipelines de reasoning

👉 Evitar:
- ambiguidade
- contexto implícito
- dependência de outros arquivos

👉 Priorizar:
- clareza
- redundância útil
- contexto explícito

---

### 4. Markdown como formato padrão

Formato principal: `.md`

Opcional:
- `.json` / `.yaml` (metadados externos)

Evitar ingestão direta de:
- PDF
- DOCX
- XLSX

👉 Sempre converter antes

---

## Estrutura Obrigatória (Agentic Format)

```md
---
id: regulamento-ufabc-2026

titulo: Regulamento Geral UFABC
resumo: Define regras gerais de matrícula, avaliação e funcionamento acadêmico da UFABC.

tipo: regulamento
dominio: academico
subdominio: matricula

intencao: explicar_regras_academicas
publico_alvo: estudantes

versao: 2
status: ativo

idioma: pt-BR

tags:
  - ufabc
  - matricula
  - regulamento

palavras_chave:
  - matrícula
  - trancamento
  - avaliação

fonte: documento_oficial
autor: ufabc
confiabilidade: alta

relacionados:
  - fluxo-matricula
  - prazos-academicos

atualizado_em: 2026-03-22
criado_em: 2026-01-10
---

# Regulamento Geral UFABC

## Resumo Executivo
Este documento apresenta as regras gerais da UFABC sobre matrícula, avaliação e estrutura acadêmica.

## Quando usar este documento
Use este documento quando precisar entender regras oficiais da universidade relacionadas à vida acadêmica.

## Quando NÃO usar este documento
Não usar para:
- procedimentos operacionais detalhados (ver documentos de fluxo)
- calendários (ver prazos-academicos)

---

## Sumário
1. Disposições gerais
2. Matrícula
3. Avaliação

---

## 1. Disposições gerais
...

## 2. Matrícula
...

## 3. Avaliação
...

