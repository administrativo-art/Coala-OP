# Entradas de interface e chamadas candidatas por fluxo

Índice gerado de `flow-matrix.csv` e das importações locais alcançáveis a partir das páginas ativas. Ajuda a escolher onde investigar; uma string `/api/` encontrada no código **não prova** que a chamada ocorre nem que seja a única entrada do fluxo. Chamadas montadas dinamicamente, jobs, webhooks e importações além de cinco níveis podem não aparecer. Coleções e permissões abaixo são apenas literais encontrados nos arquivos percorridos; podem pertencer a outro ramo, faltar chamadas indiretas e não comprovam autorização efetiva. Confirme cada candidato na interface, na rota, no serviço e nos testes antes de marcar um grupo como traçado.

Grupos com página ativa: **53**. Atualize com `python3 scripts/generate-flow-entrypoints.py` e confira com `--check`.

## `assets`

Páginas: [`src/app/dashboard/assets/page.tsx`](../../src/app/dashboard/assets/page.tsx).

Arquivos locais percorridos: 24.

Chamadas candidatas encontradas:

- `/api/assets` — interface [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx); rota candidata [`src/app/api/assets/route.ts`](../../src/app/api/assets/route.ts)
- `/api/assets/` — interface [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx); rota candidata [`src/app/api/assets/[assetId]/route.ts`](../../src/app/api/assets/%5BassetId%5D/route.ts)
- `/api/assets/categories` — interface [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx); rota candidata [`src/app/api/assets/categories/route.ts`](../../src/app/api/assets/categories/route.ts)
- `/api/assets/upload` — interface [`src/components/asset-management.tsx`](../../src/components/asset-management.tsx); rota candidata [`src/app/api/assets/upload/route.ts`](../../src/app/api/assets/upload/route.ts)
- `/api/financial/data` — interface [`src/features/financial/hooks/use-financial-collection.tsx`](../../src/features/financial/hooks/use-financial-collection.tsx); rota candidata [`src/app/api/financial/data/route.ts`](../../src/app/api/financial/data/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `assetCategories` — [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx)
- `assets` — [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx)
- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `assets.create` — [`src/components/asset-management.tsx`](../../src/components/asset-management.tsx)
- `assets.edit` — [`src/components/asset-management.tsx`](../../src/components/asset-management.tsx)
- `assets.printLabels` — [`src/components/asset-management.tsx`](../../src/components/asset-management.tsx)
- `assets.view` — [`src/components/asset-management.tsx`](../../src/components/asset-management.tsx)
- `assets.viewHistory` — [`src/components/asset-management.tsx`](../../src/components/asset-management.tsx)

## `card-statements`

Páginas: [`src/app/dashboard/financial/expenses/card-statements/page.tsx`](../../src/app/dashboard/financial/expenses/card-statements/page.tsx), [`src/app/dashboard/financial/reconciliation/card-statements/page.tsx`](../../src/app/dashboard/financial/reconciliation/card-statements/page.tsx).

Arquivos locais percorridos: 22.

Chamadas candidatas encontradas:

- `/api/financial/card-statements/` — interface [`src/features/financial/pages/card-statements-page.tsx`](../../src/features/financial/pages/card-statements-page.tsx)
- `/api/financial/card-statements/import` — interface [`src/features/financial/pages/card-statements-page.tsx`](../../src/features/financial/pages/card-statements-page.tsx); rota candidata [`src/app/api/financial/card-statements/import/route.ts`](../../src/app/api/financial/card-statements/import/route.ts)
- `/api/financial/card-statements/import-preview` — interface [`src/features/financial/pages/card-statements-page.tsx`](../../src/features/financial/pages/card-statements-page.tsx); rota candidata [`src/app/api/financial/card-statements/import-preview/route.ts`](../../src/app/api/financial/card-statements/import-preview/route.ts)
- `/api/financial/data` — interface [`src/features/financial/hooks/use-financial-collection.tsx`](../../src/features/financial/hooks/use-financial-collection.tsx); rota candidata [`src/app/api/financial/data/route.ts`](../../src/app/api/financial/data/route.ts)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `financial.audits.view` — [`src/features/financial/pages/card-statements-page.tsx`](../../src/features/financial/pages/card-statements-page.tsx)
- `financial.cardStatements` — [`src/features/financial/pages/card-statements-page.tsx`](../../src/features/financial/pages/card-statements-page.tsx)
- `financial.settings.view` — [`src/features/financial/pages/card-statements-page.tsx`](../../src/features/financial/pages/card-statements-page.tsx)

## `cash-closures`

Páginas: [`src/app/dashboard/financial/cash-closures/[kioskId]/[year]/[month]/[day]/page.tsx`](../../src/app/dashboard/financial/cash-closures/%5BkioskId%5D/%5Byear%5D/%5Bmonth%5D/%5Bday%5D/page.tsx), [`src/app/dashboard/financial/cash-closures/[kioskId]/[year]/[month]/page.tsx`](../../src/app/dashboard/financial/cash-closures/%5BkioskId%5D/%5Byear%5D/%5Bmonth%5D/page.tsx), [`src/app/dashboard/financial/cash-closures/[kioskId]/page.tsx`](../../src/app/dashboard/financial/cash-closures/%5BkioskId%5D/page.tsx), [`src/app/dashboard/financial/cash-closures/page.tsx`](../../src/app/dashboard/financial/cash-closures/page.tsx), [`src/app/dashboard/financial/cash-closures/sessions/[sessionId]/page.tsx`](../../src/app/dashboard/financial/cash-closures/sessions/%5BsessionId%5D/page.tsx), [`src/app/dashboard/financial/cash-closures/sessions/new/page.tsx`](../../src/app/dashboard/financial/cash-closures/sessions/new/page.tsx).

Arquivos locais percorridos: 40.

Chamadas candidatas encontradas:

- `/api/financial/cash-closures` — interface [`src/features/financial/cash-closures/components/cash-closure-calendar-page.tsx`](../../src/features/financial/cash-closures/components/cash-closure-calendar-page.tsx); rota candidata [`src/app/api/financial/cash-closures/route.ts`](../../src/app/api/financial/cash-closures/route.ts)
- `/api/financial/cash-closures/` — interface [`src/features/financial/cash-closures/components/cash-closure-day-page.tsx`](../../src/features/financial/cash-closures/components/cash-closure-day-page.tsx); rota candidata [`src/app/api/financial/cash-closures/[closureId]/route.ts`](../../src/app/api/financial/cash-closures/%5BclosureId%5D/route.ts)
- `/api/financial/cash-closures/months` — interface [`src/features/financial/cash-closures/components/cash-closure-months-page.tsx`](../../src/features/financial/cash-closures/components/cash-closure-months-page.tsx); rota candidata [`src/app/api/financial/cash-closures/months/route.ts`](../../src/app/api/financial/cash-closures/months/route.ts)
- `/api/financial/cash-closures/overview` — interface [`src/features/financial/cash-closures/components/cash-closures-overview-page.tsx`](../../src/features/financial/cash-closures/components/cash-closures-overview-page.tsx); rota candidata [`src/app/api/financial/cash-closures/overview/route.ts`](../../src/app/api/financial/cash-closures/overview/route.ts)
- `/api/financial/cash-closures/sync` — interface [`src/features/financial/cash-closures/components/cash-closure-day-page.tsx`](../../src/features/financial/cash-closures/components/cash-closure-day-page.tsx); rota candidata [`src/app/api/financial/cash-closures/sync/route.ts`](../../src/app/api/financial/cash-closures/sync/route.ts)
- `/api/financial/cash-counting-sessions` — interface [`src/features/financial/cash-closures/components/cash-closures-overview-page.tsx`](../../src/features/financial/cash-closures/components/cash-closures-overview-page.tsx); rota candidata [`src/app/api/financial/cash-counting-sessions/route.ts`](../../src/app/api/financial/cash-counting-sessions/route.ts)
- `/api/financial/cash-counting-sessions/` — interface [`src/features/financial/cash-counting-sessions/components/cash-counting-dialog.tsx`](../../src/features/financial/cash-counting-sessions/components/cash-counting-dialog.tsx); rota candidata [`src/app/api/financial/cash-counting-sessions/[sessionId]/route.ts`](../../src/app/api/financial/cash-counting-sessions/%5BsessionId%5D/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `financial.cashClosures.adjustExpected` — [`src/features/financial/cash-closures/components/cash-closure-day-page.tsx`](../../src/features/financial/cash-closures/components/cash-closure-day-page.tsx)
- `financial.cashClosures.approve` — [`src/features/financial/cash-closures/components/cash-closure-day-page.tsx`](../../src/features/financial/cash-closures/components/cash-closure-day-page.tsx)
- `financial.cashClosures.edit` — [`src/features/financial/cash-closures/components/cash-closure-day-page.tsx`](../../src/features/financial/cash-closures/components/cash-closure-day-page.tsx)
- `financial.cashClosures.reopen` — [`src/features/financial/cash-closures/components/cash-closure-day-page.tsx`](../../src/features/financial/cash-closures/components/cash-closure-day-page.tsx)
- `financial.cashClosures.resync` — [`src/features/financial/cash-closures/components/cash-closure-day-page.tsx`](../../src/features/financial/cash-closures/components/cash-closure-day-page.tsx)
- `financial.cashClosures.view` — [`src/features/financial/cash-closures/components/cash-closure-calendar-page.tsx`](../../src/features/financial/cash-closures/components/cash-closure-calendar-page.tsx)
- `financial.cashDeposits.adjust` — [`src/features/financial/cash-closures/components/cash-closure-day-page.tsx`](../../src/features/financial/cash-closures/components/cash-closure-day-page.tsx)
- `financial.cashDeposits.issue` — [`src/features/financial/cash-counting-sessions/components/cash-counting-session-page.tsx`](../../src/features/financial/cash-counting-sessions/components/cash-counting-session-page.tsx)
- `financial.cashDeposits.view` — [`src/features/financial/cash-closures/components/cash-control-navigation.tsx`](../../src/features/financial/cash-closures/components/cash-control-navigation.tsx)
- `financial.view` — [`src/features/financial/cash-closures/components/cash-closure-months-page.tsx`](../../src/features/financial/cash-closures/components/cash-closure-months-page.tsx)

## `cash-deposits`

Páginas: [`src/app/dashboard/financial/cash-deposits/page.tsx`](../../src/app/dashboard/financial/cash-deposits/page.tsx).

Arquivos locais percorridos: 19.

Chamadas candidatas encontradas:

- `/api/financial/cash-counting-sessions/` — interface [`src/features/financial/cash-deposits/cash-deposits-page.tsx`](../../src/features/financial/cash-deposits/cash-deposits-page.tsx); rota candidata [`src/app/api/financial/cash-counting-sessions/[sessionId]/route.ts`](../../src/app/api/financial/cash-counting-sessions/%5BsessionId%5D/route.ts)
- `/api/financial/cash-deposits` — interface [`src/features/financial/cash-deposits/cash-deposits-page.tsx`](../../src/features/financial/cash-deposits/cash-deposits-page.tsx); rota candidata [`src/app/api/financial/cash-deposits/route.ts`](../../src/app/api/financial/cash-deposits/route.ts)
- `/api/financial/cash-deposits/` — interface [`src/features/financial/cash-deposits/cash-deposits-page.tsx`](../../src/features/financial/cash-deposits/cash-deposits-page.tsx); rota candidata [`src/app/api/financial/cash-deposits/[batchId]/route.ts`](../../src/app/api/financial/cash-deposits/%5BbatchId%5D/route.ts)
- `/api/financial/cash-deposits/adjustments/allocate` — interface [`src/features/financial/cash-deposits/cash-deposits-page.tsx`](../../src/features/financial/cash-deposits/cash-deposits-page.tsx); rota candidata [`src/app/api/financial/cash-deposits/adjustments/allocate/route.ts`](../../src/app/api/financial/cash-deposits/adjustments/allocate/route.ts)
- `/api/financial/cash-deposits/coins/exchange` — interface [`src/features/financial/cash-deposits/cash-deposits-page.tsx`](../../src/features/financial/cash-deposits/cash-deposits-page.tsx); rota candidata [`src/app/api/financial/cash-deposits/coins/exchange/route.ts`](../../src/app/api/financial/cash-deposits/coins/exchange/route.ts)
- `/api/financial/cash-deposits/reports` — interface [`src/features/financial/cash-deposits/cash-deposits-page.tsx`](../../src/features/financial/cash-deposits/cash-deposits-page.tsx); rota candidata [`src/app/api/financial/cash-deposits/reports/route.ts`](../../src/app/api/financial/cash-deposits/reports/route.ts)
- `/api/financial/cash-deposits/reports/export` — interface [`src/features/financial/cash-deposits/cash-deposits-page.tsx`](../../src/features/financial/cash-deposits/cash-deposits-page.tsx); rota candidata [`src/app/api/financial/cash-deposits/reports/export/route.ts`](../../src/app/api/financial/cash-deposits/reports/export/route.ts)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `financial.cashDeposits.adjust` — [`src/features/financial/cash-deposits/cash-deposits-page.tsx`](../../src/features/financial/cash-deposits/cash-deposits-page.tsx)
- `financial.cashDeposits.cancel` — [`src/features/financial/cash-deposits/cash-deposits-page.tsx`](../../src/features/financial/cash-deposits/cash-deposits-page.tsx)
- `financial.cashDeposits.issue` — [`src/features/financial/cash-deposits/cash-deposits-page.tsx`](../../src/features/financial/cash-deposits/cash-deposits-page.tsx)
- `financial.cashDeposits.view` — [`src/features/financial/cash-closures/components/cash-control-navigation.tsx`](../../src/features/financial/cash-closures/components/cash-control-navigation.tsx)

## `cash-flow`

Páginas: [`src/app/dashboard/financial/cash-flow/agent/page.tsx`](../../src/app/dashboard/financial/cash-flow/agent/page.tsx), [`src/app/dashboard/financial/cash-flow/page.tsx`](../../src/app/dashboard/financial/cash-flow/page.tsx).

Arquivos locais percorridos: 77.

Chamadas candidatas encontradas:

- `/api/financial/agent` — interface [`src/features/financial/agent/anticipation-workspace.tsx`](../../src/features/financial/agent/anticipation-workspace.tsx); rota candidata [`src/app/api/financial/agent/route.ts`](../../src/app/api/financial/agent/route.ts)
- `/api/financial/analysis-routines` — interface [`src/features/financial/agent/management-page.tsx`](../../src/features/financial/agent/management-page.tsx); rota candidata [`src/app/api/financial/analysis-routines/route.ts`](../../src/app/api/financial/analysis-routines/route.ts)
- `/api/financial/budgets` — interface [`src/features/financial/pages/cash-flow-page.tsx`](../../src/features/financial/pages/cash-flow-page.tsx); rota candidata [`src/app/api/financial/budgets/route.ts`](../../src/app/api/financial/budgets/route.ts)
- `/api/financial/budgets/cash-projections` — interface [`src/features/financial/pages/cash-flow-page.tsx`](../../src/features/financial/pages/cash-flow-page.tsx); rota candidata [`src/app/api/financial/budgets/cash-projections/route.ts`](../../src/app/api/financial/budgets/cash-projections/route.ts)
- `/api/financial/data` — interface [`src/features/financial/hooks/use-financial-collection.tsx`](../../src/features/financial/hooks/use-financial-collection.tsx); rota candidata [`src/app/api/financial/data/route.ts`](../../src/app/api/financial/data/route.ts)
- `/api/financial/management-analysis` — interface [`src/features/financial/agent/management-page.tsx`](../../src/features/financial/agent/management-page.tsx); rota candidata [`src/app/api/financial/management-analysis/route.ts`](../../src/app/api/financial/management-analysis/route.ts)
- `/api/financial/stone-future-receivables` — interface [`src/features/financial/receivables/receivables-page.tsx`](../../src/features/financial/receivables/receivables-page.tsx); rota candidata [`src/app/api/financial/stone-future-receivables/route.ts`](../../src/app/api/financial/stone-future-receivables/route.ts)
- `/api/financial/stone-mappings` — interface [`src/features/financial/agent/anticipation-workspace.tsx`](../../src/features/financial/agent/anticipation-workspace.tsx); rota candidata [`src/app/api/financial/stone-mappings/route.ts`](../../src/app/api/financial/stone-mappings/route.ts)
- `/api/financial/stone-portfolio` — interface [`src/features/financial/receivables/portfolio-panel.tsx`](../../src/features/financial/receivables/portfolio-panel.tsx); rota candidata [`src/app/api/financial/stone-portfolio/route.ts`](../../src/app/api/financial/stone-portfolio/route.ts)
- `/api/financial/stone-wallet-position` — interface [`src/features/financial/receivables/wallet-position-panel.tsx`](../../src/features/financial/receivables/wallet-position-panel.tsx); rota candidata [`src/app/api/financial/stone-wallet-position/route.ts`](../../src/app/api/financial/stone-wallet-position/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `kiosks` — [`src/features/financial/agent/management.server.ts`](../../src/features/financial/agent/management.server.ts)
- `productSimulations` — [`src/features/financial/dre/source-data.server.ts`](../../src/features/financial/dre/source-data.server.ts)
- `profiles` — [`src/features/financial/lib/server-access.ts`](../../src/features/financial/lib/server-access.ts)
- `salesReports` — [`src/features/financial/dre/source-data.server.ts`](../../src/features/financial/dre/source-data.server.ts)
- `users` — [`src/features/financial/budgets/references.server.ts`](../../src/features/financial/budgets/references.server.ts)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `audits.edit` — [`src/features/financial/lib/server-access.ts`](../../src/features/financial/lib/server-access.ts)
- `audits.import` — [`src/features/financial/lib/server-access.ts`](../../src/features/financial/lib/server-access.ts)
- `audits.view` — [`src/features/financial/lib/server-access.ts`](../../src/features/financial/lib/server-access.ts)
- `cardStatements.reconcile` — [`src/features/financial/lib/server-access.ts`](../../src/features/financial/lib/server-access.ts)
- `cardStatements.view` — [`src/features/financial/lib/server-access.ts`](../../src/features/financial/lib/server-access.ts)
- `cashClosures.view` — [`src/features/financial/lib/server-access.ts`](../../src/features/financial/lib/server-access.ts)
- `cashDeposits.view` — [`src/features/financial/lib/server-access.ts`](../../src/features/financial/lib/server-access.ts)
- `cashFlow.view` — [`src/features/financial/lib/server-access.ts`](../../src/features/financial/lib/server-access.ts)
- `expenses.create` — [`src/features/financial/lib/server-access.ts`](../../src/features/financial/lib/server-access.ts)
- `expenses.edit` — [`src/features/financial/lib/server-access.ts`](../../src/features/financial/lib/server-access.ts)
- `expenses.view` — [`src/features/financial/lib/server-access.ts`](../../src/features/financial/lib/server-access.ts)
- `financial.cashFlow.create` — [`src/features/financial/pages/cash-flow-page.tsx`](../../src/features/financial/pages/cash-flow-page.tsx)
- `financial.cashFlow.view` — [`src/features/financial/pages/cash-flow-page.tsx`](../../src/features/financial/pages/cash-flow-page.tsx)
- `financial.financialFlow` — [`src/features/financial/pages/cash-flow-page.tsx`](../../src/features/financial/pages/cash-flow-page.tsx)
- `financial.personnelCosts.view` — [`src/features/financial/budgets/personnel-access.ts`](../../src/features/financial/budgets/personnel-access.ts)
- `financial.view` — [`src/features/financial/budgets/personnel-access.ts`](../../src/features/financial/budgets/personnel-access.ts)
- `paymentRequests.view` — [`src/features/financial/lib/server-access.ts`](../../src/features/financial/lib/server-access.ts)
- `personnelCosts.view` — [`src/features/financial/lib/server-access.ts`](../../src/features/financial/lib/server-access.ts)
- `settings.manageExpenseDescriptions` — [`src/features/financial/lib/server-access.ts`](../../src/features/financial/lib/server-access.ts)
- `settings.manageImportAliases` — [`src/features/financial/lib/server-access.ts`](../../src/features/financial/lib/server-access.ts)

## `catalog`

Páginas: [`src/app/dashboard/commercial/page.tsx`](../../src/app/dashboard/commercial/page.tsx).

Arquivos locais percorridos: 2.

Chamadas candidatas encontradas:

- `/api/catalogo` — interface [`src/components/catalogo/catalogo-view.tsx`](../../src/components/catalogo/catalogo-view.tsx); rota candidata [`src/app/api/catalogo/route.ts`](../../src/app/api/catalogo/route.ts)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `dashboard.collaborator` — [`src/app/dashboard/commercial/page.tsx`](../../src/app/dashboard/commercial/page.tsx)
- `dashboard.view` — [`src/app/dashboard/commercial/page.tsx`](../../src/app/dashboard/commercial/page.tsx)

## `collaborator-dashboard`

Páginas: [`src/app/dashboard/collaborator/page.tsx`](../../src/app/dashboard/collaborator/page.tsx).

Arquivos locais percorridos: 28.

Chamadas candidatas encontradas:

- `/api/collaborator/dashboard` — interface [`src/components/collaborator-dashboard-panel.tsx`](../../src/components/collaborator-dashboard-panel.tsx); rota candidata [`src/app/api/collaborator/dashboard/route.ts`](../../src/app/api/collaborator/dashboard/route.ts)
- `/api/forms/analytics/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts)
- `/api/forms/analytics/admin/aggregates/recompute` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/admin/aggregates/recompute/route.ts`](../../src/app/api/forms/analytics/admin/aggregates/recompute/route.ts)
- `/api/forms/analytics/admin/privacy/anonymize-due` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/admin/privacy/anonymize-due/route.ts`](../../src/app/api/forms/analytics/admin/privacy/anonymize-due/route.ts)
- `/api/forms/analytics/admin/privacy/backfill` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/admin/privacy/backfill/route.ts`](../../src/app/api/forms/analytics/admin/privacy/backfill/route.ts)
- `/api/forms/analytics/admin/reprocess/execute` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/admin/reprocess/execute/route.ts`](../../src/app/api/forms/analytics/admin/reprocess/execute/route.ts)
- `/api/forms/analytics/admin/reprocess/simulate` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/admin/reprocess/simulate/route.ts`](../../src/app/api/forms/analytics/admin/reprocess/simulate/route.ts)
- `/api/forms/analytics/occurrences` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/occurrences/route.ts`](../../src/app/api/forms/analytics/occurrences/route.ts)
- `/api/forms/analytics/occurrences/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/occurrences/[occurrenceId]/route.ts`](../../src/app/api/forms/analytics/occurrences/%5BoccurrenceId%5D/route.ts)
- `/api/forms/analytics/retention-policies` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/retention-policies/route.ts`](../../src/app/api/forms/analytics/retention-policies/route.ts)
- `/api/forms/analytics/retention-policies/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/retention-policies/[policyId]/route.ts`](../../src/app/api/forms/analytics/retention-policies/%5BpolicyId%5D/route.ts)
- `/api/forms/analytics/seed` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/seed/route.ts`](../../src/app/api/forms/analytics/seed/route.ts)
- `/api/forms/analytics/summary` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/summary/route.ts`](../../src/app/api/forms/analytics/summary/route.ts)
- `/api/forms/bootstrap` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/bootstrap/route.ts`](../../src/app/api/forms/bootstrap/route.ts)
- `/api/forms/executions` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/executions/route.ts`](../../src/app/api/forms/executions/route.ts)
- `/api/forms/executions/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/executions/[executionId]/route.ts`](../../src/app/api/forms/executions/%5BexecutionId%5D/route.ts)
- `/api/forms/models` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/models/route.ts`](../../src/app/api/forms/models/route.ts)
- `/api/forms/models/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/models/[modelId]/route.ts`](../../src/app/api/forms/models/%5BmodelId%5D/route.ts)
- `/api/forms/projects` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/projects/route.ts`](../../src/app/api/forms/projects/route.ts)
- `/api/forms/projects/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/projects/[projectId]/route.ts`](../../src/app/api/forms/projects/%5BprojectId%5D/route.ts)
- `/api/forms/scheduler` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/scheduler/route.ts`](../../src/app/api/forms/scheduler/route.ts)
- `/api/forms/subtypes` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/subtypes/route.ts`](../../src/app/api/forms/subtypes/route.ts)
- `/api/forms/subtypes/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/subtypes/[subtypeId]/route.ts`](../../src/app/api/forms/subtypes/%5BsubtypeId%5D/route.ts)
- `/api/forms/templates` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/templates/route.ts`](../../src/app/api/forms/templates/route.ts)
- `/api/forms/templates/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/templates/[templateId]/route.ts`](../../src/app/api/forms/templates/%5BtemplateId%5D/route.ts)
- `/api/forms/types` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/types/route.ts`](../../src/app/api/forms/types/route.ts)
- `/api/forms/types/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/types/[typeId]/route.ts`](../../src/app/api/forms/types/%5BtypeId%5D/route.ts)
- `/api/forms/upload` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/upload/route.ts`](../../src/app/api/forms/upload/route.ts)
- `/api/registry/stock-audit` — interface [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)
- `/api/registry/stock-audit/` — interface [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)
- `/api/stock/reposition-activities` — interface [`src/features/reposition/lib/client.ts`](../../src/features/reposition/lib/client.ts); rota candidata [`src/app/api/stock/reposition-activities/route.ts`](../../src/app/api/stock/reposition-activities/route.ts)
- `/api/stock/reposition-activities/` — interface [`src/features/reposition/lib/client.ts`](../../src/features/reposition/lib/client.ts); rota candidata [`src/app/api/stock/reposition-activities/[activityId]/route.ts`](../../src/app/api/stock/reposition-activities/%5BactivityId%5D/route.ts)
- `/api/stock/return-requests` — interface [`src/features/return-requests/lib/client.ts`](../../src/features/return-requests/lib/client.ts); rota candidata [`src/app/api/stock/return-requests/route.ts`](../../src/app/api/stock/return-requests/route.ts)
- `/api/stock/return-requests/` — interface [`src/features/return-requests/lib/client.ts`](../../src/features/return-requests/lib/client.ts); rota candidata [`src/app/api/stock/return-requests/[requestId]/route.ts`](../../src/app/api/stock/return-requests/%5BrequestId%5D/route.ts)
- `/api/tasks` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/route.ts`](../../src/app/api/tasks/route.ts)
- `/api/tasks/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/[taskId]/route.ts`](../../src/app/api/tasks/%5BtaskId%5D/route.ts)
- `/api/tasks/projects` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/projects/route.ts`](../../src/app/api/tasks/projects/route.ts)
- `/api/tasks/projects/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/projects/[projectId]/route.ts`](../../src/app/api/tasks/projects/%5BprojectId%5D/route.ts)
- `/api/tasks/purchase-receipt-sync` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/purchase-receipt-sync/route.ts`](../../src/app/api/tasks/purchase-receipt-sync/route.ts)
- `/api/tasks/statuses` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/statuses/route.ts`](../../src/app/api/tasks/statuses/route.ts)
- `/api/tasks/statuses/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/statuses/[statusId]/route.ts`](../../src/app/api/tasks/statuses/%5BstatusId%5D/route.ts)
- `/api/tasks/subprojects` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/subprojects/route.ts`](../../src/app/api/tasks/subprojects/route.ts)
- `/api/tasks/subprojects/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/subprojects/[subprojectId]/route.ts`](../../src/app/api/tasks/subprojects/%5BsubprojectId%5D/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)
- `lots` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `movementHistory` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `stockAuditSessions` — [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `dashboard.collaborator` — [`src/app/dashboard/collaborator/page.tsx`](../../src/app/dashboard/collaborator/page.tsx)
- `dashboard.view` — [`src/app/dashboard/collaborator/page.tsx`](../../src/app/dashboard/collaborator/page.tsx)
- `dp.collaborators.view` — [`src/components/collaborator-dashboard-panel.tsx`](../../src/components/collaborator-dashboard-panel.tsx)
- `reposition.prepareDispatch` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `reposition.receive` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `reposition.view` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `stock.audit.view` — [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)
- `stock.returns.updateStatus` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `stock.stockCount.approve` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `stock.stockCount.perform` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `stock.stockCount.view` — [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)

## `collaborator-schedule`

Páginas: [`src/app/dashboard/collaborator/schedule/page.tsx`](../../src/app/dashboard/collaborator/schedule/page.tsx).

Arquivos locais percorridos: 5.

Chamadas candidatas encontradas:

- `/api/collaborator/schedule` — interface [`src/components/collaborator-schedule-page.tsx`](../../src/components/collaborator-schedule-page.tsx); rota candidata [`src/app/api/collaborator/schedule/route.ts`](../../src/app/api/collaborator/schedule/route.ts)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `dashboard.collaborator` — [`src/components/collaborator-schedule-page.tsx`](../../src/components/collaborator-schedule-page.tsx)
- `dashboard.view` — [`src/components/collaborator-schedule-page.tsx`](../../src/components/collaborator-schedule-page.tsx)

## `company-documents`

Páginas: [`src/app/dashboard/documents/company/page.tsx`](../../src/app/dashboard/documents/company/page.tsx).

Arquivos locais percorridos: 4.

Chamadas candidatas encontradas:

- `/api/documents/company` — interface [`src/app/dashboard/documents/company/page.tsx`](../../src/app/dashboard/documents/company/page.tsx); rota candidata [`src/app/api/documents/company/route.ts`](../../src/app/api/documents/company/route.ts)
- `/api/documents/company/access` — interface [`src/app/dashboard/documents/company/page.tsx`](../../src/app/dashboard/documents/company/page.tsx); rota candidata [`src/app/api/documents/company/access/route.ts`](../../src/app/api/documents/company/access/route.ts)
- `/api/documents/company/analyze` — interface [`src/app/dashboard/documents/company/page.tsx`](../../src/app/dashboard/documents/company/page.tsx); rota candidata [`src/app/api/documents/company/analyze/route.ts`](../../src/app/api/documents/company/analyze/route.ts)
- `/api/documents/company/units` — interface [`src/app/dashboard/documents/company/page.tsx`](../../src/app/dashboard/documents/company/page.tsx); rota candidata [`src/app/api/documents/company/units/route.ts`](../../src/app/api/documents/company/units/route.ts)

## `consents`

Páginas: [`src/app/dashboard/documents/consents/[employeeId]/page.tsx`](../../src/app/dashboard/documents/consents/%5BemployeeId%5D/page.tsx).

Arquivos locais percorridos: 4.

Chamadas candidatas encontradas:

- `/api/hr/consents/image-voice/` — interface [`src/app/dashboard/documents/consents/[employeeId]/page.tsx`](../../src/app/dashboard/documents/consents/%5BemployeeId%5D/page.tsx); rota candidata [`src/app/api/hr/consents/image-voice/[employeeId]/route.ts`](../../src/app/api/hr/consents/image-voice/%5BemployeeId%5D/route.ts)

## `document-generation`

Páginas: [`src/app/dashboard/documents/generated/page.tsx`](../../src/app/dashboard/documents/generated/page.tsx), [`src/app/dashboard/documents/generator/page.tsx`](../../src/app/dashboard/documents/generator/page.tsx).

Arquivos locais percorridos: 14.

Chamadas candidatas encontradas:

- `/api/documents/generate` — interface [`src/components/documents/document-generator-workspace.tsx`](../../src/components/documents/document-generator-workspace.tsx); rota candidata [`src/app/api/documents/generate/route.ts`](../../src/app/api/documents/generate/route.ts)
- `/api/documents/generated` — interface [`src/app/dashboard/documents/generated/page.tsx`](../../src/app/dashboard/documents/generated/page.tsx); rota candidata [`src/app/api/documents/generated/route.ts`](../../src/app/api/documents/generated/route.ts)
- `/api/documents/generated/` — interface [`src/app/dashboard/documents/generated/page.tsx`](../../src/app/dashboard/documents/generated/page.tsx); rota candidata [`src/app/api/documents/generated/[id]/route.ts`](../../src/app/api/documents/generated/%5Bid%5D/route.ts)
- `/api/documents/generator/parties` — interface [`src/components/documents/document-generator-workspace.tsx`](../../src/components/documents/document-generator-workspace.tsx); rota candidata [`src/app/api/documents/generator/parties/route.ts`](../../src/app/api/documents/generator/parties/route.ts)
- `/api/documents/generator/templates` — interface [`src/components/documents/document-generator-workspace.tsx`](../../src/components/documents/document-generator-workspace.tsx); rota candidata [`src/app/api/documents/generator/templates/route.ts`](../../src/app/api/documents/generator/templates/route.ts)

## `document-templates`

Páginas: [`src/app/dashboard/documents/templates/[id]/page.tsx`](../../src/app/dashboard/documents/templates/%5Bid%5D/page.tsx), [`src/app/dashboard/documents/templates/page.tsx`](../../src/app/dashboard/documents/templates/page.tsx).

Arquivos locais percorridos: 18.

Chamadas candidatas encontradas:

- `/api/documents/collective-agreements` — interface [`src/components/hr/documents/collective-agreements-panel.tsx`](../../src/components/hr/documents/collective-agreements-panel.tsx); rota candidata [`src/app/api/documents/collective-agreements/route.ts`](../../src/app/api/documents/collective-agreements/route.ts)
- `/api/documents/collective-agreements/` — interface [`src/components/hr/documents/collective-agreements-panel.tsx`](../../src/components/hr/documents/collective-agreements-panel.tsx); rota candidata [`src/app/api/documents/collective-agreements/[id]/route.ts`](../../src/app/api/documents/collective-agreements/%5Bid%5D/route.ts)
- `/api/documents/generate` — interface [`src/app/dashboard/documents/templates/[id]/page.tsx`](../../src/app/dashboard/documents/templates/%5Bid%5D/page.tsx); rota candidata [`src/app/api/documents/generate/route.ts`](../../src/app/api/documents/generate/route.ts)
- `/api/documents/generated` — interface [`src/app/dashboard/documents/templates/[id]/page.tsx`](../../src/app/dashboard/documents/templates/%5Bid%5D/page.tsx); rota candidata [`src/app/api/documents/generated/route.ts`](../../src/app/api/documents/generated/route.ts)
- `/api/documents/generated/` — interface [`src/app/dashboard/documents/templates/[id]/page.tsx`](../../src/app/dashboard/documents/templates/%5Bid%5D/page.tsx); rota candidata [`src/app/api/documents/generated/[id]/route.ts`](../../src/app/api/documents/generated/%5Bid%5D/route.ts)
- `/api/documents/templates` — interface [`src/app/dashboard/documents/templates/page.tsx`](../../src/app/dashboard/documents/templates/page.tsx); rota candidata [`src/app/api/documents/templates/route.ts`](../../src/app/api/documents/templates/route.ts)
- `/api/documents/templates/` — interface [`src/app/dashboard/documents/templates/[id]/page.tsx`](../../src/app/dashboard/documents/templates/%5Bid%5D/page.tsx); rota candidata [`src/app/api/documents/templates/[id]/route.ts`](../../src/app/api/documents/templates/%5Bid%5D/route.ts)

## `dp-overview`

Páginas: [`src/app/dashboard/dp/page.tsx`](../../src/app/dashboard/dp/page.tsx).

Arquivos locais percorridos: 14.

Chamadas candidatas encontradas:

- `/api/hr/terminations` — interface [`src/features/hr/termination/active-terminations-card.tsx`](../../src/features/hr/termination/active-terminations-card.tsx); rota candidata [`src/app/api/hr/terminations/route.ts`](../../src/app/api/hr/terminations/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `dp_schedules` — [`src/hooks/use-dp-schedules-shifts.ts`](../../src/hooks/use-dp-schedules-shifts.ts)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `dp.view` — [`src/app/dashboard/dp/page.tsx`](../../src/app/dashboard/dp/page.tsx)

## `dp-schedules`

Páginas: [`src/app/dashboard/dp/schedules/[id]/page.tsx`](../../src/app/dashboard/dp/schedules/%5Bid%5D/page.tsx), [`src/app/dashboard/dp/schedules/month/[period]/page.tsx`](../../src/app/dashboard/dp/schedules/month/%5Bperiod%5D/page.tsx), [`src/app/dashboard/dp/schedules/page.tsx`](../../src/app/dashboard/dp/schedules/page.tsx).

Arquivos locais percorridos: 36.

Chamadas candidatas encontradas:

- `/api/audit/log` — interface [`src/features/audit/client.ts`](../../src/features/audit/client.ts); rota candidata [`src/app/api/audit/log/route.ts`](../../src/app/api/audit/log/route.ts)
- `/api/audit/logs` — interface [`src/features/audit/client.ts`](../../src/features/audit/client.ts); rota candidata [`src/app/api/audit/logs/route.ts`](../../src/app/api/audit/logs/route.ts)
- `/api/dp/schedules/` — interface [`src/components/dp/dp-schedule-editor.tsx`](../../src/components/dp/dp-schedule-editor.tsx)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `dp_calendars` — [`src/hooks/use-dp-holidays.ts`](../../src/hooks/use-dp-holidays.ts)
- `dp_schedules` — [`src/components/dp/dp-schedules-list.tsx`](../../src/components/dp/dp-schedules-list.tsx)
- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `dp.schedules.create` — [`src/components/dp/dp-schedule-month-view.tsx`](../../src/components/dp/dp-schedule-month-view.tsx)
- `dp.schedules.delete` — [`src/components/dp/dp-schedule-month-view.tsx`](../../src/components/dp/dp-schedule-month-view.tsx)
- `dp.schedules.edit` — [`src/components/dp/dp-schedule-editor.tsx`](../../src/components/dp/dp-schedule-editor.tsx)
- `dp.schedules.publishBizneo` — [`src/components/dp/dp-schedule-editor.tsx`](../../src/components/dp/dp-schedule-editor.tsx)
- `dp.schedules.view` — [`src/app/dashboard/dp/schedules/[id]/page.tsx`](../../src/app/dashboard/dp/schedules/%5Bid%5D/page.tsx)

## `dp-settings`

Páginas: [`src/app/dashboard/dp/settings/calendars/[id]/page.tsx`](../../src/app/dashboard/dp/settings/calendars/%5Bid%5D/page.tsx), [`src/app/dashboard/dp/settings/collaborators/page.tsx`](../../src/app/dashboard/dp/settings/collaborators/page.tsx).

Arquivos locais percorridos: 33.

Chamadas candidatas encontradas:

- `/api/hr/bootstrap` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/bootstrap/route.ts`](../../src/app/api/hr/bootstrap/route.ts)
- `/api/hr/departments` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/departments/route.ts`](../../src/app/api/hr/departments/route.ts)
- `/api/hr/departments/` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/departments/[departmentId]/route.ts`](../../src/app/api/hr/departments/%5BdepartmentId%5D/route.ts)
- `/api/hr/functions` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/functions/route.ts`](../../src/app/api/hr/functions/route.ts)
- `/api/hr/functions/` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/functions/[functionId]/route.ts`](../../src/app/api/hr/functions/%5BfunctionId%5D/route.ts)
- `/api/hr/login-access` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/login-access/route.ts`](../../src/app/api/hr/login-access/route.ts)
- `/api/hr/login-access/audit` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/login-access/audit/route.ts`](../../src/app/api/hr/login-access/audit/route.ts)
- `/api/hr/roles` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/roles/route.ts`](../../src/app/api/hr/roles/route.ts)
- `/api/hr/roles/` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/roles/[roleId]/route.ts`](../../src/app/api/hr/roles/%5BroleId%5D/route.ts)
- `/api/hr/terminations` — interface [`src/features/hr/termination/client.ts`](../../src/features/hr/termination/client.ts); rota candidata [`src/app/api/hr/terminations/route.ts`](../../src/app/api/hr/terminations/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `dp_calendars` — [`src/hooks/use-dp-holidays.ts`](../../src/hooks/use-dp-holidays.ts)
- `profiles` — [`src/components/profiles-provider.tsx`](../../src/components/profiles-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `dp.collaborators.edit` — [`src/app/dashboard/dp/settings/collaborators/page.tsx`](../../src/app/dashboard/dp/settings/collaborators/page.tsx)
- `dp.collaborators.terminate` — [`src/app/dashboard/dp/settings/collaborators/page.tsx`](../../src/app/dashboard/dp/settings/collaborators/page.tsx)
- `dp.settings.manageCalendars` — [`src/app/dashboard/dp/settings/calendars/[id]/page.tsx`](../../src/app/dashboard/dp/settings/calendars/%5Bid%5D/page.tsx)
- `dp.view` — [`src/hooks/use-hr-bootstrap.ts`](../../src/hooks/use-hr-bootstrap.ts)
- `settings.manageUsers` — [`src/hooks/use-hr-bootstrap.ts`](../../src/hooks/use-hr-bootstrap.ts)

## `dre`

Páginas: [`src/app/dashboard/financial/dre/page.tsx`](../../src/app/dashboard/financial/dre/page.tsx).

Arquivos locais percorridos: 33.

Chamadas candidatas encontradas:

- `/api/financial/data` — interface [`src/features/financial/hooks/use-financial-collection.tsx`](../../src/features/financial/hooks/use-financial-collection.tsx); rota candidata [`src/app/api/financial/data/route.ts`](../../src/app/api/financial/data/route.ts)
- `/api/financial/dre/source-data` — interface [`src/features/financial/pages/dre-page.tsx`](../../src/features/financial/pages/dre-page.tsx); rota candidata [`src/app/api/financial/dre/source-data/route.ts`](../../src/app/api/financial/dre/source-data/route.ts)
- `/api/financial/dre/stock-cmv` — interface [`src/features/financial/pages/dre-page.tsx`](../../src/features/financial/pages/dre-page.tsx); rota candidata [`src/app/api/financial/dre/stock-cmv/route.ts`](../../src/app/api/financial/dre/stock-cmv/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `financial.dre` — [`src/features/financial/pages/dre-page.tsx`](../../src/features/financial/pages/dre-page.tsx)
- `financial.expenses.create` — [`src/features/financial/pages/dre-page.tsx`](../../src/features/financial/pages/dre-page.tsx)
- `financial.expenses.edit` — [`src/features/financial/pages/dre-page.tsx`](../../src/features/financial/pages/dre-page.tsx)
- `financial.expenses.view` — [`src/features/financial/pages/dre-page.tsx`](../../src/features/financial/pages/dre-page.tsx)
- `financial.personnelCosts.export` — [`src/features/financial/pages/dre-page.tsx`](../../src/features/financial/pages/dre-page.tsx)
- `financial.personnelCosts.view` — [`src/features/financial/pages/dre-page.tsx`](../../src/features/financial/pages/dre-page.tsx)

## `employee-documents`

Páginas: [`src/app/dashboard/documents/collaborators/page.tsx`](../../src/app/dashboard/documents/collaborators/page.tsx), [`src/app/dashboard/dp/documents/page.tsx`](../../src/app/dashboard/dp/documents/page.tsx).

Arquivos locais percorridos: 10.

Chamadas candidatas encontradas:

- `/api/hr/employee-documents/summary` — interface [`src/app/dashboard/dp/documents/page.tsx`](../../src/app/dashboard/dp/documents/page.tsx); rota candidata [`src/app/api/hr/employee-documents/summary/route.ts`](../../src/app/api/hr/employee-documents/summary/route.ts)
- `/api/hr/employee-documents/visibility` — interface [`src/app/dashboard/dp/documents/page.tsx`](../../src/app/dashboard/dp/documents/page.tsx); rota candidata [`src/app/api/hr/employee-documents/visibility/route.ts`](../../src/app/api/hr/employee-documents/visibility/route.ts)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `dp.collaborators.edit` — [`src/app/dashboard/dp/documents/page.tsx`](../../src/app/dashboard/dp/documents/page.tsx)
- `dp.collaborators.ownProfileOnly` — [`src/app/dashboard/dp/documents/page.tsx`](../../src/app/dashboard/dp/documents/page.tsx)
- `dp.collaborators.view` — [`src/app/dashboard/dp/documents/page.tsx`](../../src/app/dashboard/dp/documents/page.tsx)
- `settings.manageUsers` — [`src/app/dashboard/dp/documents/page.tsx`](../../src/app/dashboard/dp/documents/page.tsx)

## `expenses`

Páginas: [`src/app/dashboard/financial/expenses/import/page.tsx`](../../src/app/dashboard/financial/expenses/import/page.tsx), [`src/app/dashboard/financial/expenses/new/page.tsx`](../../src/app/dashboard/financial/expenses/new/page.tsx), [`src/app/dashboard/financial/expenses/page.tsx`](../../src/app/dashboard/financial/expenses/page.tsx), [`src/app/dashboard/financial/expenses/pending-audit/page.tsx`](../../src/app/dashboard/financial/expenses/pending-audit/page.tsx).

Arquivos locais percorridos: 98.

Chamadas candidatas encontradas:

- `/api/financial/card-statements/` — interface [`src/features/financial/pages/card-statements-page.tsx`](../../src/features/financial/pages/card-statements-page.tsx)
- `/api/financial/card-statements/import` — interface [`src/features/financial/pages/card-statements-page.tsx`](../../src/features/financial/pages/card-statements-page.tsx); rota candidata [`src/app/api/financial/card-statements/import/route.ts`](../../src/app/api/financial/card-statements/import/route.ts)
- `/api/financial/card-statements/import-preview` — interface [`src/features/financial/pages/card-statements-page.tsx`](../../src/features/financial/pages/card-statements-page.tsx); rota candidata [`src/app/api/financial/card-statements/import-preview/route.ts`](../../src/app/api/financial/card-statements/import-preview/route.ts)
- `/api/financial/data` — interface [`src/features/financial/components/expenses/expense-form.tsx`](../../src/features/financial/components/expenses/expense-form.tsx); rota candidata [`src/app/api/financial/data/route.ts`](../../src/app/api/financial/data/route.ts)
- `/api/financial/expenses/` — interface [`src/features/financial/components/expenses/expense-boleto-panel.tsx`](../../src/features/financial/components/expenses/expense-boleto-panel.tsx)
- `/api/financial/import-sessions/` — interface [`src/features/financial/pages/import-page.tsx`](../../src/features/financial/pages/import-page.tsx); rota candidata [`src/app/api/financial/import-sessions/[sessionId]/route.ts`](../../src/app/api/financial/import-sessions/%5BsessionId%5D/route.ts)
- `/api/financial/inbox/` — interface [`src/features/financial/components/expenses/expense-form.tsx`](../../src/features/financial/components/expenses/expense-form.tsx); rota candidata [`src/app/api/financial/inbox/[id]/route.ts`](../../src/app/api/financial/inbox/%5Bid%5D/route.ts)
- `/api/financial/payment-requests` — interface [`src/features/financial/components/pay-expense-dialog.tsx`](../../src/features/financial/components/pay-expense-dialog.tsx); rota candidata [`src/app/api/financial/payment-requests/route.ts`](../../src/app/api/financial/payment-requests/route.ts)
- `/api/purchasing/orders` — interface [`src/components/purchase-order-provider.tsx`](../../src/components/purchase-order-provider.tsx)
- `/api/purchasing/orders/` — interface [`src/components/purchase-order-provider.tsx`](../../src/components/purchase-order-provider.tsx)
- `/api/registry/base-products` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/base-products/` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/entities` — interface [`src/components/entities-provider.tsx`](../../src/components/entities-provider.tsx)
- `/api/registry/entities/` — interface [`src/components/entities-provider.tsx`](../../src/components/entities-provider.tsx)
- `/api/registry/products` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/registry/products/` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/tasks` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/route.ts`](../../src/app/api/tasks/route.ts)
- `/api/tasks/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/[taskId]/route.ts`](../../src/app/api/tasks/%5BtaskId%5D/route.ts)
- `/api/tasks/projects` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/projects/route.ts`](../../src/app/api/tasks/projects/route.ts)
- `/api/tasks/projects/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/projects/[projectId]/route.ts`](../../src/app/api/tasks/projects/%5BprojectId%5D/route.ts)
- `/api/tasks/purchase-receipt-sync` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/purchase-receipt-sync/route.ts`](../../src/app/api/tasks/purchase-receipt-sync/route.ts)
- `/api/tasks/statuses` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/statuses/route.ts`](../../src/app/api/tasks/statuses/route.ts)
- `/api/tasks/statuses/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/statuses/[statusId]/route.ts`](../../src/app/api/tasks/statuses/%5BstatusId%5D/route.ts)
- `/api/tasks/subprojects` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/subprojects/route.ts`](../../src/app/api/tasks/subprojects/route.ts)
- `/api/tasks/subprojects/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/subprojects/[subprojectId]/route.ts`](../../src/app/api/tasks/subprojects/%5BsubprojectId%5D/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `baseProducts` — [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `entities` — [`src/components/entities-provider.tsx`](../../src/components/entities-provider.tsx)
- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)
- `products` — [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `purchase_financials` — [`src/features/financial/pages/import-page.tsx`](../../src/features/financial/pages/import-page.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `financial.audits` — [`src/features/financial/pages/import-page.tsx`](../../src/features/financial/pages/import-page.tsx)
- `financial.audits.import` — [`src/features/financial/pages/expenses-page.tsx`](../../src/features/financial/pages/expenses-page.tsx)
- `financial.audits.view` — [`src/features/financial/pages/card-statements-page.tsx`](../../src/features/financial/pages/card-statements-page.tsx)
- `financial.cardStatements` — [`src/features/financial/pages/card-statements-page.tsx`](../../src/features/financial/pages/card-statements-page.tsx)
- `financial.cardStatements.view` — [`src/features/financial/pages/expenses-page.tsx`](../../src/features/financial/pages/expenses-page.tsx)
- `financial.expenses.create` — [`src/features/financial/components/expenses/expense-form.tsx`](../../src/features/financial/components/expenses/expense-form.tsx)
- `financial.expenses.delete` — [`src/features/financial/pages/expenses-page.tsx`](../../src/features/financial/pages/expenses-page.tsx)
- `financial.expenses.edit` — [`src/features/financial/components/expenses/expense-form.tsx`](../../src/features/financial/components/expenses/expense-form.tsx)
- `financial.expenses.pay` — [`src/features/financial/pages/expenses-page.tsx`](../../src/features/financial/pages/expenses-page.tsx)
- `financial.expenses.view` — [`src/features/financial/pages/expenses-page.tsx`](../../src/features/financial/pages/expenses-page.tsx)
- `financial.inbox.view` — [`src/features/financial/pages/expenses-page.tsx`](../../src/features/financial/pages/expenses-page.tsx)
- `financial.paymentRequests.create` — [`src/features/financial/components/pay-expense-dialog.tsx`](../../src/features/financial/components/pay-expense-dialog.tsx)
- `financial.paymentRequests.view` — [`src/features/financial/pages/expenses-page.tsx`](../../src/features/financial/pages/expenses-page.tsx)
- `financial.personnelCosts.edit` — [`src/features/financial/components/expenses/expense-form.tsx`](../../src/features/financial/components/expenses/expense-form.tsx)
- `financial.personnelCosts.view` — [`src/features/financial/components/expenses/expense-form.tsx`](../../src/features/financial/components/expenses/expense-form.tsx)
- `financial.reconciliation.classifyAdjustments` — [`src/features/financial/components/expenses/expense-financial-summary.tsx`](../../src/features/financial/components/expenses/expense-financial-summary.tsx)
- `financial.settings.manageExpenseDescriptions` — [`src/features/financial/components/expenses/expense-form.tsx`](../../src/features/financial/components/expenses/expense-form.tsx)
- `financial.settings.view` — [`src/features/financial/pages/card-statements-page.tsx`](../../src/features/financial/pages/card-statements-page.tsx)

## `financial-assets`

Páginas: [`src/app/dashboard/financial/assets/page.tsx`](../../src/app/dashboard/financial/assets/page.tsx).

Arquivos locais percorridos: 24.

Chamadas candidatas encontradas:

- `/api/assets` — interface [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx); rota candidata [`src/app/api/assets/route.ts`](../../src/app/api/assets/route.ts)
- `/api/assets/` — interface [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx); rota candidata [`src/app/api/assets/[assetId]/route.ts`](../../src/app/api/assets/%5BassetId%5D/route.ts)
- `/api/assets/categories` — interface [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx); rota candidata [`src/app/api/assets/categories/route.ts`](../../src/app/api/assets/categories/route.ts)
- `/api/assets/upload` — interface [`src/components/asset-management.tsx`](../../src/components/asset-management.tsx); rota candidata [`src/app/api/assets/upload/route.ts`](../../src/app/api/assets/upload/route.ts)
- `/api/financial/data` — interface [`src/features/financial/hooks/use-financial-collection.tsx`](../../src/features/financial/hooks/use-financial-collection.tsx); rota candidata [`src/app/api/financial/data/route.ts`](../../src/app/api/financial/data/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `assetCategories` — [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx)
- `assets` — [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx)
- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `assets.create` — [`src/components/asset-management.tsx`](../../src/components/asset-management.tsx)
- `assets.edit` — [`src/components/asset-management.tsx`](../../src/components/asset-management.tsx)
- `assets.printLabels` — [`src/components/asset-management.tsx`](../../src/components/asset-management.tsx)
- `assets.view` — [`src/components/asset-management.tsx`](../../src/components/asset-management.tsx)
- `assets.viewHistory` — [`src/components/asset-management.tsx`](../../src/components/asset-management.tsx)

## `financial-inbox`

Páginas: [`src/app/dashboard/financial/expenses/inbox/page.tsx`](../../src/app/dashboard/financial/expenses/inbox/page.tsx).

Arquivos locais percorridos: 24.

Chamadas candidatas encontradas:

- `/api/financial/inbox` — interface [`src/features/financial/inbox/financial-inbox-page.tsx`](../../src/features/financial/inbox/financial-inbox-page.tsx); rota candidata [`src/app/api/financial/inbox/route.ts`](../../src/app/api/financial/inbox/route.ts)
- `/api/financial/inbox/` — interface [`src/features/financial/inbox/financial-inbox-page.tsx`](../../src/features/financial/inbox/financial-inbox-page.tsx); rota candidata [`src/app/api/financial/inbox/[id]/route.ts`](../../src/app/api/financial/inbox/%5Bid%5D/route.ts)
- `/api/financial/inbox/bulk-review` — interface [`src/features/financial/inbox/financial-inbox-page.tsx`](../../src/features/financial/inbox/financial-inbox-page.tsx); rota candidata [`src/app/api/financial/inbox/bulk-review/route.ts`](../../src/app/api/financial/inbox/bulk-review/route.ts)
- `/api/financial/inbox/settings` — interface [`src/features/financial/inbox/financial-inbox-page.tsx`](../../src/features/financial/inbox/financial-inbox-page.tsx); rota candidata [`src/app/api/financial/inbox/settings/route.ts`](../../src/app/api/financial/inbox/settings/route.ts)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `financial.expenses.create` — [`src/features/financial/inbox/financial-inbox-page.tsx`](../../src/features/financial/inbox/financial-inbox-page.tsx)
- `financial.expenses.edit` — [`src/features/financial/inbox/financial-inbox-page.tsx`](../../src/features/financial/inbox/financial-inbox-page.tsx)
- `financial.inbox.analyze` — [`src/features/financial/inbox/financial-inbox-page.tsx`](../../src/features/financial/inbox/financial-inbox-page.tsx)
- `financial.inbox.discard` — [`src/features/financial/inbox/financial-inbox-page.tsx`](../../src/features/financial/inbox/financial-inbox-page.tsx)
- `financial.inbox.link` — [`src/features/financial/inbox/financial-inbox-page.tsx`](../../src/features/financial/inbox/financial-inbox-page.tsx)
- `financial.inbox.view` — [`src/features/financial/inbox/financial-inbox-page.tsx`](../../src/features/financial/inbox/financial-inbox-page.tsx)
- `financial.paymentRequests.create` — [`src/features/financial/inbox/financial-inbox-page.tsx`](../../src/features/financial/inbox/financial-inbox-page.tsx)
- `financial.paymentRequests.view` — [`src/features/financial/inbox/financial-inbox-page.tsx`](../../src/features/financial/inbox/financial-inbox-page.tsx)

## `financial-overview`

Páginas: [`src/app/dashboard/financial/page.tsx`](../../src/app/dashboard/financial/page.tsx).

Arquivos locais percorridos: 17.

Chamadas candidatas encontradas:

- `/api/financial/data` — interface [`src/features/financial/hooks/use-financial-collection.tsx`](../../src/features/financial/hooks/use-financial-collection.tsx); rota candidata [`src/app/api/financial/data/route.ts`](../../src/app/api/financial/data/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `financial.audits.view` — [`src/features/financial/pages/financial-dashboard-page.tsx`](../../src/features/financial/pages/financial-dashboard-page.tsx)
- `financial.cardStatements.view` — [`src/features/financial/pages/financial-dashboard-page.tsx`](../../src/features/financial/pages/financial-dashboard-page.tsx)
- `financial.cashFlow.view` — [`src/features/financial/pages/financial-dashboard-page.tsx`](../../src/features/financial/pages/financial-dashboard-page.tsx)
- `financial.dashboard` — [`src/features/financial/pages/financial-dashboard-page.tsx`](../../src/features/financial/pages/financial-dashboard-page.tsx)
- `financial.dre` — [`src/features/financial/pages/financial-dashboard-page.tsx`](../../src/features/financial/pages/financial-dashboard-page.tsx)
- `financial.expenses.view` — [`src/features/financial/pages/financial-dashboard-page.tsx`](../../src/features/financial/pages/financial-dashboard-page.tsx)
- `financial.financialFlow` — [`src/features/financial/pages/financial-dashboard-page.tsx`](../../src/features/financial/pages/financial-dashboard-page.tsx)
- `financial.settings.view` — [`src/features/financial/pages/financial-dashboard-page.tsx`](../../src/features/financial/pages/financial-dashboard-page.tsx)

## `forms`

Páginas: [`src/app/dashboard/forms/[id]/page.tsx`](../../src/app/dashboard/forms/%5Bid%5D/page.tsx), [`src/app/dashboard/forms/[id]/view/page.tsx`](../../src/app/dashboard/forms/%5Bid%5D/view/page.tsx), [`src/app/dashboard/forms/mine/page.tsx`](../../src/app/dashboard/forms/mine/page.tsx), [`src/app/dashboard/forms/models/[modelId]/page.tsx`](../../src/app/dashboard/forms/models/%5BmodelId%5D/page.tsx), [`src/app/dashboard/forms/models/new/page.tsx`](../../src/app/dashboard/forms/models/new/page.tsx), [`src/app/dashboard/forms/page.tsx`](../../src/app/dashboard/forms/page.tsx).

Arquivos locais percorridos: 42.

Chamadas candidatas encontradas:

- `/api/forms/analytics/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts)
- `/api/forms/analytics/admin/aggregates/recompute` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/admin/aggregates/recompute/route.ts`](../../src/app/api/forms/analytics/admin/aggregates/recompute/route.ts)
- `/api/forms/analytics/admin/privacy/anonymize-due` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/admin/privacy/anonymize-due/route.ts`](../../src/app/api/forms/analytics/admin/privacy/anonymize-due/route.ts)
- `/api/forms/analytics/admin/privacy/backfill` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/admin/privacy/backfill/route.ts`](../../src/app/api/forms/analytics/admin/privacy/backfill/route.ts)
- `/api/forms/analytics/admin/reprocess/execute` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/admin/reprocess/execute/route.ts`](../../src/app/api/forms/analytics/admin/reprocess/execute/route.ts)
- `/api/forms/analytics/admin/reprocess/simulate` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/admin/reprocess/simulate/route.ts`](../../src/app/api/forms/analytics/admin/reprocess/simulate/route.ts)
- `/api/forms/analytics/jobs/anonymize-due` — interface [`src/components/forms/forms-dashboard-shell.tsx`](../../src/components/forms/forms-dashboard-shell.tsx); rota candidata [`src/app/api/forms/analytics/jobs/anonymize-due/route.ts`](../../src/app/api/forms/analytics/jobs/anonymize-due/route.ts)
- `/api/forms/analytics/jobs/recompute-daily` — interface [`src/components/forms/forms-dashboard-shell.tsx`](../../src/components/forms/forms-dashboard-shell.tsx); rota candidata [`src/app/api/forms/analytics/jobs/recompute-daily/route.ts`](../../src/app/api/forms/analytics/jobs/recompute-daily/route.ts)
- `/api/forms/analytics/occurrences` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/occurrences/route.ts`](../../src/app/api/forms/analytics/occurrences/route.ts)
- `/api/forms/analytics/occurrences/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/occurrences/[occurrenceId]/route.ts`](../../src/app/api/forms/analytics/occurrences/%5BoccurrenceId%5D/route.ts)
- `/api/forms/analytics/retention-policies` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/retention-policies/route.ts`](../../src/app/api/forms/analytics/retention-policies/route.ts)
- `/api/forms/analytics/retention-policies/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/retention-policies/[policyId]/route.ts`](../../src/app/api/forms/analytics/retention-policies/%5BpolicyId%5D/route.ts)
- `/api/forms/analytics/seed` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/seed/route.ts`](../../src/app/api/forms/analytics/seed/route.ts)
- `/api/forms/analytics/summary` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/analytics/summary/route.ts`](../../src/app/api/forms/analytics/summary/route.ts)
- `/api/forms/bootstrap` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/bootstrap/route.ts`](../../src/app/api/forms/bootstrap/route.ts)
- `/api/forms/executions` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/executions/route.ts`](../../src/app/api/forms/executions/route.ts)
- `/api/forms/executions/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/executions/[executionId]/route.ts`](../../src/app/api/forms/executions/%5BexecutionId%5D/route.ts)
- `/api/forms/models` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/models/route.ts`](../../src/app/api/forms/models/route.ts)
- `/api/forms/models/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/models/[modelId]/route.ts`](../../src/app/api/forms/models/%5BmodelId%5D/route.ts)
- `/api/forms/projects` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/projects/route.ts`](../../src/app/api/forms/projects/route.ts)
- `/api/forms/projects/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/projects/[projectId]/route.ts`](../../src/app/api/forms/projects/%5BprojectId%5D/route.ts)
- `/api/forms/scheduler` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/scheduler/route.ts`](../../src/app/api/forms/scheduler/route.ts)
- `/api/forms/subtypes` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/subtypes/route.ts`](../../src/app/api/forms/subtypes/route.ts)
- `/api/forms/subtypes/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/subtypes/[subtypeId]/route.ts`](../../src/app/api/forms/subtypes/%5BsubtypeId%5D/route.ts)
- `/api/forms/templates` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/templates/route.ts`](../../src/app/api/forms/templates/route.ts)
- `/api/forms/templates/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/templates/[templateId]/route.ts`](../../src/app/api/forms/templates/%5BtemplateId%5D/route.ts)
- `/api/forms/types` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/types/route.ts`](../../src/app/api/forms/types/route.ts)
- `/api/forms/types/` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/types/[typeId]/route.ts`](../../src/app/api/forms/types/%5BtypeId%5D/route.ts)
- `/api/forms/upload` — interface [`src/features/forms/lib/client.ts`](../../src/features/forms/lib/client.ts); rota candidata [`src/app/api/forms/upload/route.ts`](../../src/app/api/forms/upload/route.ts)

## `goals`

Páginas: [`src/app/dashboard/goals/analysis/page.tsx`](../../src/app/dashboard/goals/analysis/page.tsx), [`src/app/dashboard/goals/history/page.tsx`](../../src/app/dashboard/goals/history/page.tsx), [`src/app/dashboard/goals/registration/page.tsx`](../../src/app/dashboard/goals/registration/page.tsx), [`src/app/dashboard/goals/tracking/page.tsx`](../../src/app/dashboard/goals/tracking/page.tsx).

Arquivos locais percorridos: 52.

Chamadas candidatas encontradas:

- `/api/ai/analyze-goals` — interface [`src/components/goals-tracking-dashboard.tsx`](../../src/components/goals-tracking-dashboard.tsx); rota candidata [`src/app/api/ai/analyze-goals/route.ts`](../../src/app/api/ai/analyze-goals/route.ts)
- `/api/catalogo` — interface [`src/components/product-simulation-category-provider.tsx`](../../src/components/product-simulation-category-provider.tsx); rota candidata [`src/app/api/catalogo/route.ts`](../../src/app/api/catalogo/route.ts)
- `/api/dp/schedules/` — interface [`src/hooks/use-dp-shifts.ts`](../../src/hooks/use-dp-shifts.ts)
- `/api/registry/base-products` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/base-products/` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `baseProducts` — [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `channels` — [`src/components/channels-provider.tsx`](../../src/components/channels-provider.tsx)
- `dp_schedules` — [`src/hooks/use-dp-shifts.ts`](../../src/hooks/use-dp-shifts.ts)
- `goalMethodConfigs` — [`src/hooks/use-goal-method-configs.ts`](../../src/hooks/use-goal-method-configs.ts)
- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)
- `priceOverrides` — [`src/components/channels-provider.tsx`](../../src/components/channels-provider.tsx)
- `productSimulationCategories` — [`src/components/product-simulation-category-provider.tsx`](../../src/components/product-simulation-category-provider.tsx)
- `productSimulationItems` — [`src/components/product-simulation-provider.tsx`](../../src/components/product-simulation-provider.tsx)
- `productSimulations` — [`src/components/channels-provider.tsx`](../../src/components/channels-provider.tsx)
- `settings` — [`src/components/company-settings-provider.tsx`](../../src/components/company-settings-provider.tsx)
- `simulationPriceHistory` — [`src/components/product-simulation-provider.tsx`](../../src/components/product-simulation-provider.tsx)
- `users` — [`src/components/goals-tracking-dashboard.tsx`](../../src/components/goals-tracking-dashboard.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `goals.manage` — [`src/app/dashboard/goals/history/page.tsx`](../../src/app/dashboard/goals/history/page.tsx)
- `goals.view` — [`src/app/dashboard/goals/analysis/page.tsx`](../../src/app/dashboard/goals/analysis/page.tsx)
- `settings.manageUsers` — [`src/app/dashboard/goals/history/page.tsx`](../../src/app/dashboard/goals/history/page.tsx)

## `help`

Páginas: [`src/app/dashboard/help/page.tsx`](../../src/app/dashboard/help/page.tsx).

Arquivos locais percorridos: 4.

Nenhuma string de API encontrada no percurso estático; investigar chamadas indiretas, ações de servidor e SDKs.

## `hr-integration`

Páginas: [`src/app/dashboard/hr/recruitment/integration/page.tsx`](../../src/app/dashboard/hr/recruitment/integration/page.tsx).

Arquivos locais percorridos: 40.

Chamadas candidatas encontradas:

- `/api/documents/generate` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/documents/generate/route.ts`](../../src/app/api/documents/generate/route.ts)
- `/api/hr/aso-clinics` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/hr/aso-clinics/route.ts`](../../src/app/api/hr/aso-clinics/route.ts)
- `/api/hr/bootstrap` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/bootstrap/route.ts`](../../src/app/api/hr/bootstrap/route.ts)
- `/api/hr/candidates` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/candidates/route.ts`](../../src/app/api/hr/candidates/route.ts)
- `/api/hr/candidates/` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/candidates/[id]/route.ts`](../../src/app/api/hr/candidates/%5Bid%5D/route.ts)
- `/api/hr/departments` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/departments/route.ts`](../../src/app/api/hr/departments/route.ts)
- `/api/hr/departments/` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/departments/[departmentId]/route.ts`](../../src/app/api/hr/departments/%5BdepartmentId%5D/route.ts)
- `/api/hr/functions` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/functions/route.ts`](../../src/app/api/hr/functions/route.ts)
- `/api/hr/functions/` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/functions/[functionId]/route.ts`](../../src/app/api/hr/functions/%5BfunctionId%5D/route.ts)
- `/api/hr/integration-templates` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/hr/integration-templates/route.ts`](../../src/app/api/hr/integration-templates/route.ts)
- `/api/hr/integration-templates/` — interface [`src/features/hr/integration/client.ts`](../../src/features/hr/integration/client.ts); rota candidata [`src/app/api/hr/integration-templates/[templateId]/route.ts`](../../src/app/api/hr/integration-templates/%5BtemplateId%5D/route.ts)
- `/api/hr/integrations/pdvlegal/catalog` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/hr/integrations/pdvlegal/catalog/route.ts`](../../src/app/api/hr/integrations/pdvlegal/catalog/route.ts)
- `/api/hr/login-access` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/login-access/route.ts`](../../src/app/api/hr/login-access/route.ts)
- `/api/hr/login-access/audit` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/login-access/audit/route.ts`](../../src/app/api/hr/login-access/audit/route.ts)
- `/api/hr/onboarding` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/hr/onboarding/route.ts`](../../src/app/api/hr/onboarding/route.ts)
- `/api/hr/onboarding/` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/hr/onboarding/[id]/route.ts`](../../src/app/api/hr/onboarding/%5Bid%5D/route.ts)
- `/api/hr/onboarding/access-catalog` — interface [`src/features/hr/onboarding-pj/detail-panel.tsx`](../../src/features/hr/onboarding-pj/detail-panel.tsx); rota candidata [`src/app/api/hr/onboarding/access-catalog/route.ts`](../../src/app/api/hr/onboarding/access-catalog/route.ts)
- `/api/hr/openings` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/openings/route.ts`](../../src/app/api/hr/openings/route.ts)
- `/api/hr/openings/` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/openings/[id]/route.ts`](../../src/app/api/hr/openings/%5Bid%5D/route.ts)
- `/api/hr/recruitment/forms/talent-pool` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/recruitment/forms/talent-pool/route.ts`](../../src/app/api/hr/recruitment/forms/talent-pool/route.ts)
- `/api/hr/roles` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/roles/route.ts`](../../src/app/api/hr/roles/route.ts)
- `/api/hr/roles/` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/roles/[roleId]/route.ts`](../../src/app/api/hr/roles/%5BroleId%5D/route.ts)
- `/api/hr/upload` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/hr/upload/route.ts`](../../src/app/api/hr/upload/route.ts)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `dp.collaborators.edit` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `dp.collaborators.view` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `dp.view` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `recruitment.manage` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `recruitment.pipeline.manage` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `recruitment.pipeline.view` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `recruitment.view` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `settings.manageUsers` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)

## `inventory-conversion`

Páginas: [`src/app/dashboard/inventory/page.tsx`](../../src/app/dashboard/inventory/page.tsx).

Arquivos locais percorridos: 10.

Chamadas candidatas encontradas:

- `/api/registry/products` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/registry/products/` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `products` — [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)

