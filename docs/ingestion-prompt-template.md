# Prompt Template — TXT/Text -> RAG Markdown (UFABC)

Este prompt e baseado no guia [rag-file-preparation.md](/Users/gabriel_goncalves/Desktop/UFABC/ChatBot/Ufabc-Chatbot/docs/rag-file-preparation.md) para transformar texto bruto em documento pronto para ingestao.

## System Prompt

```text
Voce transforma texto bruto no padrao RAG em portugues (pt-BR), seguindo estritamente o modelo de preparacao de arquivos da UFABC.

Responda SOMENTE em JSON valido (sem markdown, sem comentarios) com as chaves:
- metadata (objeto)
- body_markdown (string)

Regras obrigatorias para metadata:
- id: slug curto e estavel (kebab-case)
- titulo: titulo claro
- resumo: resumo executivo
- tipo, dominio, subdominio
- intencao
- publico_alvo
- versao (inteiro >= 1)
- status
- idioma (use pt-BR)
- tags (lista de strings)
- palavras_chave (lista de strings)
- fonte
- autor
- confiabilidade
- relacionados (lista de ids relacionados, pode ser vazia)
- atualizado_em (YYYY-MM-DD)
- criado_em (YYYY-MM-DD)

Regras obrigatorias para body_markdown:
- deve iniciar com "# <titulo>"
- incluir secoes claras e navegaveis
- incluir "Resumo Executivo", "Quando usar este documento" e "Quando NAO usar este documento"
- manter contexto explicito e evitar ambiguidades
- nao inventar fatos nao suportados pelo texto de entrada
```

## User Prompt Template

```text
Converta o texto abaixo para um documento RAG pronto para ingestao:

<TEXTO_BRUTO_AQUI>
```

## Exemplo de formato esperado (JSON)

```json
{
  "metadata": {
    "id": "orientacoes-matriculas-2026-2q",
    "titulo": "Orientacoes para Matriculas em Disciplinas - 2Q 2026",
    "resumo": "Resumo do processo e regras de matricula para o segundo quadrimestre de 2026.",
    "tipo": "instrucao",
    "dominio": "academico",
    "subdominio": "matricula",
    "intencao": "informar_procedimento",
    "publico_alvo": "estudantes_ufabc",
    "versao": 1,
    "status": "ativo",
    "idioma": "pt-BR",
    "tags": ["ufabc", "matricula", "disciplinas", "2026"],
    "palavras_chave": ["matricula", "ajuste", "vagas", "ingressantes"],
    "fonte": "prograd_ufabc",
    "autor": "prograd_ufabc",
    "confiabilidade": "alta",
    "relacionados": [],
    "atualizado_em": "2026-03-25",
    "criado_em": "2026-03-25"
  },
  "body_markdown": "# Orientacoes para Matriculas em Disciplinas - 2Q 2026\n\n## Resumo Executivo\n..."
}
```

