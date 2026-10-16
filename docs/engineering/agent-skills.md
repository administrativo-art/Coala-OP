# Agent Skills do Coala-OP

A implementação canônica de skills do projeto fica em `.agents/skills/<nome>/`. Entradas para outros clientes são links para a mesma pasta, nunca cópias divergentes.

## coala-reposicao

Invocação automática quando o usuário pede para trazer, listar ou recalcular a reposição de uma unidade ou da matriz; também pode ser chamada como `$coala-reposicao`.

A skill consulta a necessidade física atual e a apresenta como **Comprar** na unidade base. Depois usa o insumo derivado, o fornecedor e o tipo de unidade da última compra confirmada para converter a mesma necessidade em unidades inteiras de compra, apresentadas como **Pedir** e agrupadas por fornecedor. A quantidade da compra anterior não é repetida como recomendação nem abatida da falta física. Compras ainda ativas e destinadas explicitamente à unidade aparecem separadas como aviso, sem abatimento automático.

Item sem compra confirmada vinculada a derivado válido permanece com a necessidade em unidade base, no grupo `Sem derivado definido pela última compra`; a skill não infere fornecedor nem embalagem. A execução padrão é somente leitura e não cria pedidos, movimentações ou recebimentos.

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

## coala-supply-chain-audit

Invocação no Codex:

```text
$coala-supply-chain-audit
```

A skill é explicit-only e somente leitura por padrão. Ela inventaria manifests, lockfiles, referências Git/URL, scripts lifecycle, ferramentas executadas por `npx`, comandos de instalação e pacotes duplicados, sem consultar rede ou interpretar CVEs.

Os artefatos são gravados apenas em:

```text
.ai-work/supply-chain/<timestamp>/
├── inventory.json
├── findings.json
└── report.md
```

A execução não atualiza dependências, não regenera lockfiles e não faz commit, push, deploy ou publicação. `npm audit`, consulta de CVEs e remediação exigem autorização separada. Referências de dependência capazes de conter credenciais são redigidas no inventário.

## Validação

```bash
npm run skills:validate
npm run test:skills
```

O `npm run check` também valida estrutura e testes unitários. `.ai-work/` é ignorado pelo Git.