## `measure-conversion`

Páginas: [`src/app/dashboard/conversions/page.tsx`](../../src/app/dashboard/conversions/page.tsx).

Arquivos locais percorridos: 7.

Nenhuma string de API encontrada no percurso estático; investigar chamadas indiretas, ações de servidor e SDKs.

## `operations`

Páginas: [`src/app/dashboard/operations/page.tsx`](../../src/app/dashboard/operations/page.tsx).

Arquivos locais percorridos: 53.

Chamadas candidatas encontradas:

- `/api/registry/base-products` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/base-products/` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/products` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/registry/products/` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/registry/stock-audit` — interface [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)
- `/api/registry/stock-audit/` — interface [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)
- `/api/stock/count-sessions` — interface [`src/components/audit-dashboard.tsx`](../../src/components/audit-dashboard.tsx); rota candidata [`src/app/api/stock/count-sessions/route.ts`](../../src/app/api/stock/count-sessions/route.ts)
- `/api/stock/reposition-activities` — interface [`src/features/reposition/lib/client.ts`](../../src/features/reposition/lib/client.ts); rota candidata [`src/app/api/stock/reposition-activities/route.ts`](../../src/app/api/stock/reposition-activities/route.ts)
- `/api/stock/reposition-activities/` — interface [`src/features/reposition/lib/client.ts`](../../src/features/reposition/lib/client.ts); rota candidata [`src/app/api/stock/reposition-activities/[activityId]/route.ts`](../../src/app/api/stock/reposition-activities/%5BactivityId%5D/route.ts)
- `/api/stock/return-requests` — interface [`src/features/return-requests/lib/client.ts`](../../src/features/return-requests/lib/client.ts); rota candidata [`src/app/api/stock/return-requests/route.ts`](../../src/app/api/stock/return-requests/route.ts)
- `/api/stock/return-requests/` — interface [`src/features/return-requests/lib/client.ts`](../../src/features/return-requests/lib/client.ts); rota candidata [`src/app/api/stock/return-requests/[requestId]/route.ts`](../../src/app/api/stock/return-requests/%5BrequestId%5D/route.ts)
- `/api/tasks` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/route.ts`](../../src/app/api/tasks/route.ts)
- `/api/tasks/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/[taskId]/route.ts`](../../src/app/api/tasks/%5BtaskId%5D/route.ts)
- `/api/tasks/projects` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/projects/route.ts`](../../src/app/api/tasks/projects/route.ts)
- `/api/tasks/projects/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/projects/[projectId]/route.ts`](../../src/app/api/tasks/projects/%5BprojectId%5D/route.ts)
- `/api/tasks/purchase-receipt-sync` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/purchase-receipt-sync/route.ts`](../../src/app/api/tasks/purchase-receipt-sync/route.ts)
- `/api/tasks/statuses` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/statuses/route.ts`](../../src/app/api/tasks/statuses/route.ts)
- `/api/tasks/statuses/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/statuses/[statusId]/route.ts`](../../src/app/api/tasks/statuses/%5BstatusId%5D/route.ts)
- `/api/tasks/subprojects` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/subprojects/route.ts`](../../src/app/api/tasks/subprojects/route.ts)
- `/api/tasks/subprojects/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/subprojects/[subprojectId]/route.ts`](../../src/app/api/tasks/subprojects/%5BsubprojectId%5D/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `baseProducts` — [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `consumptionReports` — [`src/components/consumption-analysis-provider.tsx`](../../src/components/consumption-analysis-provider.tsx)
- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)
- `lots` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `movementHistory` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `products` — [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `profiles` — [`src/components/profiles-provider.tsx`](../../src/components/profiles-provider.tsx)
- `salesReports` — [`src/components/consumption-analysis-provider.tsx`](../../src/components/consumption-analysis-provider.tsx)
- `stockAuditSessions` — [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `dashboard.view` — [`src/app/dashboard/operations/page.tsx`](../../src/app/dashboard/operations/page.tsx)
- `reposition.prepareDispatch` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `reposition.receive` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `reposition.view` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `stock.audit.view` — [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)
- `stock.returns.updateStatus` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `stock.stockCount.approve` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `stock.stockCount.perform` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `stock.stockCount.view` — [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)
- `tasks.view` — [`src/app/dashboard/operations/page.tsx`](../../src/app/dashboard/operations/page.tsx)

## `organization`

Páginas: [`src/app/dashboard/hr/org-chart/page.tsx`](../../src/app/dashboard/hr/org-chart/page.tsx).

Arquivos locais percorridos: 8.

Chamadas candidatas encontradas:

- `/api/hr/bootstrap` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/bootstrap/route.ts`](../../src/app/api/hr/bootstrap/route.ts)
- `/api/hr/departments` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/departments/route.ts`](../../src/app/api/hr/departments/route.ts)
- `/api/hr/departments/` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/departments/[departmentId]/route.ts`](../../src/app/api/hr/departments/%5BdepartmentId%5D/route.ts)
- `/api/hr/functions` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/functions/route.ts`](../../src/app/api/hr/functions/route.ts)
- `/api/hr/functions/` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/functions/[functionId]/route.ts`](../../src/app/api/hr/functions/%5BfunctionId%5D/route.ts)
- `/api/hr/login-access` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/login-access/route.ts`](../../src/app/api/hr/login-access/route.ts)
- `/api/hr/login-access/audit` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/login-access/audit/route.ts`](../../src/app/api/hr/login-access/audit/route.ts)
- `/api/hr/roles` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/roles/route.ts`](../../src/app/api/hr/roles/route.ts)
- `/api/hr/roles/` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/roles/[roleId]/route.ts`](../../src/app/api/hr/roles/%5BroleId%5D/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `profiles` — [`src/components/profiles-provider.tsx`](../../src/components/profiles-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `dp.collaborators.edit` — [`src/hooks/use-hr-bootstrap.ts`](../../src/hooks/use-hr-bootstrap.ts)
- `dp.collaborators.terminate` — [`src/hooks/use-hr-bootstrap.ts`](../../src/hooks/use-hr-bootstrap.ts)
- `dp.view` — [`src/hooks/use-hr-bootstrap.ts`](../../src/hooks/use-hr-bootstrap.ts)
- `settings.manageUsers` — [`src/hooks/use-hr-bootstrap.ts`](../../src/hooks/use-hr-bootstrap.ts)

## `payment-requests`

Páginas: [`src/app/dashboard/financial/expenses/authorizations/page.tsx`](../../src/app/dashboard/financial/expenses/authorizations/page.tsx).

Arquivos locais percorridos: 19.

Chamadas candidatas encontradas:

- `/api/financial/payment-requests` — interface [`src/features/financial/payment-requests/payment-requests-page.tsx`](../../src/features/financial/payment-requests/payment-requests-page.tsx); rota candidata [`src/app/api/financial/payment-requests/route.ts`](../../src/app/api/financial/payment-requests/route.ts)
- `/api/financial/payment-requests/` — interface [`src/features/financial/payment-requests/payment-requests-page.tsx`](../../src/features/financial/payment-requests/payment-requests-page.tsx); rota candidata [`src/app/api/financial/payment-requests/route.ts`](../../src/app/api/financial/payment-requests/route.ts)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `financial.paymentRequests` — [`src/features/financial/payment-requests/payment-requests-page.tsx`](../../src/features/financial/payment-requests/payment-requests-page.tsx)

## `pdv-sync`

Páginas: [`src/app/dashboard/settings/pdv-sync/page.tsx`](../../src/app/dashboard/settings/pdv-sync/page.tsx).

Arquivos locais percorridos: 16.

Nenhuma string de API encontrada no percurso estático; investigar chamadas indiretas, ações de servidor e SDKs.

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `settings.view` — [`src/app/dashboard/settings/pdv-sync/page.tsx`](../../src/app/dashboard/settings/pdv-sync/page.tsx)

## `people-access`

Páginas: [`src/app/dashboard/dp/collaborators/[userId]/documents/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/documents/page.tsx), [`src/app/dashboard/dp/collaborators/[userId]/edit/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/edit/page.tsx), [`src/app/dashboard/dp/collaborators/[userId]/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/page.tsx), [`src/app/dashboard/dp/collaborators/page.tsx`](../../src/app/dashboard/dp/collaborators/page.tsx), [`src/app/dashboard/users/inactive/page.tsx`](../../src/app/dashboard/users/inactive/page.tsx).

Arquivos locais percorridos: 67.

Chamadas candidatas encontradas:

- `/api/audit/log` — interface [`src/features/audit/client.ts`](../../src/features/audit/client.ts); rota candidata [`src/app/api/audit/log/route.ts`](../../src/app/api/audit/log/route.ts)
- `/api/audit/logs` — interface [`src/features/audit/client.ts`](../../src/features/audit/client.ts); rota candidata [`src/app/api/audit/logs/route.ts`](../../src/app/api/audit/logs/route.ts)
- `/api/hr/bootstrap` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/bootstrap/route.ts`](../../src/app/api/hr/bootstrap/route.ts)
- `/api/hr/collaborators/` — interface [`src/app/dashboard/dp/collaborators/[userId]/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/page.tsx)
- `/api/hr/departments` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/departments/route.ts`](../../src/app/api/hr/departments/route.ts)
- `/api/hr/departments/` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/departments/[departmentId]/route.ts`](../../src/app/api/hr/departments/%5BdepartmentId%5D/route.ts)
- `/api/hr/employee-documents` — interface [`src/app/dashboard/dp/collaborators/[userId]/documents/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/documents/page.tsx); rota candidata [`src/app/api/hr/employee-documents/route.ts`](../../src/app/api/hr/employee-documents/route.ts)
- `/api/hr/employee-documents/access` — interface [`src/app/dashboard/dp/collaborators/[userId]/documents/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/documents/page.tsx); rota candidata [`src/app/api/hr/employee-documents/access/route.ts`](../../src/app/api/hr/employee-documents/access/route.ts)
- `/api/hr/employee-documents/analyze-upload` — interface [`src/app/dashboard/dp/collaborators/[userId]/documents/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/documents/page.tsx); rota candidata [`src/app/api/hr/employee-documents/analyze-upload/route.ts`](../../src/app/api/hr/employee-documents/analyze-upload/route.ts)
- `/api/hr/employee-documents/batches` — interface [`src/app/dashboard/dp/collaborators/[userId]/documents/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/documents/page.tsx); rota candidata [`src/app/api/hr/employee-documents/batches/route.ts`](../../src/app/api/hr/employee-documents/batches/route.ts)
- `/api/hr/employee-documents/confirm` — interface [`src/app/dashboard/dp/collaborators/[userId]/documents/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/documents/page.tsx); rota candidata [`src/app/api/hr/employee-documents/confirm/route.ts`](../../src/app/api/hr/employee-documents/confirm/route.ts)
- `/api/hr/employee-documents/item` — interface [`src/app/dashboard/dp/collaborators/[userId]/documents/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/documents/page.tsx); rota candidata [`src/app/api/hr/employee-documents/item/route.ts`](../../src/app/api/hr/employee-documents/item/route.ts)
- `/api/hr/employee-documents/reanalyze` — interface [`src/app/dashboard/dp/collaborators/[userId]/documents/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/documents/page.tsx); rota candidata [`src/app/api/hr/employee-documents/reanalyze/route.ts`](../../src/app/api/hr/employee-documents/reanalyze/route.ts)
- `/api/hr/employee-documents/visibility` — interface [`src/app/dashboard/dp/collaborators/[userId]/documents/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/documents/page.tsx); rota candidata [`src/app/api/hr/employee-documents/visibility/route.ts`](../../src/app/api/hr/employee-documents/visibility/route.ts)
- `/api/hr/functions` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/functions/route.ts`](../../src/app/api/hr/functions/route.ts)
- `/api/hr/functions/` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/functions/[functionId]/route.ts`](../../src/app/api/hr/functions/%5BfunctionId%5D/route.ts)
- `/api/hr/integrations/pdvlegal/catalog` — interface [`src/app/dashboard/dp/collaborators/[userId]/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/page.tsx); rota candidata [`src/app/api/hr/integrations/pdvlegal/catalog/route.ts`](../../src/app/api/hr/integrations/pdvlegal/catalog/route.ts)
- `/api/hr/login-access` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/login-access/route.ts`](../../src/app/api/hr/login-access/route.ts)
- `/api/hr/login-access/audit` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/login-access/audit/route.ts`](../../src/app/api/hr/login-access/audit/route.ts)
- `/api/hr/roles` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/roles/route.ts`](../../src/app/api/hr/roles/route.ts)
- `/api/hr/roles/` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/roles/[roleId]/route.ts`](../../src/app/api/hr/roles/%5BroleId%5D/route.ts)
- `/api/hr/terminations` — interface [`src/features/hr/termination/client.ts`](../../src/features/hr/termination/client.ts); rota candidata [`src/app/api/hr/terminations/route.ts`](../../src/app/api/hr/terminations/route.ts)
- `/api/rh/employee-profile/` — interface [`src/features/rh/hooks/useEmployeeProfile.ts`](../../src/features/rh/hooks/useEmployeeProfile.ts); rota candidata [`src/app/api/rh/employee-profile/[employeeId]/route.ts`](../../src/app/api/rh/employee-profile/%5BemployeeId%5D/route.ts)
- `/api/rh/field-map` — interface [`src/app/dashboard/dp/collaborators/[userId]/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/page.tsx); rota candidata [`src/app/api/rh/field-map/route.ts`](../../src/app/api/rh/field-map/route.ts)
- `/api/uniforms` — interface [`src/features/uniforms/client.ts`](../../src/features/uniforms/client.ts); rota candidata [`src/app/api/uniforms/route.ts`](../../src/app/api/uniforms/route.ts)
- `/api/uniforms/deliver` — interface [`src/features/uniforms/client.ts`](../../src/features/uniforms/client.ts); rota candidata [`src/app/api/uniforms/deliver/route.ts`](../../src/app/api/uniforms/deliver/route.ts)
- `/api/uniforms/exchange` — interface [`src/features/uniforms/client.ts`](../../src/features/uniforms/client.ts); rota candidata [`src/app/api/uniforms/exchange/route.ts`](../../src/app/api/uniforms/exchange/route.ts)
- `/api/uniforms/return` — interface [`src/features/uniforms/client.ts`](../../src/features/uniforms/client.ts); rota candidata [`src/app/api/uniforms/return/route.ts`](../../src/app/api/uniforms/return/route.ts)
- `/api/uniforms/terms/` — interface [`src/components/collaborator-uniforms.tsx`](../../src/components/collaborator-uniforms.tsx); rota candidata [`src/app/api/uniforms/terms/[id]/route.ts`](../../src/app/api/uniforms/terms/%5Bid%5D/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)
- `profiles` — [`src/components/profiles-provider.tsx`](../../src/components/profiles-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `assets.create` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `assets.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `assets.printLabels` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `assets.retire` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `assets.transfer` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `assets.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `assets.viewHistory` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `commercial.technicalSheets.create` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `commercial.technicalSheets.delete` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `commercial.technicalSheets.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `commercial.technicalSheets.export` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `commercial.technicalSheets.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dashboard.audit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dashboard.collaborator` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dashboard.operational` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dashboard.technicalSheets` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dashboard.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.collaborators.add` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.collaborators.edit` — [`src/app/dashboard/dp/collaborators/[userId]/documents/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/documents/page.tsx)
- `dp.collaborators.ownProfileOnly` — [`src/app/dashboard/dp/collaborators/[userId]/documents/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/documents/page.tsx)
- `dp.collaborators.syncProfile` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.collaborators.terminate` — [`src/app/dashboard/dp/collaborators/[userId]/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/page.tsx)
- `dp.collaborators.view` — [`src/app/dashboard/dp/collaborators/[userId]/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/page.tsx)
- `dp.schedules.create` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.schedules.delete` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.schedules.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.schedules.export` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.schedules.publishBizneo` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.schedules.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.settings.manageCalendars` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.settings.manageShifts` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.settings.manageUnits` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.vacation.approve` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.vacation.manageSettings` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.vacation.request` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.vacation.viewAll` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.audits.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.audits.effectuate` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.audits.ignore` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.audits.import` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.audits.manage` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.audits.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cardStatements.audit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cardStatements.close` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cardStatements.import` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cardStatements.reconcile` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cardStatements.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashClosures.adjustExpected` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashClosures.approve` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashClosures.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashClosures.reopen` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashClosures.resync` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashClosures.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashDeposits.adjust` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashDeposits.cancel` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashDeposits.issue` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashDeposits.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashFlow.create` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashFlow.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.dashboard` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.dre` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.expenses.create` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.expenses.delete` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.expenses.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.expenses.pay` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.expenses.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.inbox.analyze` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.inbox.discard` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.inbox.link` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.inbox.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.interIntegration.manage` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.paymentRequests.authorize` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.paymentRequests.create` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.paymentRequests.refresh` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.paymentRequests.submit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.paymentRequests.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.paymentRequests.viewProof` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.personnelCosts.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.personnelCosts.export` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.personnelCosts.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.reconciliation.administer` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.reconciliation.classifyAdjustments` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.reconciliation.confirm` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.reconciliation.correct` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.reconciliation.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.settings.manageAccountPlans` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.settings.manageBankAccounts` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.settings.manageBudgets` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.settings.manageExpenseDescriptions` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.settings.manageImportAliases` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.settings.manageResultCenters` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.settings.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `forms.global.create_projects` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `forms.global.manage_templates` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `forms.global.view_all_projects` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `forms.global.view_analytics` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `goals.manage` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `goals.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `help.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.companyDocuments.manage` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.companyDocuments.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.consents.manage` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.consents.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.signatures.send` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.signatures.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.templates.manage` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.templates.publish` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.templates.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `itemRequests.add` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `itemRequests.approve` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `pricing.manageParameters` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `pricing.simulate` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `pricing.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `purchasing.cancelPurchase` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `purchasing.createPurchase` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `purchasing.createQuotation` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `purchasing.finalizeQuotation` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `purchasing.manageBaseItems` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `purchasing.manageFinancialLink` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `purchasing.receivePurchase` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `purchasing.revertPurchaseStage` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `purchasing.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `registration.baseProducts.add` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `registration.baseProducts.delete` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `registration.baseProducts.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `registration.entities.add` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `registration.entities.delete` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `registration.entities.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `registration.items.add` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `registration.items.delete` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `registration.items.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `registration.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `reposition.cancel` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `reposition.finalize` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `reposition.prepareDispatch` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `reposition.receive` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `reposition.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `settings.manageKiosks` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `settings.manageLabels` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `settings.manageProfiles` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `settings.managePublicBio` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `settings.manageUsers` — [`src/app/dashboard/dp/collaborators/[userId]/documents/page.tsx`](../../src/app/dashboard/dp/collaborators/%5BuserId%5D/documents/page.tsx)
- `settings.view` — [`src/components/inactive-users-screen.tsx`](../../src/components/inactive-users-screen.tsx)
- `settings.viewAiCosts` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `signage.manage` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `signage.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.analysis.consumption` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.analysis.projection` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.analysis.restock` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.analysis.valuation` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.analysis.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.audit.approve` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.audit.start` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.audit.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.conversions.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.inventoryControl.addLot` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.inventoryControl.editLot` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.inventoryControl.transfer` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.inventoryControl.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.inventoryControl.viewHistory` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.inventoryControl.writeDown` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.purchasing.approve` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.purchasing.deleteHistory` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.purchasing.suggest` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.purchasing.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.returns.add` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.returns.delete` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.returns.updateStatus` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.returns.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.stockCount.approve` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.stockCount.perform` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.stockCount.requestItem` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.stockCount.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.uniforms.deliver` — [`src/components/collaborator-uniforms.tsx`](../../src/components/collaborator-uniforms.tsx)
- `stock.uniforms.return` — [`src/components/collaborator-uniforms.tsx`](../../src/components/collaborator-uniforms.tsx)
- `stock.uniforms.view` — [`src/components/collaborator-uniforms.tsx`](../../src/components/collaborator-uniforms.tsx)
- `stock.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `tasks.manage` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `tasks.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)

