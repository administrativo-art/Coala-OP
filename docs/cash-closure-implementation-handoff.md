# Fechamento de caixa e depósitos — handoff técnico

Escopo implementado: Fases 1 a 8 do plano operacional, sem rollout.

## Entregas

- Motor PDV defensivo, normalização de canais, centavos inteiros e dia em
  `America/Belem`.
- Persistência idempotente, auditoria, ressincronização e regras Firestore.
- Fluxo de rascunho, autosave, revisão, aprovação, reabertura e limite de
  divergência sênior configurável (default `1000` centavos).
- Resumos por unidade/mês, calendário e jobs às 06:00 em `America/Belem`.
- Blocos por ordem de aprovação, limite de `500000` centavos, divisão assistida,
  ajustes positivos/negativos e alocação parcial sem saldo negativo.
- Cobrança Inter V3 manual: emissão, consulta, listagem, PDF, cancelamento,
  webhook, reconciliação e recuperação por `seuNumero` após resposta ambígua.
- Baixa somente após consulta ativa. `MARCADO_RECEBIDO` não é tratado como
  liquidação bancária.
- `RECEBIDO` em produção gera uma entrada `transfer_in` idempotente na conta
  Banco Inter, com contrapartida operacional no caixa físico da unidade; não é
  classificado como receita.
- Reconciliação fechamento × depósito, indicadores, relatórios e CSV.

## Preparado, mas não executado

O rollout ficou intencionalmente fora deste trabalho. Antes de publicar:

O procedimento atualizado, incluindo custo, permissões, política de competência,
rollback e smoke test, está em `docs/cash-counting-deposit-rollout.md`.

1. Confirmar o pagador institucional de produção referenciado por
   `INTER_COBRANCA_PAYER_CNPJ`; os demais dados são resolvidos pelo cadastro de
   Entidades.
2. Criar/configurar os segredos de jobs e webhook já referenciados em
   `apphosting.yaml`.
3. Configurar os parâmetros das Functions:
   - `CASH_CLOSURE_JOB_URL` → `/api/jobs/cash-closures/daily-sync`;
   - `INTER_RECONCILIATION_URL` → `/api/jobs/inter/cobrancas/reconcile`;
   - `CASH_DEPOSIT_RECONCILIATION_URL` → `/api/jobs/cash-deposits/reconcile`.
4. Rodar primeiro em modo leitura:
   - `npm run migrate:cash-closure-permissions`;
   - `npm run migrate:cash-deposit-inter`.
   - `npm run cash-deposit:period-policy -- --workspace coala --period 2026-08 --policy dre_only --reason "Competência histórica usada somente na DRE" --actor-id IDENTIFICADOR --actor-name "NOME"`.
5. No rollout autorizado, repetir ambas com `-- --execute`, publicar regras,
   índices, Functions e App Hosting, e então cadastrar o webhook definitivo.

As credenciais/certificados existentes de produção não foram substituídos.
