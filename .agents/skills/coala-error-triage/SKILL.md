---
name: coala-error-triage
description: Agrupa eventos sanitizados do Coala-OP por fingerprint, relaciona inventário local de issues e prepara triagem e rascunhos locais baseados em evidência. Use somente por invocação explícita; nunca publique nem altere serviços externos.
disable-model-invocation: true
user-invocable: true
---

# Coala error triage

Execute a primeira triagem em modo local. A skill pode ler um export JSON, JSONL, relatório ou resultado de consulta somente leitura já fornecido, mas não consulta nem altera serviços externos por conta própria.

## Entradas

- `--input <arquivo>`: JSON com array, objeto `{ "events": [...] }`, export de Cloud Logging com `jsonPayload`, ou JSONL.
- `--issues <arquivo>`: inventário JSON opcional de issues já consultadas em modo somente leitura. O formato aceito é array ou `{ "issues": [...] }` com `fingerprint`, `state`, `number`, `url`, `fixedRelease`, `fixedAt` ou `closedAt` quando disponíveis.
- Nunca leia `.env`, credenciais ou payloads integrais de RH/financeiro. Exporte somente os campos necessários.

## Fluxo

1. Leia `AGENTS.md`, `docs/engineering/error-taxonomy.md`, `docs/engineering/error-triage-sla.md` e `docs/engineering/issue-protocol.md`.
2. Faça preflight sem escrita:

   ```bash
   node --import tsx .agents/skills/coala-error-triage/scripts/triage-errors.mjs --input <arquivo> --dry-run
   ```

3. Confirme que a entrada foi aceita, que stacks permanecem multiline e que os eventos normalizados não contêm PII evidente.
4. Execute a triagem local. Opcionalmente inclua o inventário local de issues:

   ```bash
   node --import tsx .agents/skills/coala-error-triage/scripts/triage-errors.mjs --input <arquivo> --issues <arquivo>
   ```

5. Revise `normalized-events.json`, `groups.json`, `report.md` e `issue-drafts/` no diretório informado pelo comando.
6. Destaque prioritariamente `HIGH`, `CRITICAL`, `AMBIGUOUS` relevante, `REGRESSION`, `SECURITY_INCIDENT`, `DATA_INTEGRITY` e `FINANCIAL_INCIDENT`.
7. Informe apenas resultados factuais. Correlação por fingerprint não confirma causa, e contagem em um export não prova volume total do ambiente.
8. Aplique os prazos de triagem/reconhecimento da política experimental. Não os descreva como prazo obrigatório de resolução.

## Classificação

Cada grupo recebe uma classificação de impacto:

```text
EXPECTED | NOISE | LOW | MEDIUM | HIGH | CRITICAL | AMBIGUOUS
```

E um estado:

```text
NEW | KNOWN | RECURRENT | REGRESSION | RESOLVED | NEEDS_INVESTIGATION
```

`REGRESSION` exige ocorrência posterior à correção em release diferente da release corrigida. `RECURRENT` exige ocorrência posterior à correção sem evidência suficiente de mudança de release. Sem `fixedAt`/`closedAt`, não invente recorrência.

O agrupamento da skill usa o fingerprint interno do Coala. Um `groupId` nativo do Error Reporting é evidência adicional do provedor, mas não substitui nem controla esse fingerprint.

## Saída

A saída fica exclusivamente em:

```text
.ai-work/error-triage/<timestamp>/
├── normalized-events.json
├── groups.json
├── report.md
└── issue-drafts/
```

O diretório `.ai-work/` é ignorado pelo Git. O script recusa sobrescrever um diretório já existente e possui `--dry-run`.

Cada rascunho segue o protocolo de issue e separa: erro observado, evidência com fingerprint/eventId, classe da falha, causa confirmada ou hipótese, contrato violado, superfícies afetadas, severidade, correção sistêmica proposta, teste de regressão, risco, rollout e monitoramento de recorrência.

## Limites

- Não publique issue, não faça commit, push, deploy, rollout ou configuração de provedor.
- Não transforme grupo em issue antes de deduplicar por fingerprint.
- Não leia `.env`, arquivos de credenciais ou exports integrais de RH, financeiro, médico ou bancário.
- Não classifique ausência de eventos no export como resolução.
- Não interrompa imediatamente o usuário por `LOW`/`MEDIUM` conhecido, duplicidade, ruído ou erro esperado.
- Rascunhos são locais e ainda exigem revisão humana, especialmente segurança, integridade de dados e financeiro.