## `platform-home`

Páginas: [`src/app/dashboard/page.tsx`](../../src/app/dashboard/page.tsx).

Arquivos locais percorridos: 36.

Chamadas candidatas encontradas:

- `/api/dp/schedules/` — interface [`src/hooks/use-dp-shifts.ts`](../../src/hooks/use-dp-shifts.ts)
- `/api/financial/data` — interface [`src/features/financial/hooks/use-financial-collection.tsx`](../../src/features/financial/hooks/use-financial-collection.tsx); rota candidata [`src/app/api/financial/data/route.ts`](../../src/app/api/financial/data/route.ts)
- `/api/registry/base-products` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/base-products/` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/products` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/registry/products/` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/registry/stock-audit` — interface [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)
- `/api/registry/stock-audit/` — interface [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)
- `/api/stock/reposition-activities` — interface [`src/features/reposition/lib/client.ts`](../../src/features/reposition/lib/client.ts); rota candidata [`src/app/api/stock/reposition-activities/route.ts`](../../src/app/api/stock/reposition-activities/route.ts)
- `/api/stock/reposition-activities/` — interface [`src/features/reposition/lib/client.ts`](../../src/features/reposition/lib/client.ts); rota candidata [`src/app/api/stock/reposition-activities/[activityId]/route.ts`](../../src/app/api/stock/reposition-activities/%5BactivityId%5D/route.ts)
- `/api/stock/return-requests` — interface [`src/features/return-requests/lib/client.ts`](../../src/features/return-requests/lib/client.ts); rota candidata [`src/app/api/stock/return-requests/route.ts`](../../src/app/api/stock/return-requests/route.ts)
- `/api/stock/return-requests/` — interface [`src/features/return-requests/lib/client.ts`](../../src/features/return-requests/lib/client.ts); rota candidata [`src/app/api/stock/return-requests/[requestId]/route.ts`](../../src/app/api/stock/return-requests/%5BrequestId%5D/route.ts)
- `/api/tasks` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/route.ts`](../../src/app/api/tasks/route.ts)
- `/api/tasks/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/[taskId]/route.ts`](../../src/app/api/tasks/%5BtaskId%5D/route.ts)
- `/api/tasks/projects` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/projects/route.ts`](../../src/app/api/tasks/projects/route.ts)
- `/api/tasks/projects/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/projects/[projectId]/route.ts`](../../src/app/api/tasks/projects/%5BprojectId%5D/route.ts)
- `/api/tasks/purchase-receipt-sync` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/purchase-receipt-sync/route.ts`](../../src/app/api/tasks/purchase-receipt-sync/route.ts)
- `/api/tasks/statuses` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/statuses/route.ts`](../../src/app/api/tasks/statuses/route.ts)
- `/api/tasks/statuses/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/statuses/[statusId]/route.ts`](../../src/app/api/tasks/statuses/%5BstatusId%5D/route.ts)
- `/api/tasks/subprojects` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/subprojects/route.ts`](../../src/app/api/tasks/subprojects/route.ts)
- `/api/tasks/subprojects/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/subprojects/[subprojectId]/route.ts`](../../src/app/api/tasks/subprojects/%5BsubprojectId%5D/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `baseProducts` — [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `consumptionReports` — [`src/components/consumption-analysis-provider.tsx`](../../src/components/consumption-analysis-provider.tsx)
- `dp_schedules` — [`src/hooks/use-dp-shifts.ts`](../../src/hooks/use-dp-shifts.ts)
- `employeeGoals` — [`src/components/goals-provider.tsx`](../../src/components/goals-provider.tsx)
- `goalPeriods` — [`src/components/goals-provider.tsx`](../../src/components/goals-provider.tsx)
- `goalTemplates` — [`src/components/goals-provider.tsx`](../../src/components/goals-provider.tsx)
- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)
- `lots` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `movementHistory` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `products` — [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `salesReports` — [`src/components/consumption-analysis-provider.tsx`](../../src/components/consumption-analysis-provider.tsx)
- `stockAuditSessions` — [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `dashboard.collaborator` — [`src/app/dashboard/page.tsx`](../../src/app/dashboard/page.tsx)
- `dashboard.operational` — [`src/app/dashboard/page.tsx`](../../src/app/dashboard/page.tsx)
- `dashboard.view` — [`src/app/dashboard/page.tsx`](../../src/app/dashboard/page.tsx)
- `dp.view` — [`src/app/dashboard/page.tsx`](../../src/app/dashboard/page.tsx)
- `financial.view` — [`src/app/dashboard/page.tsx`](../../src/app/dashboard/page.tsx)
- `goals.view` — [`src/app/dashboard/page.tsx`](../../src/app/dashboard/page.tsx)
- `pricing.view` — [`src/app/dashboard/page.tsx`](../../src/app/dashboard/page.tsx)
- `reposition.prepareDispatch` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `reposition.receive` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `reposition.view` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `stock.audit.view` — [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)
- `stock.returns.updateStatus` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `stock.stockCount.approve` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `stock.stockCount.perform` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `stock.stockCount.view` — [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)

## `pricing`

Páginas: [`src/app/dashboard/pricing/cost-analysis/page.tsx`](../../src/app/dashboard/pricing/cost-analysis/page.tsx), [`src/app/dashboard/pricing/price-comparison/page.tsx`](../../src/app/dashboard/pricing/price-comparison/page.tsx).

Arquivos locais percorridos: 69.

Chamadas candidatas encontradas:

- `/api/catalogo` — interface [`src/components/product-simulation-category-provider.tsx`](../../src/components/product-simulation-category-provider.tsx); rota candidata [`src/app/api/catalogo/route.ts`](../../src/app/api/catalogo/route.ts)
- `/api/registry/base-products` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/base-products/` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/products` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/registry/products/` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `baseProducts` — [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `channels` — [`src/components/channels-provider.tsx`](../../src/components/channels-provider.tsx)
- `competitorGroups` — [`src/components/competitor-provider.tsx`](../../src/components/competitor-provider.tsx)
- `concorrente_precos` — [`src/components/competitor-provider.tsx`](../../src/components/competitor-provider.tsx)
- `concorrente_produtos` — [`src/components/competitor-provider.tsx`](../../src/components/competitor-provider.tsx)
- `concorrentes` — [`src/components/competitor-provider.tsx`](../../src/components/competitor-provider.tsx)
- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)
- `priceHistory` — [`src/components/purchase-provider.tsx`](../../src/components/purchase-provider.tsx)
- `priceOverrides` — [`src/components/channels-provider.tsx`](../../src/components/channels-provider.tsx)
- `productSimulationCategories` — [`src/components/product-simulation-category-provider.tsx`](../../src/components/product-simulation-category-provider.tsx)
- `productSimulationItems` — [`src/components/product-simulation-provider.tsx`](../../src/components/product-simulation-provider.tsx)
- `productSimulations` — [`src/components/channels-provider.tsx`](../../src/components/channels-provider.tsx)
- `products` — [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `purchaseItems` — [`src/components/purchase-provider.tsx`](../../src/components/purchase-provider.tsx)
- `purchaseSessions` — [`src/components/purchase-provider.tsx`](../../src/components/purchase-provider.tsx)
- `settings` — [`src/components/company-settings-provider.tsx`](../../src/components/company-settings-provider.tsx)
- `simulationPriceHistory` — [`src/components/product-simulation-provider.tsx`](../../src/components/product-simulation-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `pricing.manageParameters` — [`src/components/pricing-simulator.tsx`](../../src/components/pricing-simulator.tsx)
- `pricing.view` — [`src/app/dashboard/pricing/cost-analysis/page.tsx`](../../src/app/dashboard/pricing/cost-analysis/page.tsx)

## `purchasing`

Páginas: [`src/app/dashboard/purchasing/costs/page.tsx`](../../src/app/dashboard/purchasing/costs/page.tsx), [`src/app/dashboard/purchasing/orders/[orderId]/page.tsx`](../../src/app/dashboard/purchasing/orders/%5BorderId%5D/page.tsx), [`src/app/dashboard/purchasing/orders/[orderId]/receipt/page.tsx`](../../src/app/dashboard/purchasing/orders/%5BorderId%5D/receipt/page.tsx), [`src/app/dashboard/purchasing/orders/page.tsx`](../../src/app/dashboard/purchasing/orders/page.tsx), [`src/app/dashboard/purchasing/quotations/[quotationId]/confirm-purchase/page.tsx`](../../src/app/dashboard/purchasing/quotations/%5BquotationId%5D/confirm-purchase/page.tsx), [`src/app/dashboard/purchasing/quotations/[quotationId]/page.tsx`](../../src/app/dashboard/purchasing/quotations/%5BquotationId%5D/page.tsx), [`src/app/dashboard/purchasing/quotations/compare/page.tsx`](../../src/app/dashboard/purchasing/quotations/compare/page.tsx), [`src/app/dashboard/purchasing/quotations/page.tsx`](../../src/app/dashboard/purchasing/quotations/page.tsx), [`src/app/dashboard/purchasing/receipts/page.tsx`](../../src/app/dashboard/purchasing/receipts/page.tsx), [`src/app/dashboard/stock/purchasing/history/page.tsx`](../../src/app/dashboard/stock/purchasing/history/page.tsx), [`src/app/dashboard/stock/purchasing/sessions/[sessionId]/page.tsx`](../../src/app/dashboard/stock/purchasing/sessions/%5BsessionId%5D/page.tsx).

Arquivos locais percorridos: 91.

Chamadas candidatas encontradas:

- `/api/assets` — interface [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx); rota candidata [`src/app/api/assets/route.ts`](../../src/app/api/assets/route.ts)
- `/api/assets/` — interface [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx); rota candidata [`src/app/api/assets/[assetId]/route.ts`](../../src/app/api/assets/%5BassetId%5D/route.ts)
- `/api/assets/categories` — interface [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx); rota candidata [`src/app/api/assets/categories/route.ts`](../../src/app/api/assets/categories/route.ts)
- `/api/products/barcode/` — interface [`src/components/purchasing/quotation-item-form.tsx`](../../src/components/purchasing/quotation-item-form.tsx); rota candidata [`src/app/api/products/barcode/[codigo]/route.ts`](../../src/app/api/products/barcode/%5Bcodigo%5D/route.ts)
- `/api/purchasing/classification-options` — interface [`src/hooks/use-purchasing-financial-options.ts`](../../src/hooks/use-purchasing-financial-options.ts)
- `/api/purchasing/orders` — interface [`src/components/purchase-order-provider.tsx`](../../src/components/purchase-order-provider.tsx)
- `/api/purchasing/orders/` — interface [`src/app/dashboard/purchasing/orders/[orderId]/page.tsx`](../../src/app/dashboard/purchasing/orders/%5BorderId%5D/page.tsx)
- `/api/purchasing/quotations` — interface [`src/components/quotation-provider.tsx`](../../src/components/quotation-provider.tsx)
- `/api/purchasing/quotations/` — interface [`src/app/dashboard/purchasing/quotations/[quotationId]/confirm-purchase/page.tsx`](../../src/app/dashboard/purchasing/quotations/%5BquotationId%5D/confirm-purchase/page.tsx)
- `/api/purchasing/receipts/` — interface [`src/components/purchase-receipt-provider.tsx`](../../src/components/purchase-receipt-provider.tsx)
- `/api/registry/base-products` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/base-products/` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/entities` — interface [`src/components/entities-provider.tsx`](../../src/components/entities-provider.tsx)
- `/api/registry/entities/` — interface [`src/components/entities-provider.tsx`](../../src/components/entities-provider.tsx)
- `/api/registry/operational-categories` — interface [`src/components/operational-item-categories-provider.tsx`](../../src/components/operational-item-categories-provider.tsx)
- `/api/registry/operational-categories/` — interface [`src/components/operational-item-categories-provider.tsx`](../../src/components/operational-item-categories-provider.tsx)
- `/api/registry/products` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/registry/products/` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/tasks` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/route.ts`](../../src/app/api/tasks/route.ts)
- `/api/tasks/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/[taskId]/route.ts`](../../src/app/api/tasks/%5BtaskId%5D/route.ts)
- `/api/tasks/projects` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/projects/route.ts`](../../src/app/api/tasks/projects/route.ts)
- `/api/tasks/projects/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/projects/[projectId]/route.ts`](../../src/app/api/tasks/projects/%5BprojectId%5D/route.ts)
- `/api/tasks/purchase-receipt-sync` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/purchase-receipt-sync/route.ts`](../../src/app/api/tasks/purchase-receipt-sync/route.ts)
- `/api/tasks/statuses` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/statuses/route.ts`](../../src/app/api/tasks/statuses/route.ts)
- `/api/tasks/statuses/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/statuses/[statusId]/route.ts`](../../src/app/api/tasks/statuses/%5BstatusId%5D/route.ts)
- `/api/tasks/subprojects` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/subprojects/route.ts`](../../src/app/api/tasks/subprojects/route.ts)
- `/api/tasks/subprojects/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/subprojects/[subprojectId]/route.ts`](../../src/app/api/tasks/subprojects/%5BsubprojectId%5D/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `assetCategories` — [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx)
- `assets` — [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx)
- `baseProducts` — [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `entities` — [`src/components/entities-provider.tsx`](../../src/components/entities-provider.tsx)
- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)
- `priceHistory` — [`src/components/purchase-provider.tsx`](../../src/components/purchase-provider.tsx)
- `products` — [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `purchaseItems` — [`src/components/purchase-provider.tsx`](../../src/components/purchase-provider.tsx)
- `purchaseSessions` — [`src/components/purchase-provider.tsx`](../../src/components/purchase-provider.tsx)
- `settings` — [`src/components/company-settings-provider.tsx`](../../src/components/company-settings-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `assets.view` — [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx)

## `receivables`

Páginas: [`src/app/dashboard/financial/cash-flow/receivables/page.tsx`](../../src/app/dashboard/financial/cash-flow/receivables/page.tsx).

Arquivos locais percorridos: 20.

Chamadas candidatas encontradas:

- `/api/financial/stone-future-receivables` — interface [`src/features/financial/receivables/receivables-page.tsx`](../../src/features/financial/receivables/receivables-page.tsx); rota candidata [`src/app/api/financial/stone-future-receivables/route.ts`](../../src/app/api/financial/stone-future-receivables/route.ts)
- `/api/financial/stone-mappings` — interface [`src/features/financial/receivables/receivables-page.tsx`](../../src/features/financial/receivables/receivables-page.tsx); rota candidata [`src/app/api/financial/stone-mappings/route.ts`](../../src/app/api/financial/stone-mappings/route.ts)
- `/api/financial/stone-portfolio` — interface [`src/features/financial/receivables/portfolio-panel.tsx`](../../src/features/financial/receivables/portfolio-panel.tsx); rota candidata [`src/app/api/financial/stone-portfolio/route.ts`](../../src/app/api/financial/stone-portfolio/route.ts)
- `/api/financial/stone-wallet-position` — interface [`src/features/financial/receivables/wallet-position-panel.tsx`](../../src/features/financial/receivables/wallet-position-panel.tsx); rota candidata [`src/app/api/financial/stone-wallet-position/route.ts`](../../src/app/api/financial/stone-wallet-position/route.ts)

## `recruitment`

Páginas: [`src/app/dashboard/hr/recruitment/page.tsx`](../../src/app/dashboard/hr/recruitment/page.tsx), [`src/app/dashboard/hr/recruitment/talents/page.tsx`](../../src/app/dashboard/hr/recruitment/talents/page.tsx).

Arquivos locais percorridos: 42.

Chamadas candidatas encontradas:

- `/api/documents/generate` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/documents/generate/route.ts`](../../src/app/api/documents/generate/route.ts)
- `/api/hr/aso-clinics` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/hr/aso-clinics/route.ts`](../../src/app/api/hr/aso-clinics/route.ts)
- `/api/hr/bootstrap` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/bootstrap/route.ts`](../../src/app/api/hr/bootstrap/route.ts)
- `/api/hr/candidates` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/candidates/route.ts`](../../src/app/api/hr/candidates/route.ts)
- `/api/hr/candidates/` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/candidates/[id]/route.ts`](../../src/app/api/hr/candidates/%5Bid%5D/route.ts)
- `/api/hr/departments` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/departments/route.ts`](../../src/app/api/hr/departments/route.ts)
- `/api/hr/departments/` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/departments/[departmentId]/route.ts`](../../src/app/api/hr/departments/%5BdepartmentId%5D/route.ts)
- `/api/hr/functions` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/functions/route.ts`](../../src/app/api/hr/functions/route.ts)
- `/api/hr/functions/` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/functions/[functionId]/route.ts`](../../src/app/api/hr/functions/%5BfunctionId%5D/route.ts)
- `/api/hr/integration-templates` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/hr/integration-templates/route.ts`](../../src/app/api/hr/integration-templates/route.ts)
- `/api/hr/integration-templates/` — interface [`src/features/hr/integration/client.ts`](../../src/features/hr/integration/client.ts); rota candidata [`src/app/api/hr/integration-templates/[templateId]/route.ts`](../../src/app/api/hr/integration-templates/%5BtemplateId%5D/route.ts)
- `/api/hr/integrations/pdvlegal/catalog` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/hr/integrations/pdvlegal/catalog/route.ts`](../../src/app/api/hr/integrations/pdvlegal/catalog/route.ts)
- `/api/hr/login-access` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/login-access/route.ts`](../../src/app/api/hr/login-access/route.ts)
- `/api/hr/login-access/audit` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/login-access/audit/route.ts`](../../src/app/api/hr/login-access/audit/route.ts)
- `/api/hr/onboarding` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/hr/onboarding/route.ts`](../../src/app/api/hr/onboarding/route.ts)
- `/api/hr/onboarding/` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/hr/onboarding/[id]/route.ts`](../../src/app/api/hr/onboarding/%5Bid%5D/route.ts)
- `/api/hr/onboarding/access-catalog` — interface [`src/features/hr/onboarding-pj/detail-panel.tsx`](../../src/features/hr/onboarding-pj/detail-panel.tsx); rota candidata [`src/app/api/hr/onboarding/access-catalog/route.ts`](../../src/app/api/hr/onboarding/access-catalog/route.ts)
- `/api/hr/openings` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/openings/route.ts`](../../src/app/api/hr/openings/route.ts)
- `/api/hr/openings/` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/openings/[id]/route.ts`](../../src/app/api/hr/openings/%5Bid%5D/route.ts)
- `/api/hr/recruitment/forms/talent-pool` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/recruitment/forms/talent-pool/route.ts`](../../src/app/api/hr/recruitment/forms/talent-pool/route.ts)
- `/api/hr/roles` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/roles/route.ts`](../../src/app/api/hr/roles/route.ts)
- `/api/hr/roles/` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/roles/[roleId]/route.ts`](../../src/app/api/hr/roles/%5BroleId%5D/route.ts)
- `/api/hr/upload` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/hr/upload/route.ts`](../../src/app/api/hr/upload/route.ts)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `dp.collaborators.edit` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `dp.collaborators.view` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `dp.view` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `recruitment.manage` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `recruitment.pipeline.manage` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `recruitment.pipeline.view` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `recruitment.view` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `settings.manageUsers` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)

