# Faturas de cartão: prévia, importação versionada e fechamento

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

As [entradas de despesas](../../../src/app/dashboard/financial/expenses/card-statements/page.tsx) e [conciliação](../../../src/app/dashboard/financial/reconciliation/card-statements/page.tsx) montam o [workspace de faturas](../../../src/features/financial/pages/card-statements-page.tsx). A tela lê `expenses`, `bankAccounts`, `cardStatements` e, quando permitido, `transactions` por [`useFinancialCollection`](../../../src/features/financial/hooks/use-financial-collection.tsx). Prévia de PDF/CSV usa [`POST /api/financial/card-statements/import-preview`](../../../src/app/api/financial/card-statements/import-preview/route.ts): exige `financial.view`, `cardStatements.view/import` (ou administrador), tamanho até 15 MB, cartão e competência válidos; calcula hash, usa cache de análise quando possível e prepara uma versão arquivada da prévia.

A confirmação usa [`POST /api/financial/card-statements/import`](../../../src/app/api/financial/card-statements/import/route.ts), que repete autorização, valida `statementKey`, fingerprint e vínculos, e exige `close` adicional para registro histórico antes do início da DRE. A transação confere prévia persistida, versão ativa e estado, cria/atualiza despesas e linhas, marca a versão aplicada/suplantada e registra evento. A análise bloqueada não pode ser importada. O [workspace](../../../src/features/financial/pages/card-statements-page.tsx) também fecha a fatura por escrita `setDoc` direta em `cardStatements` após verificar total oficial e divergências; auditoria de linhas e reconciliação de pagamento têm caminhos próprios.

## Dados, permissões e dependências

`cardStatements` e subcoleções `imports/events` guardam versão, prévia e auditoria; `expenses` registra novas obrigações ou vínculos com despesas existentes; `transactions` auxilia pagamento/reconciliação. As [regras financeiras](../../../firestore.financial.rules) permitem caminhos específicos de importação/fechamento, que precisam ser lidos junto com a API e com a escrita direta. Alterar fingerprint, competência, estado ou classificação afeta [despesas](expenses.md), [DRE](dre.md) e pagamento.

`npm run check` passou na verificação anterior do mapa (2026-09-25). Testes de referência: [importação](../../../tests/unit/financial-card-statement-import.test.ts), [revisões](../../../tests/unit/financial-card-statement-revisions.test.ts) e [matching de despesas](../../../tests/unit/financial-card-statement-expense-matcher.test.ts). Antes de elevar o grupo, revisar reimportação idempotente, fechamento/pagamento, permissão direta nas regras, arquivo duplicado, prévia obsoleta, transação grande e falha de análise externa.

## Auditoria e pagamento rastreados

Na [página](../../../src/features/financial/pages/card-statements-page.tsx), `toggleLine` exige auditoria, bloqueia fatura paga e pendências de `cardLineAuditIssues`; grava reconciliação na despesa. Confirmação múltipla usa batch somente das linhas aptas. Fechamento valida total/divergências, persiste alocações e status `closed` via SDK, cuja autorização efetiva é Firestore. Reimportação permanece regida pela prévia/fingerprint/versão ativa na API; não é edição livre da fatura paga.

[`reconcile`](../../../src/app/api/financial/card-statements/[statementId]/reconcile/route.ts) exige `cardStatements.reconcile`/admin e transação bancária de saída não revertida. Exige fatura fechada, total positivo, diferença máxima de 5 centavos e integridade de alocações/créditos. Na transação lê despesas, cria obrigação, vínculo e pagamento com IDs determinísticos, marca fatura paga, liquida despesas/parcelas alocadas e vincula transação bancária. Repetição com a mesma transação é idempotente; fatura paga com outra é rejeitada. Não cria uma segunda despesa pelo pagamento da fatura. Testes de corrida, rateio/parcelas e regras diretas permanecem na etapa 2.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
