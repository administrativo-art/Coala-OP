# Agent Skills do Coala-OP

A implementação canônica de skills do projeto fica em `.agents/skills/<nome>/`. Entradas para outros clientes são links para a mesma pasta, nunca cópias divergentes.

## coala-error-triage

Invocação no Codex:

```text
$coala-error-triage
```

A skill é explicit-only. Ela aceita export JSON/JSONL sanitizado e inventário local opcional de issues, executa preflight sem escrita e gera apenas:

```text
.ai-work/error-triage/<timestamp>/
├── normalized-events.json
├── groups.json
├── report.md
└── issue-drafts/
```

Ela não consulta serviços externos, publica issue, faz commit, push, deploy ou rollout. Correlação por fingerprint não é causa confirmada.

O fluxo operacional, a sanitização do export e os critérios humanos para transformar um grupo em issue estão em `error-triage-runbook.md`; as consultas read-only ficam em `observability-queries.md`.

## Validação

```bash
npm run skills:validate
npm run test:skills
```

O `npm run check` também valida estrutura e testes unitários. `.ai-work/` é ignorado pelo Git.