## `registry`

Páginas: [`src/app/dashboard/registration/base-products/page.tsx`](../../src/app/dashboard/registration/base-products/page.tsx), [`src/app/dashboard/registration/entities/page.tsx`](../../src/app/dashboard/registration/entities/page.tsx), [`src/app/dashboard/registration/items/page.tsx`](../../src/app/dashboard/registration/items/page.tsx).

Arquivos locais percorridos: 59.

Chamadas candidatas encontradas:

- `/api/companies` — interface [`src/components/entity-management.tsx`](../../src/components/entity-management.tsx); rota candidata [`src/app/api/companies/route.ts`](../../src/app/api/companies/route.ts)
- `/api/companies/` — interface [`src/components/entity-management.tsx`](../../src/components/entity-management.tsx); rota candidata [`src/app/api/companies/[id]/route.ts`](../../src/app/api/companies/%5Bid%5D/route.ts)
- `/api/companies/cnpj/` — interface [`src/components/entity-management.tsx`](../../src/components/entity-management.tsx); rota candidata [`src/app/api/companies/cnpj/[cnpj]/route.ts`](../../src/app/api/companies/cnpj/%5Bcnpj%5D/route.ts)
- `/api/companies/document-signatories` — interface [`src/components/entity-management.tsx`](../../src/components/entity-management.tsx); rota candidata [`src/app/api/companies/document-signatories/route.ts`](../../src/app/api/companies/document-signatories/route.ts)
- `/api/financial/beneficiaries/entities/` — interface [`src/components/entity-management.tsx`](../../src/components/entity-management.tsx); rota candidata [`src/app/api/financial/beneficiaries/entities/[entityId]/route.ts`](../../src/app/api/financial/beneficiaries/entities/%5BentityId%5D/route.ts)
- `/api/hr/aso-clinics` — interface [`src/components/entity-management.tsx`](../../src/components/entity-management.tsx); rota candidata [`src/app/api/hr/aso-clinics/route.ts`](../../src/app/api/hr/aso-clinics/route.ts)
- `/api/products` — interface [`src/components/add-edit-product-modal.tsx`](../../src/components/add-edit-product-modal.tsx); rota candidata [`src/app/api/products/route.ts`](../../src/app/api/products/route.ts)
- `/api/products/` — interface [`src/components/add-edit-product-modal.tsx`](../../src/components/add-edit-product-modal.tsx); rota candidata [`src/app/api/products/[id]/route.ts`](../../src/app/api/products/%5Bid%5D/route.ts)
- `/api/products/barcode/` — interface [`src/components/add-edit-product-modal.tsx`](../../src/components/add-edit-product-modal.tsx); rota candidata [`src/app/api/products/barcode/[codigo]/route.ts`](../../src/app/api/products/barcode/%5Bcodigo%5D/route.ts)
- `/api/registry/base-products` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/base-products/` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/entities` — interface [`src/components/entities-provider.tsx`](../../src/components/entities-provider.tsx)
- `/api/registry/entities/` — interface [`src/components/entities-provider.tsx`](../../src/components/entities-provider.tsx)
- `/api/registry/operational-categories` — interface [`src/components/operational-item-categories-provider.tsx`](../../src/components/operational-item-categories-provider.tsx)
- `/api/registry/operational-categories/` — interface [`src/components/operational-item-categories-provider.tsx`](../../src/components/operational-item-categories-provider.tsx)
- `/api/registry/products` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/registry/products/` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `baseProducts` — [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `classifications` — [`src/components/classifications-provider.tsx`](../../src/components/classifications-provider.tsx)
- `entities` — [`src/components/entities-provider.tsx`](../../src/components/entities-provider.tsx)
- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)
- `lots` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `movementHistory` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `predefinedLists` — [`src/components/predefined-lists-provider.tsx`](../../src/components/predefined-lists-provider.tsx)
- `priceHistory` — [`src/components/purchase-provider.tsx`](../../src/components/purchase-provider.tsx)
- `products` — [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `purchaseItems` — [`src/components/purchase-provider.tsx`](../../src/components/purchase-provider.tsx)
- `purchaseSessions` — [`src/components/purchase-provider.tsx`](../../src/components/purchase-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `registration.entities.add` — [`src/components/entity-management.tsx`](../../src/components/entity-management.tsx)
- `registration.entities.edit` — [`src/components/entity-management.tsx`](../../src/components/entity-management.tsx)
- `registration.view` — [`src/components/registration/registration-catalog.tsx`](../../src/components/registration/registration-catalog.tsx)

## `rh-bizneo`

Páginas: [`src/app/dashboard/rh/config/fields/page.tsx`](../../src/app/dashboard/rh/config/fields/page.tsx), [`src/app/dashboard/rh/config/roles/page.tsx`](../../src/app/dashboard/rh/config/roles/page.tsx), [`src/app/dashboard/rh/employees/[bizneo_employee_id]/page.tsx`](../../src/app/dashboard/rh/employees/%5Bbizneo_employee_id%5D/page.tsx), [`src/app/dashboard/rh/employees/page.tsx`](../../src/app/dashboard/rh/employees/page.tsx), [`src/app/dashboard/rh/me/page.tsx`](../../src/app/dashboard/rh/me/page.tsx), [`src/app/dashboard/rh/sync/page.tsx`](../../src/app/dashboard/rh/sync/page.tsx).

Arquivos locais percorridos: 34.

Chamadas candidatas encontradas:

- `/api/hr/functions` — interface [`src/features/rh/components/FieldConfigPage.tsx`](../../src/features/rh/components/FieldConfigPage.tsx); rota candidata [`src/app/api/hr/functions/route.ts`](../../src/app/api/hr/functions/route.ts)
- `/api/hr/roles` — interface [`src/features/rh/components/FieldConfigPage.tsx`](../../src/features/rh/components/FieldConfigPage.tsx); rota candidata [`src/app/api/hr/roles/route.ts`](../../src/app/api/hr/roles/route.ts)
- `/api/rh/employee-profile/` — interface [`src/features/rh/components/ImageVoiceConsentCard.tsx`](../../src/features/rh/components/ImageVoiceConsentCard.tsx); rota candidata [`src/app/api/rh/employee-profile/[employeeId]/route.ts`](../../src/app/api/rh/employee-profile/%5BemployeeId%5D/route.ts)
- `/api/rh/field-map` — interface [`src/features/rh/components/FieldConfigPage.tsx`](../../src/features/rh/components/FieldConfigPage.tsx); rota candidata [`src/app/api/rh/field-map/route.ts`](../../src/app/api/rh/field-map/route.ts)

## `sales-reconciliation`

Páginas: [`src/app/dashboard/financial/sales-reconciliation/page.tsx`](../../src/app/dashboard/financial/sales-reconciliation/page.tsx).

Arquivos locais percorridos: 21.

Chamadas candidatas encontradas:

- `/api/financial/pdv-stone-review` — interface [`src/features/financial/sales-reconciliation/review-page.tsx`](../../src/features/financial/sales-reconciliation/review-page.tsx); rota candidata [`src/app/api/financial/pdv-stone-review/route.ts`](../../src/app/api/financial/pdv-stone-review/route.ts)
- `/api/financial/stone-mappings` — interface [`src/features/financial/sales-reconciliation/review-page.tsx`](../../src/features/financial/sales-reconciliation/review-page.tsx); rota candidata [`src/app/api/financial/stone-mappings/route.ts`](../../src/app/api/financial/stone-mappings/route.ts)

## `settings`

Páginas: [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx), [`src/app/dashboard/settings/units/page.tsx`](../../src/app/dashboard/settings/units/page.tsx).

Arquivos locais percorridos: 218.

Chamadas candidatas encontradas:

- `/api/ai/analyze-goals` — interface [`src/components/goals-tracking-dashboard.tsx`](../../src/components/goals-tracking-dashboard.tsx); rota candidata [`src/app/api/ai/analyze-goals/route.ts`](../../src/app/api/ai/analyze-goals/route.ts)
- `/api/assets` — interface [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx); rota candidata [`src/app/api/assets/route.ts`](../../src/app/api/assets/route.ts)
- `/api/assets/` — interface [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx); rota candidata [`src/app/api/assets/[assetId]/route.ts`](../../src/app/api/assets/%5BassetId%5D/route.ts)
- `/api/assets/barcode-labels` — interface [`src/components/assets/asset-barcode-labels-panel.tsx`](../../src/components/assets/asset-barcode-labels-panel.tsx); rota candidata [`src/app/api/assets/barcode-labels/route.ts`](../../src/app/api/assets/barcode-labels/route.ts)
- `/api/assets/categories` — interface [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx); rota candidata [`src/app/api/assets/categories/route.ts`](../../src/app/api/assets/categories/route.ts)
- `/api/audit/log` — interface [`src/features/audit/client.ts`](../../src/features/audit/client.ts); rota candidata [`src/app/api/audit/log/route.ts`](../../src/app/api/audit/log/route.ts)
- `/api/audit/logs` — interface [`src/features/audit/client.ts`](../../src/features/audit/client.ts); rota candidata [`src/app/api/audit/logs/route.ts`](../../src/app/api/audit/logs/route.ts)
- `/api/catalogo` — interface [`src/components/product-simulation-category-provider.tsx`](../../src/components/product-simulation-category-provider.tsx); rota candidata [`src/app/api/catalogo/route.ts`](../../src/app/api/catalogo/route.ts)
- `/api/companies` — interface [`src/components/entity-management.tsx`](../../src/components/entity-management.tsx); rota candidata [`src/app/api/companies/route.ts`](../../src/app/api/companies/route.ts)
- `/api/companies/` — interface [`src/components/entity-management.tsx`](../../src/components/entity-management.tsx); rota candidata [`src/app/api/companies/[id]/route.ts`](../../src/app/api/companies/%5Bid%5D/route.ts)
- `/api/companies/cnpj/` — interface [`src/components/entity-management.tsx`](../../src/components/entity-management.tsx); rota candidata [`src/app/api/companies/cnpj/[cnpj]/route.ts`](../../src/app/api/companies/cnpj/%5Bcnpj%5D/route.ts)
- `/api/companies/document-signatories` — interface [`src/components/entity-management.tsx`](../../src/components/entity-management.tsx); rota candidata [`src/app/api/companies/document-signatories/route.ts`](../../src/app/api/companies/document-signatories/route.ts)
- `/api/documents/generate` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/documents/generate/route.ts`](../../src/app/api/documents/generate/route.ts)
- `/api/dp/schedules/` — interface [`src/hooks/use-dp-shifts.ts`](../../src/hooks/use-dp-shifts.ts)
- `/api/financial/accounts` — interface [`src/features/financial/components/settings/account-plans-management.tsx`](../../src/features/financial/components/settings/account-plans-management.tsx); rota candidata [`src/app/api/financial/accounts/route.ts`](../../src/app/api/financial/accounts/route.ts)
- `/api/financial/beneficiaries/entities/` — interface [`src/components/entity-management.tsx`](../../src/components/entity-management.tsx); rota candidata [`src/app/api/financial/beneficiaries/entities/[entityId]/route.ts`](../../src/app/api/financial/beneficiaries/entities/%5BentityId%5D/route.ts)
- `/api/financial/budget-inputs` — interface [`src/features/financial/components/settings/budgets-management.tsx`](../../src/features/financial/components/settings/budgets-management.tsx); rota candidata [`src/app/api/financial/budget-inputs/route.ts`](../../src/app/api/financial/budget-inputs/route.ts)
- `/api/financial/budget-projects` — interface [`src/features/financial/components/settings/budget-projects-management.tsx`](../../src/features/financial/components/settings/budget-projects-management.tsx); rota candidata [`src/app/api/financial/budget-projects/route.ts`](../../src/app/api/financial/budget-projects/route.ts)
- `/api/financial/budget-projects/` — interface [`src/features/financial/components/settings/budget-projects-management.tsx`](../../src/features/financial/components/settings/budget-projects-management.tsx); rota candidata [`src/app/api/financial/budget-projects/[id]/route.ts`](../../src/app/api/financial/budget-projects/%5Bid%5D/route.ts)
- `/api/financial/budget-rules` — interface [`src/features/financial/components/settings/budgets-management.tsx`](../../src/features/financial/components/settings/budgets-management.tsx); rota candidata [`src/app/api/financial/budget-rules/route.ts`](../../src/app/api/financial/budget-rules/route.ts)
- `/api/financial/budget-rules/` — interface [`src/features/financial/components/settings/budgets-management.tsx`](../../src/features/financial/components/settings/budgets-management.tsx); rota candidata [`src/app/api/financial/budget-rules/[id]/route.ts`](../../src/app/api/financial/budget-rules/%5Bid%5D/route.ts)
- `/api/financial/budget-rules/generate` — interface [`src/features/financial/components/settings/budgets-management.tsx`](../../src/features/financial/components/settings/budgets-management.tsx); rota candidata [`src/app/api/financial/budget-rules/generate/route.ts`](../../src/app/api/financial/budget-rules/generate/route.ts)
- `/api/financial/budget-rules/preview` — interface [`src/features/financial/components/settings/budgets-management.tsx`](../../src/features/financial/components/settings/budgets-management.tsx); rota candidata [`src/app/api/financial/budget-rules/preview/route.ts`](../../src/app/api/financial/budget-rules/preview/route.ts)
- `/api/financial/budgets` — interface [`src/features/financial/components/settings/budget-forecast-conversion.tsx`](../../src/features/financial/components/settings/budget-forecast-conversion.tsx); rota candidata [`src/app/api/financial/budgets/route.ts`](../../src/app/api/financial/budgets/route.ts)
- `/api/financial/budgets/` — interface [`src/features/financial/components/settings/budget-coverage-editor.tsx`](../../src/features/financial/components/settings/budget-coverage-editor.tsx); rota candidata [`src/app/api/financial/budgets/[id]/route.ts`](../../src/app/api/financial/budgets/%5Bid%5D/route.ts)
- `/api/financial/budgets/forecast-conversion` — interface [`src/features/financial/components/settings/budget-forecast-conversion.tsx`](../../src/features/financial/components/settings/budget-forecast-conversion.tsx); rota candidata [`src/app/api/financial/budgets/forecast-conversion/route.ts`](../../src/app/api/financial/budgets/forecast-conversion/route.ts)
- `/api/financial/budgets/person-references` — interface [`src/features/financial/components/settings/budget-api.ts`](../../src/features/financial/components/settings/budget-api.ts); rota candidata [`src/app/api/financial/budgets/person-references/route.ts`](../../src/app/api/financial/budgets/person-references/route.ts)
- `/api/financial/data` — interface [`src/features/financial/components/settings/account-plans-management.tsx`](../../src/features/financial/components/settings/account-plans-management.tsx); rota candidata [`src/app/api/financial/data/route.ts`](../../src/app/api/financial/data/route.ts)
- `/api/hr/aso-clinics` — interface [`src/components/entity-management.tsx`](../../src/components/entity-management.tsx); rota candidata [`src/app/api/hr/aso-clinics/route.ts`](../../src/app/api/hr/aso-clinics/route.ts)
- `/api/hr/bootstrap` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/bootstrap/route.ts`](../../src/app/api/hr/bootstrap/route.ts)
- `/api/hr/candidates` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/candidates/route.ts`](../../src/app/api/hr/candidates/route.ts)
- `/api/hr/candidates/` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/candidates/[id]/route.ts`](../../src/app/api/hr/candidates/%5Bid%5D/route.ts)
- `/api/hr/departments` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/departments/route.ts`](../../src/app/api/hr/departments/route.ts)
- `/api/hr/departments/` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/departments/[departmentId]/route.ts`](../../src/app/api/hr/departments/%5BdepartmentId%5D/route.ts)
- `/api/hr/functions` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/functions/route.ts`](../../src/app/api/hr/functions/route.ts)
- `/api/hr/functions/` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/functions/[functionId]/route.ts`](../../src/app/api/hr/functions/%5BfunctionId%5D/route.ts)
- `/api/hr/integration-templates` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/hr/integration-templates/route.ts`](../../src/app/api/hr/integration-templates/route.ts)
- `/api/hr/integration-templates/` — interface [`src/features/hr/integration/client.ts`](../../src/features/hr/integration/client.ts); rota candidata [`src/app/api/hr/integration-templates/[templateId]/route.ts`](../../src/app/api/hr/integration-templates/%5BtemplateId%5D/route.ts)
- `/api/hr/integrations/pdvlegal/catalog` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/hr/integrations/pdvlegal/catalog/route.ts`](../../src/app/api/hr/integrations/pdvlegal/catalog/route.ts)
- `/api/hr/login-access` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/login-access/route.ts`](../../src/app/api/hr/login-access/route.ts)
- `/api/hr/login-access/audit` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/login-access/audit/route.ts`](../../src/app/api/hr/login-access/audit/route.ts)
- `/api/hr/onboarding` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/hr/onboarding/route.ts`](../../src/app/api/hr/onboarding/route.ts)
- `/api/hr/onboarding/` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/hr/onboarding/[id]/route.ts`](../../src/app/api/hr/onboarding/%5Bid%5D/route.ts)
- `/api/hr/onboarding/access-catalog` — interface [`src/features/hr/onboarding-pj/detail-panel.tsx`](../../src/features/hr/onboarding-pj/detail-panel.tsx); rota candidata [`src/app/api/hr/onboarding/access-catalog/route.ts`](../../src/app/api/hr/onboarding/access-catalog/route.ts)
- `/api/hr/openings` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/openings/route.ts`](../../src/app/api/hr/openings/route.ts)
- `/api/hr/openings/` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/openings/[id]/route.ts`](../../src/app/api/hr/openings/%5Bid%5D/route.ts)
- `/api/hr/recruitment/forms/talent-pool` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/recruitment/forms/talent-pool/route.ts`](../../src/app/api/hr/recruitment/forms/talent-pool/route.ts)
- `/api/hr/roles` — interface [`src/features/hr/lib/client.ts`](../../src/features/hr/lib/client.ts); rota candidata [`src/app/api/hr/roles/route.ts`](../../src/app/api/hr/roles/route.ts)
- `/api/hr/roles/` — interface [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx); rota candidata [`src/app/api/hr/roles/[roleId]/route.ts`](../../src/app/api/hr/roles/%5BroleId%5D/route.ts)
- `/api/hr/upload` — interface [`src/components/hr/recruitment/recruitment-onboarding-view.tsx`](../../src/components/hr/recruitment/recruitment-onboarding-view.tsx); rota candidata [`src/app/api/hr/upload/route.ts`](../../src/app/api/hr/upload/route.ts)
- `/api/integrations/pdvlegal/filiais` — interface [`src/components/dp/dp-settings-units.tsx`](../../src/components/dp/dp-settings-units.tsx); rota candidata [`src/app/api/integrations/pdvlegal/filiais/route.ts`](../../src/app/api/integrations/pdvlegal/filiais/route.ts)
- `/api/privacy/incidents` — interface [`src/features/privacy/client.ts`](../../src/features/privacy/client.ts); rota candidata [`src/app/api/privacy/incidents/route.ts`](../../src/app/api/privacy/incidents/route.ts)
- `/api/privacy/incidents/` — interface [`src/features/privacy/client.ts`](../../src/features/privacy/client.ts); rota candidata [`src/app/api/privacy/incidents/[id]/route.ts`](../../src/app/api/privacy/incidents/%5Bid%5D/route.ts)
- `/api/privacy/requests` — interface [`src/features/privacy/client.ts`](../../src/features/privacy/client.ts); rota candidata [`src/app/api/privacy/requests/route.ts`](../../src/app/api/privacy/requests/route.ts)
- `/api/privacy/requests/` — interface [`src/features/privacy/client.ts`](../../src/features/privacy/client.ts); rota candidata [`src/app/api/privacy/requests/[id]/route.ts`](../../src/app/api/privacy/requests/%5Bid%5D/route.ts)
- `/api/products` — interface [`src/components/add-edit-product-modal.tsx`](../../src/components/add-edit-product-modal.tsx); rota candidata [`src/app/api/products/route.ts`](../../src/app/api/products/route.ts)
- `/api/products/` — interface [`src/components/add-edit-product-modal.tsx`](../../src/components/add-edit-product-modal.tsx); rota candidata [`src/app/api/products/[id]/route.ts`](../../src/app/api/products/%5Bid%5D/route.ts)
- `/api/products/barcode/` — interface [`src/components/add-edit-product-modal.tsx`](../../src/components/add-edit-product-modal.tsx); rota candidata [`src/app/api/products/barcode/[codigo]/route.ts`](../../src/app/api/products/barcode/%5Bcodigo%5D/route.ts)
- `/api/profile-compliance/overview` — interface [`src/components/dp/profile-compliance-overview.tsx`](../../src/components/dp/profile-compliance-overview.tsx); rota candidata [`src/app/api/profile-compliance/overview/route.ts`](../../src/app/api/profile-compliance/overview/route.ts)
- `/api/purchasing/classification-options` — interface [`src/hooks/use-purchasing-financial-options.ts`](../../src/hooks/use-purchasing-financial-options.ts)
- `/api/registry/base-products` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/base-products/` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/entities` — interface [`src/components/entities-provider.tsx`](../../src/components/entities-provider.tsx)
- `/api/registry/entities/` — interface [`src/components/entities-provider.tsx`](../../src/components/entities-provider.tsx)
- `/api/registry/operational-categories` — interface [`src/components/operational-item-categories-provider.tsx`](../../src/components/operational-item-categories-provider.tsx)
- `/api/registry/operational-categories/` — interface [`src/components/operational-item-categories-provider.tsx`](../../src/components/operational-item-categories-provider.tsx)
- `/api/registry/products` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/registry/products/` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/rh/field-map` — interface [`src/features/rh/components/FieldConfigPage.tsx`](../../src/features/rh/components/FieldConfigPage.tsx); rota candidata [`src/app/api/rh/field-map/route.ts`](../../src/app/api/rh/field-map/route.ts)
- `/api/settings/ai-management` — interface [`src/components/ai-management/ai-billing-settings.tsx`](../../src/components/ai-management/ai-billing-settings.tsx); rota candidata [`src/app/api/settings/ai-management/route.ts`](../../src/app/api/settings/ai-management/route.ts)
- `/api/settings/public-bio` — interface [`src/components/settings/public-bio-settings.tsx`](../../src/components/settings/public-bio-settings.tsx); rota candidata [`src/app/api/settings/public-bio/route.ts`](../../src/app/api/settings/public-bio/route.ts)
- `/api/settings/public-bio/media` — interface [`src/components/settings/public-bio-settings.tsx`](../../src/components/settings/public-bio-settings.tsx); rota candidata [`src/app/api/settings/public-bio/media/route.ts`](../../src/app/api/settings/public-bio/media/route.ts)
- `/api/settings/public-bio/media/` — interface [`src/components/settings/public-bio-settings.tsx`](../../src/components/settings/public-bio-settings.tsx); rota candidata [`src/app/api/settings/public-bio/media/[id]/route.ts`](../../src/app/api/settings/public-bio/media/%5Bid%5D/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `assetCategories` — [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx)
- `assets` — [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx)
- `baseProducts` — [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `channels` — [`src/components/channels-provider.tsx`](../../src/components/channels-provider.tsx)
- `classifications` — [`src/components/classifications-provider.tsx`](../../src/components/classifications-provider.tsx)
- `competitorGroups` — [`src/components/competitor-provider.tsx`](../../src/components/competitor-provider.tsx)
- `concorrente_precos` — [`src/components/competitor-provider.tsx`](../../src/components/competitor-provider.tsx)
- `concorrente_produtos` — [`src/components/competitor-provider.tsx`](../../src/components/competitor-provider.tsx)
- `concorrentes` — [`src/components/competitor-provider.tsx`](../../src/components/competitor-provider.tsx)
- `dp_schedules` — [`src/hooks/use-dp-shifts.ts`](../../src/hooks/use-dp-shifts.ts)
- `employeeGoals` — [`src/components/goals-provider.tsx`](../../src/components/goals-provider.tsx)
- `entities` — [`src/components/entities-provider.tsx`](../../src/components/entities-provider.tsx)
- `goalMethodConfigs` — [`src/hooks/use-goal-method-configs.ts`](../../src/hooks/use-goal-method-configs.ts)
- `goalPeriods` — [`src/components/goals-provider.tsx`](../../src/components/goals-provider.tsx)
- `goalTemplates` — [`src/components/goals-provider.tsx`](../../src/components/goals-provider.tsx)
- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)
- `lots` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `movementHistory` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `predefinedLists` — [`src/components/predefined-lists-provider.tsx`](../../src/components/predefined-lists-provider.tsx)
- `priceHistory` — [`src/components/purchase-provider.tsx`](../../src/components/purchase-provider.tsx)
- `priceOverrides` — [`src/components/channels-provider.tsx`](../../src/components/channels-provider.tsx)
- `productSimulationCategories` — [`src/components/product-simulation-category-provider.tsx`](../../src/components/product-simulation-category-provider.tsx)
- `productSimulationItems` — [`src/components/product-simulation-provider.tsx`](../../src/components/product-simulation-provider.tsx)
- `productSimulations` — [`src/components/channels-provider.tsx`](../../src/components/channels-provider.tsx)
- `products` — [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `profiles` — [`src/components/profiles-provider.tsx`](../../src/components/profiles-provider.tsx)
- `purchaseItems` — [`src/components/purchase-provider.tsx`](../../src/components/purchase-provider.tsx)
- `purchaseSessions` — [`src/components/purchase-provider.tsx`](../../src/components/purchase-provider.tsx)
- `settings` — [`src/components/company-settings-provider.tsx`](../../src/components/company-settings-provider.tsx)
- `simulationPriceHistory` — [`src/components/product-simulation-provider.tsx`](../../src/components/product-simulation-provider.tsx)
- `users` — [`src/components/goals-tracking-dashboard.tsx`](../../src/components/goals-tracking-dashboard.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `assets.create` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `assets.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `assets.printLabels` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `assets.retire` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `assets.transfer` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `assets.view` — [`src/components/assets-provider.tsx`](../../src/components/assets-provider.tsx)
- `assets.viewHistory` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `commercial.technicalSheets.create` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `commercial.technicalSheets.delete` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `commercial.technicalSheets.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `commercial.technicalSheets.export` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `commercial.technicalSheets.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dashboard.audit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dashboard.collaborator` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dashboard.operational` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dashboard.pricing` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `dashboard.technicalSheets` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dashboard.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.collaborators.add` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.collaborators.edit` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `dp.collaborators.ownProfileOnly` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.collaborators.syncProfile` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.collaborators.terminate` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `dp.collaborators.view` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `dp.schedules.create` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.schedules.delete` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.schedules.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.schedules.export` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.schedules.publishBizneo` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.schedules.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.settings.manageCalendars` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `dp.settings.manageShifts` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `dp.settings.manageUnits` — [`src/components/dp/dp-settings-units.tsx`](../../src/components/dp/dp-settings-units.tsx)
- `dp.vacation.approve` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.vacation.manageSettings` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.vacation.request` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.vacation.viewAll` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `dp.view` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `financial.audits.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.audits.effectuate` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.audits.ignore` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.audits.import` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.audits.manage` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.audits.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cardStatements.audit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cardStatements.close` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cardStatements.import` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cardStatements.reconcile` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cardStatements.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashClosures.adjustExpected` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashClosures.approve` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashClosures.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashClosures.reopen` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashClosures.resync` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashClosures.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashDeposits.adjust` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashDeposits.cancel` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashDeposits.issue` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashDeposits.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashFlow.create` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.cashFlow.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.dashboard` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.dre` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.expenses.create` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.expenses.delete` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.expenses.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.expenses.pay` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.expenses.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.inbox.analyze` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.inbox.discard` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.inbox.link` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.inbox.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.interIntegration.manage` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.paymentRequests.authorize` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.paymentRequests.create` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.paymentRequests.refresh` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.paymentRequests.submit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.paymentRequests.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.paymentRequests.viewProof` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.personnelCosts.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.personnelCosts.export` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.personnelCosts.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.reconciliation.administer` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.reconciliation.classifyAdjustments` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.reconciliation.confirm` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.reconciliation.correct` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.reconciliation.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `financial.settings.manageAccountPlans` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `financial.settings.manageBankAccounts` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `financial.settings.manageBudgets` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `financial.settings.manageExpenseDescriptions` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `financial.settings.manageImportAliases` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `financial.settings.manageResultCenters` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `financial.settings.view` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `financial.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `forms.global.create_projects` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `forms.global.manage_templates` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `forms.global.view_all_projects` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `forms.global.view_analytics` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `goals.manage` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `goals.view` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `help.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.companyDocuments.manage` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.companyDocuments.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.consents.manage` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.consents.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.signatures.send` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.signatures.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.templates.manage` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.templates.publish` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.templates.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `hr.formalization.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `itemRequests.add` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `itemRequests.approve` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `pricing.manageParameters` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `pricing.simulate` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `pricing.view` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `purchasing.cancelPurchase` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `purchasing.createPurchase` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `purchasing.createQuotation` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `purchasing.finalizeQuotation` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `purchasing.manageBaseItems` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `purchasing.manageFinancialLink` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `purchasing.receivePurchase` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `purchasing.revertPurchaseStage` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `purchasing.view` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `recruitment.manage` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `recruitment.pipeline.manage` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `recruitment.pipeline.view` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `recruitment.view` — [`src/components/hr/recruitment/recruitment-shell.tsx`](../../src/components/hr/recruitment/recruitment-shell.tsx)
- `registration.baseProducts.add` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `registration.baseProducts.delete` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `registration.baseProducts.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `registration.entities.add` — [`src/components/entity-management.tsx`](../../src/components/entity-management.tsx)
- `registration.entities.delete` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `registration.entities.edit` — [`src/components/entity-management.tsx`](../../src/components/entity-management.tsx)
- `registration.items.add` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `registration.items.delete` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `registration.items.edit` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `registration.view` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `reposition.cancel` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `reposition.finalize` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `reposition.prepareDispatch` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `reposition.receive` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `reposition.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `settings.manageKiosks` — [`src/components/dp/dp-settings-units.tsx`](../../src/components/dp/dp-settings-units.tsx)
- `settings.manageLabels` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `settings.manageProfiles` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `settings.managePublicBio` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `settings.manageUsers` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `settings.view` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `settings.viewAiCosts` — [`src/app/dashboard/settings/page.tsx`](../../src/app/dashboard/settings/page.tsx)
- `signage.manage` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `signage.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.analysis.consumption` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.analysis.projection` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.analysis.restock` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.analysis.valuation` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.analysis.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.audit.approve` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.audit.start` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.audit.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.conversions.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.inventoryControl.addLot` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.inventoryControl.editLot` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.inventoryControl.transfer` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.inventoryControl.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.inventoryControl.viewHistory` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.inventoryControl.writeDown` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.purchasing.approve` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.purchasing.deleteHistory` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.purchasing.suggest` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.purchasing.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.returns.add` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.returns.delete` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.returns.updateStatus` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.returns.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.stockCount.approve` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.stockCount.perform` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.stockCount.requestItem` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.stockCount.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.uniforms.deliver` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.uniforms.return` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.uniforms.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `stock.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `tasks.manage` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)
- `tasks.view` — [`src/components/profile-management-modal.tsx`](../../src/components/profile-management-modal.tsx)

## `signage`

Páginas: [`src/app/dashboard/signage/page.tsx`](../../src/app/dashboard/signage/page.tsx).

Arquivos locais percorridos: 18.

Chamadas candidatas encontradas:

- `/api/signage/heartbeat` — interface [`src/components/signage/signage-admin.tsx`](../../src/components/signage/signage-admin.tsx); rota candidata [`src/app/api/signage/heartbeat/route.ts`](../../src/app/api/signage/heartbeat/route.ts)
- `/api/signage/publish` — interface [`src/components/signage/signage-admin.tsx`](../../src/components/signage/signage-admin.tsx); rota candidata [`src/app/api/signage/publish/route.ts`](../../src/app/api/signage/publish/route.ts)
- `/api/signage/slides` — interface [`src/components/signage/signage-admin.tsx`](../../src/components/signage/signage-admin.tsx); rota candidata [`src/app/api/signage/slides/route.ts`](../../src/app/api/signage/slides/route.ts)
- `/api/signage/slides/` — interface [`src/components/signage/signage-admin.tsx`](../../src/components/signage/signage-admin.tsx); rota candidata [`src/app/api/signage/slides/[slideId]/route.ts`](../../src/app/api/signage/slides/%5BslideId%5D/route.ts)
- `/api/signage/upload` — interface [`src/components/signage/signage-admin.tsx`](../../src/components/signage/signage-admin.tsx); rota candidata [`src/app/api/signage/upload/route.ts`](../../src/app/api/signage/upload/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `settings.manageUsers` — [`src/components/signage/signage-admin.tsx`](../../src/components/signage/signage-admin.tsx)
- `signage.manage` — [`src/components/signage/signage-admin.tsx`](../../src/components/signage/signage-admin.tsx)
- `signage.view` — [`src/components/signage/signage-admin.tsx`](../../src/components/signage/signage-admin.tsx)

## `stock-analysis`

Páginas: [`src/app/dashboard/stock/analysis/consumption/page.tsx`](../../src/app/dashboard/stock/analysis/consumption/page.tsx), [`src/app/dashboard/stock/analysis/movement-analysis/page.tsx`](../../src/app/dashboard/stock/analysis/movement-analysis/page.tsx), [`src/app/dashboard/stock/analysis/projection/page.tsx`](../../src/app/dashboard/stock/analysis/projection/page.tsx), [`src/app/dashboard/stock/analysis/restock/page.tsx`](../../src/app/dashboard/stock/analysis/restock/page.tsx), [`src/app/dashboard/stock/analysis/sales/page.tsx`](../../src/app/dashboard/stock/analysis/sales/page.tsx), [`src/app/dashboard/stock/analysis/valuation/page.tsx`](../../src/app/dashboard/stock/analysis/valuation/page.tsx).

Arquivos locais percorridos: 85.

Chamadas candidatas encontradas:

- `/api/ai/analyze-consumption` — interface [`src/components/consumption-analysis-dashboard.tsx`](../../src/components/consumption-analysis-dashboard.tsx); rota candidata [`src/app/api/ai/analyze-consumption/route.ts`](../../src/app/api/ai/analyze-consumption/route.ts)
- `/api/catalogo` — interface [`src/components/product-simulation-category-provider.tsx`](../../src/components/product-simulation-category-provider.tsx); rota candidata [`src/app/api/catalogo/route.ts`](../../src/app/api/catalogo/route.ts)
- `/api/registry/base-products` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/base-products/` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/products` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/registry/products/` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/stock/movement-history` — interface [`src/components/movement-history-modal.tsx`](../../src/components/movement-history-modal.tsx); rota candidata [`src/app/api/stock/movement-history/route.ts`](../../src/app/api/stock/movement-history/route.ts)
- `/api/stock/reposition-activities` — interface [`src/features/reposition/lib/client.ts`](../../src/features/reposition/lib/client.ts); rota candidata [`src/app/api/stock/reposition-activities/route.ts`](../../src/app/api/stock/reposition-activities/route.ts)
- `/api/stock/reposition-activities/` — interface [`src/features/reposition/lib/client.ts`](../../src/features/reposition/lib/client.ts); rota candidata [`src/app/api/stock/reposition-activities/[activityId]/route.ts`](../../src/app/api/stock/reposition-activities/%5BactivityId%5D/route.ts)
- `/api/stock/reposition-requests` — interface [`src/features/reposition-requests/lib/client.ts`](../../src/features/reposition-requests/lib/client.ts); rota candidata [`src/app/api/stock/reposition-requests/route.ts`](../../src/app/api/stock/reposition-requests/route.ts)
- `/api/stock/reposition-requests/` — interface [`src/features/reposition-requests/lib/client.ts`](../../src/features/reposition-requests/lib/client.ts); rota candidata [`src/app/api/stock/reposition-requests/[requestId]/route.ts`](../../src/app/api/stock/reposition-requests/%5BrequestId%5D/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `baseProducts` — [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `channels` — [`src/components/channels-provider.tsx`](../../src/components/channels-provider.tsx)
- `consumptionReports` — [`src/components/consumption-analysis-provider.tsx`](../../src/components/consumption-analysis-provider.tsx)
- `employeeGoals` — [`src/components/goals-provider.tsx`](../../src/components/goals-provider.tsx)
- `goalPeriods` — [`src/components/goals-provider.tsx`](../../src/components/goals-provider.tsx)
- `goalTemplates` — [`src/components/goals-provider.tsx`](../../src/components/goals-provider.tsx)
- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)
- `lots` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `movementHistory` — [`src/components/movement-history-provider.tsx`](../../src/components/movement-history-provider.tsx)
- `priceHistory` — [`src/components/purchase-provider.tsx`](../../src/components/purchase-provider.tsx)
- `priceOverrides` — [`src/components/channels-provider.tsx`](../../src/components/channels-provider.tsx)
- `productSimulationCategories` — [`src/components/product-simulation-category-provider.tsx`](../../src/components/product-simulation-category-provider.tsx)
- `productSimulationItems` — [`src/components/product-simulation-provider.tsx`](../../src/components/product-simulation-provider.tsx)
- `productSimulations` — [`src/components/channels-provider.tsx`](../../src/components/channels-provider.tsx)
- `products` — [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `purchaseItems` — [`src/components/purchase-provider.tsx`](../../src/components/purchase-provider.tsx)
- `purchaseSessions` — [`src/components/purchase-provider.tsx`](../../src/components/purchase-provider.tsx)
- `salesReports` — [`src/components/consumption-analysis-provider.tsx`](../../src/components/consumption-analysis-provider.tsx)
- `settings` — [`src/components/company-settings-provider.tsx`](../../src/components/company-settings-provider.tsx)
- `simulationPriceHistory` — [`src/components/product-simulation-provider.tsx`](../../src/components/product-simulation-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `stock.analysis.consumption` — [`src/app/dashboard/stock/analysis/consumption/page.tsx`](../../src/app/dashboard/stock/analysis/consumption/page.tsx)
- `stock.analysis.projection` — [`src/app/dashboard/stock/analysis/projection/page.tsx`](../../src/app/dashboard/stock/analysis/projection/page.tsx)
- `stock.analysis.restock` — [`src/app/dashboard/stock/analysis/restock/page.tsx`](../../src/app/dashboard/stock/analysis/restock/page.tsx)
- `stock.analysis.valuation` — [`src/app/dashboard/stock/analysis/valuation/page.tsx`](../../src/app/dashboard/stock/analysis/valuation/page.tsx)

## `stock-control`

Páginas: [`src/app/dashboard/expiry/page.tsx`](../../src/app/dashboard/expiry/page.tsx), [`src/app/dashboard/inventory-control/page.tsx`](../../src/app/dashboard/inventory-control/page.tsx), [`src/app/dashboard/stock/inventory-control/page.tsx`](../../src/app/dashboard/stock/inventory-control/page.tsx), [`src/app/dashboard/stock/transfer/page.tsx`](../../src/app/dashboard/stock/transfer/page.tsx), [`src/app/dashboard/stock/write-down/page.tsx`](../../src/app/dashboard/stock/write-down/page.tsx).

Arquivos locais percorridos: 65.

Chamadas candidatas encontradas:

- `/api/registry/base-products` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/base-products/` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/operational-categories` — interface [`src/components/operational-item-categories-provider.tsx`](../../src/components/operational-item-categories-provider.tsx)
- `/api/registry/operational-categories/` — interface [`src/components/operational-item-categories-provider.tsx`](../../src/components/operational-item-categories-provider.tsx)
- `/api/registry/products` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/registry/products/` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/stock/movement-history` — interface [`src/components/movement-history-modal.tsx`](../../src/components/movement-history-modal.tsx); rota candidata [`src/app/api/stock/movement-history/route.ts`](../../src/app/api/stock/movement-history/route.ts)
- `/api/stock/reposition-activities` — interface [`src/features/reposition/lib/client.ts`](../../src/features/reposition/lib/client.ts); rota candidata [`src/app/api/stock/reposition-activities/route.ts`](../../src/app/api/stock/reposition-activities/route.ts)
- `/api/stock/reposition-activities/` — interface [`src/features/reposition/lib/client.ts`](../../src/features/reposition/lib/client.ts); rota candidata [`src/app/api/stock/reposition-activities/[activityId]/route.ts`](../../src/app/api/stock/reposition-activities/%5BactivityId%5D/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `baseProducts` — [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `consumptionReports` — [`src/components/consumption-analysis-provider.tsx`](../../src/components/consumption-analysis-provider.tsx)
- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)
- `locations` — [`src/components/locations-provider.tsx`](../../src/components/locations-provider.tsx)
- `lots` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `movementHistory` — [`src/components/movement-history-provider.tsx`](../../src/components/movement-history-provider.tsx)
- `products` — [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `salesReports` — [`src/components/consumption-analysis-provider.tsx`](../../src/components/consumption-analysis-provider.tsx)
- `settings` — [`src/components/company-settings-provider.tsx`](../../src/components/company-settings-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `registration.items.add` — [`src/components/expiry-control.tsx`](../../src/components/expiry-control.tsx)
- `registration.items.delete` — [`src/components/expiry-control.tsx`](../../src/components/expiry-control.tsx)
- `registration.items.edit` — [`src/components/expiry-control.tsx`](../../src/components/expiry-control.tsx)
- `settings.manageLabels` — [`src/app/dashboard/stock/inventory-control/page.tsx`](../../src/app/dashboard/stock/inventory-control/page.tsx)
- `stock.inventoryControl.addLot` — [`src/components/expiry-control.tsx`](../../src/components/expiry-control.tsx)
- `stock.inventoryControl.editLot` — [`src/components/expiry-control.tsx`](../../src/components/expiry-control.tsx)
- `stock.inventoryControl.transfer` — [`src/components/lot-card.tsx`](../../src/components/lot-card.tsx)
- `stock.inventoryControl.writeDown` — [`src/components/expiry-control.tsx`](../../src/components/expiry-control.tsx)

## `stock-count`

Páginas: [`src/app/dashboard/audit/page.tsx`](../../src/app/dashboard/audit/page.tsx), [`src/app/dashboard/stock/count/page.tsx`](../../src/app/dashboard/stock/count/page.tsx).

Arquivos locais percorridos: 43.

Chamadas candidatas encontradas:

- `/api/registry/base-products` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/base-products/` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/products` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/registry/products/` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/registry/stock-audit` — interface [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)
- `/api/registry/stock-audit/` — interface [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)
- `/api/stock/count-sessions` — interface [`src/components/stock-session-management.tsx`](../../src/components/stock-session-management.tsx); rota candidata [`src/app/api/stock/count-sessions/route.ts`](../../src/app/api/stock/count-sessions/route.ts)
- `/api/stock/item-requests` — interface [`src/features/item-requests/lib/client.ts`](../../src/features/item-requests/lib/client.ts); rota candidata [`src/app/api/stock/item-requests/route.ts`](../../src/app/api/stock/item-requests/route.ts)
- `/api/stock/item-requests/` — interface [`src/features/item-requests/lib/client.ts`](../../src/features/item-requests/lib/client.ts); rota candidata [`src/app/api/stock/item-requests/[requestId]/route.ts`](../../src/app/api/stock/item-requests/%5BrequestId%5D/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `baseProducts` — [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)
- `lots` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `movementHistory` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `products` — [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `profiles` — [`src/components/profiles-provider.tsx`](../../src/components/profiles-provider.tsx)
- `stockAuditSessions` — [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `stock.audit.view` — [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)
- `stock.stockCount.perform` — [`src/components/stock-session-management.tsx`](../../src/components/stock-session-management.tsx)
- `stock.stockCount.view` — [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)

## `stock-reposition`

Páginas: [`src/app/dashboard/stock/reposition/page.tsx`](../../src/app/dashboard/stock/reposition/page.tsx).

Arquivos locais percorridos: 30.

Chamadas candidatas encontradas:

- `/api/registry/products` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/registry/products/` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/stock/reposition-activities` — interface [`src/features/reposition/lib/client.ts`](../../src/features/reposition/lib/client.ts); rota candidata [`src/app/api/stock/reposition-activities/route.ts`](../../src/app/api/stock/reposition-activities/route.ts)
- `/api/stock/reposition-activities/` — interface [`src/features/reposition/lib/client.ts`](../../src/features/reposition/lib/client.ts); rota candidata [`src/app/api/stock/reposition-activities/[activityId]/route.ts`](../../src/app/api/stock/reposition-activities/%5BactivityId%5D/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `lots` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `movementHistory` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `products` — [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `reposition.cancel` — [`src/components/reposition-management.tsx`](../../src/components/reposition-management.tsx)
- `reposition.finalize` — [`src/components/reposition-management.tsx`](../../src/components/reposition-management.tsx)
- `reposition.prepareDispatch` — [`src/components/reposition-management.tsx`](../../src/components/reposition-management.tsx)
- `reposition.receive` — [`src/components/reposition-management.tsx`](../../src/components/reposition-management.tsx)
- `stock.analysis.restock` — [`src/components/reposition-management.tsx`](../../src/components/reposition-management.tsx)
- `stock.inventoryControl.transfer` — [`src/components/reposition-management.tsx`](../../src/components/reposition-management.tsx)
- `stock.stockCount.approve` — [`src/components/reposition-management.tsx`](../../src/components/reposition-management.tsx)

## `stock-requests`

Páginas: [`src/app/dashboard/stock/item-requests/page.tsx`](../../src/app/dashboard/stock/item-requests/page.tsx).

Arquivos locais percorridos: 15.

Chamadas candidatas encontradas:

- `/api/stock/item-requests` — interface [`src/features/item-requests/lib/client.ts`](../../src/features/item-requests/lib/client.ts); rota candidata [`src/app/api/stock/item-requests/route.ts`](../../src/app/api/stock/item-requests/route.ts)
- `/api/stock/item-requests/` — interface [`src/features/item-requests/lib/client.ts`](../../src/features/item-requests/lib/client.ts); rota candidata [`src/app/api/stock/item-requests/[requestId]/route.ts`](../../src/app/api/stock/item-requests/%5BrequestId%5D/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `profiles` — [`src/components/profiles-provider.tsx`](../../src/components/profiles-provider.tsx)

## `stock-returns`

Páginas: [`src/app/dashboard/stock/returns/page.tsx`](../../src/app/dashboard/stock/returns/page.tsx).

Arquivos locais percorridos: 32.

Chamadas candidatas encontradas:

- `/api/registry/products` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/registry/products/` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/stock/return-requests` — interface [`src/features/return-requests/lib/client.ts`](../../src/features/return-requests/lib/client.ts); rota candidata [`src/app/api/stock/return-requests/route.ts`](../../src/app/api/stock/return-requests/route.ts)
- `/api/stock/return-requests/` — interface [`src/features/return-requests/lib/client.ts`](../../src/features/return-requests/lib/client.ts); rota candidata [`src/app/api/stock/return-requests/[requestId]/route.ts`](../../src/app/api/stock/return-requests/%5BrequestId%5D/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `lots` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `movementHistory` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `products` — [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `stock.returns.add` — [`src/app/dashboard/stock/returns/page.tsx`](../../src/app/dashboard/stock/returns/page.tsx)
- `stock.returns.delete` — [`src/components/return-request-management.tsx`](../../src/components/return-request-management.tsx)
- `stock.returns.view` — [`src/app/dashboard/stock/returns/page.tsx`](../../src/app/dashboard/stock/returns/page.tsx)

## `stone`

Páginas: [`src/app/dashboard/financial/stone-anticipations/page.tsx`](../../src/app/dashboard/financial/stone-anticipations/page.tsx).

Arquivos locais percorridos: 13.

Chamadas candidatas encontradas:

- `/api/financial/agent` — interface [`src/features/financial/agent/anticipation-workspace.tsx`](../../src/features/financial/agent/anticipation-workspace.tsx); rota candidata [`src/app/api/financial/agent/route.ts`](../../src/app/api/financial/agent/route.ts)
- `/api/financial/stone-mappings` — interface [`src/features/financial/agent/anticipation-workspace.tsx`](../../src/features/financial/agent/anticipation-workspace.tsx); rota candidata [`src/app/api/financial/stone-mappings/route.ts`](../../src/app/api/financial/stone-mappings/route.ts)

## `tasks`

Páginas: [`src/app/dashboard/tasks/page.tsx`](../../src/app/dashboard/tasks/page.tsx).

Arquivos locais percorridos: 39.

Chamadas candidatas encontradas:

- `/api/registry/base-products` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/base-products/` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/stock-audit` — interface [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)
- `/api/registry/stock-audit/` — interface [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)
- `/api/stock/reposition-activities` — interface [`src/features/reposition/lib/client.ts`](../../src/features/reposition/lib/client.ts); rota candidata [`src/app/api/stock/reposition-activities/route.ts`](../../src/app/api/stock/reposition-activities/route.ts)
- `/api/stock/reposition-activities/` — interface [`src/features/reposition/lib/client.ts`](../../src/features/reposition/lib/client.ts); rota candidata [`src/app/api/stock/reposition-activities/[activityId]/route.ts`](../../src/app/api/stock/reposition-activities/%5BactivityId%5D/route.ts)
- `/api/stock/return-requests` — interface [`src/features/return-requests/lib/client.ts`](../../src/features/return-requests/lib/client.ts); rota candidata [`src/app/api/stock/return-requests/route.ts`](../../src/app/api/stock/return-requests/route.ts)
- `/api/stock/return-requests/` — interface [`src/features/return-requests/lib/client.ts`](../../src/features/return-requests/lib/client.ts); rota candidata [`src/app/api/stock/return-requests/[requestId]/route.ts`](../../src/app/api/stock/return-requests/%5BrequestId%5D/route.ts)
- `/api/tasks` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/route.ts`](../../src/app/api/tasks/route.ts)
- `/api/tasks/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/[taskId]/route.ts`](../../src/app/api/tasks/%5BtaskId%5D/route.ts)
- `/api/tasks/projects` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/projects/route.ts`](../../src/app/api/tasks/projects/route.ts)
- `/api/tasks/projects/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/projects/[projectId]/route.ts`](../../src/app/api/tasks/projects/%5BprojectId%5D/route.ts)
- `/api/tasks/purchase-receipt-sync` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/purchase-receipt-sync/route.ts`](../../src/app/api/tasks/purchase-receipt-sync/route.ts)
- `/api/tasks/statuses` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/statuses/route.ts`](../../src/app/api/tasks/statuses/route.ts)
- `/api/tasks/statuses/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/statuses/[statusId]/route.ts`](../../src/app/api/tasks/statuses/%5BstatusId%5D/route.ts)
- `/api/tasks/subprojects` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/subprojects/route.ts`](../../src/app/api/tasks/subprojects/route.ts)
- `/api/tasks/subprojects/` — interface [`src/features/tasks/lib/client.ts`](../../src/features/tasks/lib/client.ts); rota candidata [`src/app/api/tasks/subprojects/[subprojectId]/route.ts`](../../src/app/api/tasks/subprojects/%5BsubprojectId%5D/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `baseProducts` — [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `kiosks` — [`src/components/kiosks-provider.tsx`](../../src/components/kiosks-provider.tsx)
- `lots` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `movementHistory` — [`src/hooks/use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx)
- `profiles` — [`src/components/profiles-provider.tsx`](../../src/components/profiles-provider.tsx)
- `stockAuditSessions` — [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `reposition.prepareDispatch` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `reposition.receive` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `reposition.view` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `stock.audit.view` — [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)
- `stock.returns.updateStatus` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `stock.stockCount.approve` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `stock.stockCount.perform` — [`src/hooks/use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx)
- `stock.stockCount.view` — [`src/components/stock-audit-provider.tsx`](../../src/components/stock-audit-provider.tsx)

## `termination`

Páginas: [`src/app/dashboard/dp/terminations/[id]/page.tsx`](../../src/app/dashboard/dp/terminations/%5Bid%5D/page.tsx), [`src/app/dashboard/dp/terminations/page.tsx`](../../src/app/dashboard/dp/terminations/page.tsx), [`src/app/dashboard/processes/page.tsx`](../../src/app/dashboard/processes/page.tsx), [`src/app/dashboard/resignation/page.tsx`](../../src/app/dashboard/resignation/page.tsx).

Arquivos locais percorridos: 30.

Chamadas candidatas encontradas:

- `/api/hr/onboarding/` — interface [`src/features/hr/termination/termination-detail-page.tsx`](../../src/features/hr/termination/termination-detail-page.tsx); rota candidata [`src/app/api/hr/onboarding/[id]/route.ts`](../../src/app/api/hr/onboarding/%5Bid%5D/route.ts)
- `/api/hr/terminations` — interface [`src/features/hr/termination/client.ts`](../../src/features/hr/termination/client.ts); rota candidata [`src/app/api/hr/terminations/route.ts`](../../src/app/api/hr/terminations/route.ts)
- `/api/hr/terminations/` — interface [`src/features/hr/termination/employee-resignation-detail.tsx`](../../src/features/hr/termination/employee-resignation-detail.tsx); rota candidata [`src/app/api/hr/terminations/[id]/route.ts`](../../src/app/api/hr/terminations/%5Bid%5D/route.ts)
- `/api/processes` — interface [`src/features/hr/termination/process-center-page.tsx`](../../src/features/hr/termination/process-center-page.tsx); rota candidata [`src/app/api/processes/route.ts`](../../src/app/api/processes/route.ts)
- `/api/uniforms` — interface [`src/features/uniforms/client.ts`](../../src/features/uniforms/client.ts); rota candidata [`src/app/api/uniforms/route.ts`](../../src/app/api/uniforms/route.ts)
- `/api/uniforms/deliver` — interface [`src/features/uniforms/client.ts`](../../src/features/uniforms/client.ts); rota candidata [`src/app/api/uniforms/deliver/route.ts`](../../src/app/api/uniforms/deliver/route.ts)
- `/api/uniforms/exchange` — interface [`src/features/uniforms/client.ts`](../../src/features/uniforms/client.ts); rota candidata [`src/app/api/uniforms/exchange/route.ts`](../../src/app/api/uniforms/exchange/route.ts)
- `/api/uniforms/return` — interface [`src/features/uniforms/client.ts`](../../src/features/uniforms/client.ts); rota candidata [`src/app/api/uniforms/return/route.ts`](../../src/app/api/uniforms/return/route.ts)
- `/api/uniforms/terms/` — interface [`src/components/collaborator-uniforms.tsx`](../../src/components/collaborator-uniforms.tsx); rota candidata [`src/app/api/uniforms/terms/[id]/route.ts`](../../src/app/api/uniforms/terms/%5Bid%5D/route.ts)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `dp.collaborators.terminate` — [`src/features/hr/termination/resignation-self-service.tsx`](../../src/features/hr/termination/resignation-self-service.tsx)
- `settings.manageUsers` — [`src/features/hr/termination/resignation-self-service.tsx`](../../src/features/hr/termination/resignation-self-service.tsx)
- `stock.uniforms.deliver` — [`src/components/collaborator-uniforms.tsx`](../../src/components/collaborator-uniforms.tsx)
- `stock.uniforms.return` — [`src/components/collaborator-uniforms.tsx`](../../src/components/collaborator-uniforms.tsx)
- `stock.uniforms.view` — [`src/components/collaborator-uniforms.tsx`](../../src/components/collaborator-uniforms.tsx)

## `uniforms`

Páginas: [`src/app/dashboard/stock/uniforms/page.tsx`](../../src/app/dashboard/stock/uniforms/page.tsx).

Arquivos locais percorridos: 34.

Chamadas candidatas encontradas:

- `/api/products` — interface [`src/components/add-edit-product-modal.tsx`](../../src/components/add-edit-product-modal.tsx); rota candidata [`src/app/api/products/route.ts`](../../src/app/api/products/route.ts)
- `/api/products/` — interface [`src/components/add-edit-product-modal.tsx`](../../src/components/add-edit-product-modal.tsx); rota candidata [`src/app/api/products/[id]/route.ts`](../../src/app/api/products/%5Bid%5D/route.ts)
- `/api/products/barcode/` — interface [`src/components/add-edit-product-modal.tsx`](../../src/components/add-edit-product-modal.tsx); rota candidata [`src/app/api/products/barcode/[codigo]/route.ts`](../../src/app/api/products/barcode/%5Bcodigo%5D/route.ts)
- `/api/registry/base-products` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/base-products/` — interface [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `/api/registry/operational-categories` — interface [`src/components/operational-item-categories-provider.tsx`](../../src/components/operational-item-categories-provider.tsx)
- `/api/registry/operational-categories/` — interface [`src/components/operational-item-categories-provider.tsx`](../../src/components/operational-item-categories-provider.tsx)
- `/api/registry/products` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/registry/products/` — interface [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)
- `/api/uniforms` — interface [`src/features/uniforms/client.ts`](../../src/features/uniforms/client.ts); rota candidata [`src/app/api/uniforms/route.ts`](../../src/app/api/uniforms/route.ts)
- `/api/uniforms/deliver` — interface [`src/features/uniforms/client.ts`](../../src/features/uniforms/client.ts); rota candidata [`src/app/api/uniforms/deliver/route.ts`](../../src/app/api/uniforms/deliver/route.ts)
- `/api/uniforms/exchange` — interface [`src/features/uniforms/client.ts`](../../src/features/uniforms/client.ts); rota candidata [`src/app/api/uniforms/exchange/route.ts`](../../src/app/api/uniforms/exchange/route.ts)
- `/api/uniforms/return` — interface [`src/features/uniforms/client.ts`](../../src/features/uniforms/client.ts); rota candidata [`src/app/api/uniforms/return/route.ts`](../../src/app/api/uniforms/return/route.ts)

Coleções Firestore candidatas por literal no cliente (confirmar ramo e regras):

- `baseProducts` — [`src/components/base-products-provider.tsx`](../../src/components/base-products-provider.tsx)
- `classifications` — [`src/components/classifications-provider.tsx`](../../src/components/classifications-provider.tsx)
- `products` — [`src/components/products-provider.tsx`](../../src/components/products-provider.tsx)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `registration.items.edit` — [`src/components/uniform-management.tsx`](../../src/components/uniform-management.tsx)
- `stock.inventoryControl.editLot` — [`src/components/uniform-management.tsx`](../../src/components/uniform-management.tsx)
- `stock.uniforms.manageEvaluation` — [`src/components/uniform-management.tsx`](../../src/components/uniform-management.tsx)
- `stock.uniforms.view` — [`src/components/uniform-management.tsx`](../../src/components/uniform-management.tsx)

## `vacations`

Páginas: [`src/app/dashboard/dp/ferias/[userId]/page.tsx`](../../src/app/dashboard/dp/ferias/%5BuserId%5D/page.tsx), [`src/app/dashboard/dp/ferias/page.tsx`](../../src/app/dashboard/dp/ferias/page.tsx).

Arquivos locais percorridos: 29.

Chamadas candidatas encontradas:

- `/api/dp/vacations` — interface [`src/components/dp/dp-ferias-profile.tsx`](../../src/components/dp/dp-ferias-profile.tsx); rota candidata [`src/app/api/dp/vacations/route.ts`](../../src/app/api/dp/vacations/route.ts)
- `/api/dp/vacations/` — interface [`src/components/dp/dp-ferias-profile.tsx`](../../src/components/dp/dp-ferias-profile.tsx); rota candidata [`src/app/api/dp/vacations/[vacationId]/route.ts`](../../src/app/api/dp/vacations/%5BvacationId%5D/route.ts)

Permissões citadas pela interface (a autorização deve ser conferida no servidor/regras):

- `dp.vacation.approve` — [`src/components/dp/dp-ferias-profile.tsx`](../../src/components/dp/dp-ferias-profile.tsx)
- `dp.vacation.request` — [`src/components/dp/dp-ferias-profile.tsx`](../../src/components/dp/dp-ferias-profile.tsx)
- `dp.vacation.viewAll` — [`src/app/dashboard/dp/ferias/[userId]/page.tsx`](../../src/app/dashboard/dp/ferias/%5BuserId%5D/page.tsx)
