# Inventário de rotas do dashboard

Gerado de `src/app/dashboard/**/page.tsx` por `scripts/generate-route-inventory.py`. As pastas são caminhos de código; segmentos como `@modal` e `(.)` não são URLs públicas. Use busca por caminho ou domínio; não carregue a tabela inteira para uma tarefa local. A coluna seguinte contém só importações ou redirecionamentos diretos observados no arquivo. Para fluxo, dados, permissões e testes, consulte [entradas principais](dashboard-areas.md) e o [guia do domínio](system-map.md).

## assets (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/assets` | [page.tsx](../../src/app/dashboard/assets/page.tsx) | [asset-management.tsx](../../src/components/asset-management.tsx) |

## audit (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/audit` | [page.tsx](../../src/app/dashboard/audit/page.tsx) | [stock-session-management.tsx](../../src/components/stock-session-management.tsx) |

## collaborator (2)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/collaborator` | [page.tsx](../../src/app/dashboard/collaborator/page.tsx) | [collaborator-dashboard-panel.tsx](../../src/components/collaborator-dashboard-panel.tsx) |
| `dashboard/collaborator/schedule` | [page.tsx](../../src/app/dashboard/collaborator/schedule/page.tsx) | [collaborator-schedule-page.tsx](../../src/components/collaborator-schedule-page.tsx) |

## commercial (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/commercial` | [page.tsx](../../src/app/dashboard/commercial/page.tsx) | [catalogo-view.tsx](../../src/components/catalogo/catalogo-view.tsx), [commercial-permissions.ts](../../src/lib/commercial-permissions.ts) |

## conversions (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/conversions` | [page.tsx](../../src/app/dashboard/conversions/page.tsx) | [measure-converter.tsx](../../src/components/measure-converter.tsx) |

## documents (9)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/documents/collaborators` | [page.tsx](../../src/app/dashboard/documents/collaborators/page.tsx) | Ler a própria página |
| `dashboard/documents/company` | [page.tsx](../../src/app/dashboard/documents/company/page.tsx) | [company-document-categories.ts](../../src/lib/documents/company-document-categories.ts), [hr-formalization-permissions.ts](../../src/lib/hr-formalization-permissions.ts) |
| `dashboard/documents/consents/[employeeId]` | [page.tsx](../../src/app/dashboard/documents/consents/[employeeId]/page.tsx) | [hr-formalization-permissions.ts](../../src/lib/hr-formalization-permissions.ts), [image-voice-consent.ts](../../src/features/hr/consents/image-voice-consent.ts) |
| `dashboard/documents/generated` | [page.tsx](../../src/app/dashboard/documents/generated/page.tsx) | [document-generator-workspace.tsx](../../src/components/documents/document-generator-workspace.tsx), [hr-formalization-permissions.ts](../../src/lib/hr-formalization-permissions.ts) |
| `dashboard/documents/generator` | [page.tsx](../../src/app/dashboard/documents/generator/page.tsx) | [document-generator-workspace.tsx](../../src/components/documents/document-generator-workspace.tsx) |
| `dashboard/documents/management` | [page.tsx](../../src/app/dashboard/documents/management/page.tsx) | [hr-formalization-permissions.ts](../../src/lib/hr-formalization-permissions.ts) |
| `dashboard/documents` | [page.tsx](../../src/app/dashboard/documents/page.tsx) | [hr-formalization-permissions.ts](../../src/lib/hr-formalization-permissions.ts) |
| `dashboard/documents/templates/[id]` | [page.tsx](../../src/app/dashboard/documents/templates/[id]/page.tsx) | [template-variable-wizard.tsx](../../src/components/hr/documents/template-variable-wizard.tsx), [collective-agreements-panel.tsx](../../src/components/hr/documents/collective-agreements-panel.tsx) |
| `dashboard/documents/templates` | [page.tsx](../../src/app/dashboard/documents/templates/page.tsx) | [document-template-workflow.ts](../../src/features/hr/documents/document-template-workflow.ts), [document-template-display-status.ts](../../src/features/hr/documents/document-template-display-status.ts) |

## dp (23)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/dp/collaborators/[userId]/documents` | [page.tsx](../../src/app/dashboard/dp/collaborators/[userId]/documents/page.tsx) | [employee-document-options.ts](../../src/lib/hr/employee-document-options.ts), [employee-document-signature.ts](../../src/lib/hr/employee-document-signature.ts) |
| `dashboard/dp/collaborators/[userId]/edit` | [page.tsx](../../src/app/dashboard/dp/collaborators/[userId]/edit/page.tsx) | [user-management.tsx](../../src/components/user-management.tsx) |
| `dashboard/dp/collaborators/[userId]` | [page.tsx](../../src/app/dashboard/dp/collaborators/[userId]/page.tsx) | [use-toast.ts](../../src/hooks/use-toast.ts), [use-dp-bootstrap.ts](../../src/hooks/use-dp-bootstrap.ts) |
| `dashboard/dp/collaborators` | [page.tsx](../../src/app/dashboard/dp/collaborators/page.tsx) | [use-dp-bootstrap.ts](../../src/hooks/use-dp-bootstrap.ts), [dp-units.ts](../../src/lib/dp-units.ts) |
| `dashboard/dp/documents` | [page.tsx](../../src/app/dashboard/dp/documents/page.tsx) | [use-dp-bootstrap.ts](../../src/hooks/use-dp-bootstrap.ts), [index.ts](../../src/types/index.ts) |
| `dashboard/dp/ferias/[userId]` | [page.tsx](../../src/app/dashboard/dp/ferias/[userId]/page.tsx) | [dp-ferias-profile.tsx](../../src/components/dp/dp-ferias-profile.tsx) |
| `dashboard/dp/ferias` | [page.tsx](../../src/app/dashboard/dp/ferias/page.tsx) | [dp-ferias-manager.tsx](../../src/components/dp/dp-ferias-manager.tsx), [page-header.tsx](../../src/components/layout/page-header.tsx) |
| `dashboard/dp` | [page.tsx](../../src/app/dashboard/dp/page.tsx) | [use-dp-bootstrap.ts](../../src/hooks/use-dp-bootstrap.ts), [use-dp-schedules-shifts.ts](../../src/hooks/use-dp-schedules-shifts.ts) |
| `dashboard/dp/schedules/[id]` | [page.tsx](../../src/app/dashboard/dp/schedules/[id]/page.tsx) | [dp-context.tsx](../../src/components/dp-context.tsx), [dp-schedule-editor.tsx](../../src/components/dp/dp-schedule-editor.tsx) |
| `dashboard/dp/schedules/month/[period]` | [page.tsx](../../src/app/dashboard/dp/schedules/month/[period]/page.tsx) | [dp-schedule-month-view.tsx](../../src/components/dp/dp-schedule-month-view.tsx), [dp-schedule-periods.ts](../../src/lib/dp-schedule-periods.ts) |
| `dashboard/dp/schedules` | [page.tsx](../../src/app/dashboard/dp/schedules/page.tsx) | [dp-schedules-list.tsx](../../src/components/dp/dp-schedules-list.tsx) |
| `dashboard/dp/settings/calendars/[id]` | [page.tsx](../../src/app/dashboard/dp/settings/calendars/[id]/page.tsx) | [dp-context.tsx](../../src/components/dp-context.tsx), [dp-calendar-holidays.tsx](../../src/components/dp/dp-calendar-holidays.tsx) |
| `dashboard/dp/settings/calendars` | [page.tsx](../../src/app/dashboard/dp/settings/calendars/page.tsx) | Redireciona para `/dashboard/settings?department=pessoal&tab=calendars` |
| `dashboard/dp/settings/collaborators` | [page.tsx](../../src/app/dashboard/dp/settings/collaborators/page.tsx) | [dp-collaborators-manager.tsx](../../src/components/dp/dp-collaborators-manager.tsx) |
| `dashboard/dp/settings/login-access` | [page.tsx](../../src/app/dashboard/dp/settings/login-access/page.tsx) | Redireciona para `/dashboard/settings?department=pessoal&tab=login-access` |
| `dashboard/dp/settings/organogram` | [page.tsx](../../src/app/dashboard/dp/settings/organogram/page.tsx) | Redireciona para `/dashboard/settings?department=pessoal&tab=organogram` |
| `dashboard/dp/settings` | [page.tsx](../../src/app/dashboard/dp/settings/page.tsx) | Ler a própria página |
| `dashboard/dp/settings/profile-compliance` | [page.tsx](../../src/app/dashboard/dp/settings/profile-compliance/page.tsx) | Redireciona para `/dashboard/settings?department=pessoal&tab=profile-compliance` |
| `dashboard/dp/settings/roles` | [page.tsx](../../src/app/dashboard/dp/settings/roles/page.tsx) | Redireciona para `/dashboard/settings?department=pessoal&tab=roles` |
| `dashboard/dp/settings/shifts` | [page.tsx](../../src/app/dashboard/dp/settings/shifts/page.tsx) | Redireciona para `/dashboard/settings?department=pessoal&tab=shifts` |
| `dashboard/dp/settings/units` | [page.tsx](../../src/app/dashboard/dp/settings/units/page.tsx) | Redireciona para `/dashboard/settings?department=operacional&tab=units` |
| `dashboard/dp/terminations/[id]` | [page.tsx](../../src/app/dashboard/dp/terminations/[id]/page.tsx) | [termination-detail-page.tsx](../../src/features/hr/termination/termination-detail-page.tsx) |
| `dashboard/dp/terminations` | [page.tsx](../../src/app/dashboard/dp/terminations/page.tsx) | [termination-list-page.tsx](../../src/features/hr/termination/termination-list-page.tsx) |

## expiry (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/expiry` | [page.tsx](../../src/app/dashboard/expiry/page.tsx) | [expiry-control.tsx](../../src/components/expiry-control.tsx) |

## financial (29)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/financial/assets` | [page.tsx](../../src/app/dashboard/financial/assets/page.tsx) | [asset-management.tsx](../../src/components/asset-management.tsx) |
| `dashboard/financial/beneficiaries` | [page.tsx](../../src/app/dashboard/financial/beneficiaries/page.tsx) | Redireciona para `/dashboard/registration/entities` |
| `dashboard/financial/cash-closures/[kioskId]/[year]/[month]/[day]` | [page.tsx](../../src/app/dashboard/financial/cash-closures/[kioskId]/[year]/[month]/[day]/page.tsx) | [cash-closure-day-page.tsx](../../src/features/financial/cash-closures/components/cash-closure-day-page.tsx) |
| `dashboard/financial/cash-closures/[kioskId]/[year]/[month]` | [page.tsx](../../src/app/dashboard/financial/cash-closures/[kioskId]/[year]/[month]/page.tsx) | [cash-closure-calendar-page.tsx](../../src/features/financial/cash-closures/components/cash-closure-calendar-page.tsx) |
| `dashboard/financial/cash-closures/[kioskId]` | [page.tsx](../../src/app/dashboard/financial/cash-closures/[kioskId]/page.tsx) | [cash-closure-months-page.tsx](../../src/features/financial/cash-closures/components/cash-closure-months-page.tsx) |
| `dashboard/financial/cash-closures` | [page.tsx](../../src/app/dashboard/financial/cash-closures/page.tsx) | [cash-closures-overview-page.tsx](../../src/features/financial/cash-closures/components/cash-closures-overview-page.tsx) |
| `dashboard/financial/cash-closures/sessions/[sessionId]` | [page.tsx](../../src/app/dashboard/financial/cash-closures/sessions/[sessionId]/page.tsx) | [cash-counting-session-page.tsx](../../src/features/financial/cash-counting-sessions/components/cash-counting-session-page.tsx) |
| `dashboard/financial/cash-closures/sessions/new` | [page.tsx](../../src/app/dashboard/financial/cash-closures/sessions/new/page.tsx) | [cash-counting-session-new-page.tsx](../../src/features/financial/cash-counting-sessions/components/cash-counting-session-new-page.tsx) |
| `dashboard/financial/cash-deposits` | [page.tsx](../../src/app/dashboard/financial/cash-deposits/page.tsx) | [cash-deposits-page.tsx](../../src/features/financial/cash-deposits/cash-deposits-page.tsx) |
| `dashboard/financial/cash-flow/agent` | [page.tsx](../../src/app/dashboard/financial/cash-flow/agent/page.tsx) | [stone-anticipations-page.tsx](../../src/features/financial/pages/stone-anticipations-page.tsx), [receivables-page.tsx](../../src/features/financial/receivables/receivables-page.tsx) |
| `dashboard/financial/cash-flow` | [page.tsx](../../src/app/dashboard/financial/cash-flow/page.tsx) | [cash-flow-page.tsx](../../src/features/financial/pages/cash-flow-page.tsx) |
| `dashboard/financial/cash-flow/receivables` | [page.tsx](../../src/app/dashboard/financial/cash-flow/receivables/page.tsx) | [receivables-page.tsx](../../src/features/financial/receivables/receivables-page.tsx) |
| `dashboard/financial/dre` | [page.tsx](../../src/app/dashboard/financial/dre/page.tsx) | [dre-page.tsx](../../src/features/financial/pages/dre-page.tsx) |
| `dashboard/financial/expenses/@modal/(.)new` | [page.tsx](../../src/app/dashboard/financial/expenses/@modal/%28.%29new/page.tsx) | [new-expense-page.tsx](../../src/features/financial/pages/new-expense-page.tsx) |
| `dashboard/financial/expenses/authorizations` | [page.tsx](../../src/app/dashboard/financial/expenses/authorizations/page.tsx) | [payment-requests-page.tsx](../../src/features/financial/payment-requests/payment-requests-page.tsx) |
| `dashboard/financial/expenses/card-statements` | [page.tsx](../../src/app/dashboard/financial/expenses/card-statements/page.tsx) | [card-statements-page.tsx](../../src/features/financial/pages/card-statements-page.tsx) |
| `dashboard/financial/expenses/import` | [page.tsx](../../src/app/dashboard/financial/expenses/import/page.tsx) | [import-page.tsx](../../src/features/financial/pages/import-page.tsx) |
| `dashboard/financial/expenses/inbox` | [page.tsx](../../src/app/dashboard/financial/expenses/inbox/page.tsx) | [financial-inbox-page.tsx](../../src/features/financial/inbox/financial-inbox-page.tsx) |
| `dashboard/financial/expenses/new` | [page.tsx](../../src/app/dashboard/financial/expenses/new/page.tsx) | [new-expense-page.tsx](../../src/features/financial/pages/new-expense-page.tsx) |
| `dashboard/financial/expenses` | [page.tsx](../../src/app/dashboard/financial/expenses/page.tsx) | [expenses-page.tsx](../../src/features/financial/pages/expenses-page.tsx) |
| `dashboard/financial/expenses/pending-audit` | [page.tsx](../../src/app/dashboard/financial/expenses/pending-audit/page.tsx) | [pending-audit-expenses-page.tsx](../../src/features/financial/pages/pending-audit-expenses-page.tsx) |
| `dashboard/financial/financial-flow` | [page.tsx](../../src/app/dashboard/financial/financial-flow/page.tsx) | Redireciona para `/dashboard/financial/cash-flow` |
| `dashboard/financial/inbox` | [page.tsx](../../src/app/dashboard/financial/inbox/page.tsx) | Redireciona para `/dashboard/financial/expenses/inbox` |
| `dashboard/financial` | [page.tsx](../../src/app/dashboard/financial/page.tsx) | [financial-dashboard-page.tsx](../../src/features/financial/pages/financial-dashboard-page.tsx) |
| `dashboard/financial/payment-requests` | [page.tsx](../../src/app/dashboard/financial/payment-requests/page.tsx) | Redireciona para `/dashboard/financial/expenses/authorizations` |
| `dashboard/financial/reconciliation/card-statements` | [page.tsx](../../src/app/dashboard/financial/reconciliation/card-statements/page.tsx) | [card-statements-page.tsx](../../src/features/financial/pages/card-statements-page.tsx) |
| `dashboard/financial/sales-reconciliation` | [page.tsx](../../src/app/dashboard/financial/sales-reconciliation/page.tsx) | [review-page.tsx](../../src/features/financial/sales-reconciliation/review-page.tsx) |
| `dashboard/financial/settings` | [page.tsx](../../src/app/dashboard/financial/settings/page.tsx) | Redireciona para `/dashboard/settings` |
| `dashboard/financial/stone-anticipations` | [page.tsx](../../src/app/dashboard/financial/stone-anticipations/page.tsx) | [stone-anticipations-page.tsx](../../src/features/financial/pages/stone-anticipations-page.tsx) |

## forms (6)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/forms/[id]` | [page.tsx](../../src/app/dashboard/forms/[id]/page.tsx) | [form-template-detail-shell.tsx](../../src/components/forms/form-template-detail-shell.tsx) |
| `dashboard/forms/[id]/view` | [page.tsx](../../src/app/dashboard/forms/[id]/view/page.tsx) | [form-execution-detail-shell.tsx](../../src/components/forms/form-execution-detail-shell.tsx) |
| `dashboard/forms/mine` | [page.tsx](../../src/app/dashboard/forms/mine/page.tsx) | [my-forms-shell.tsx](../../src/components/forms/my-forms-shell.tsx) |
| `dashboard/forms/models/[modelId]` | [page.tsx](../../src/app/dashboard/forms/models/[modelId]/page.tsx) | [form-model-page-shell.tsx](../../src/components/forms/form-model-page-shell.tsx) |
| `dashboard/forms/models/new` | [page.tsx](../../src/app/dashboard/forms/models/new/page.tsx) | [form-model-page-shell.tsx](../../src/components/forms/form-model-page-shell.tsx) |
| `dashboard/forms` | [page.tsx](../../src/app/dashboard/forms/page.tsx) | [forms-dashboard-shell.tsx](../../src/components/forms/forms-dashboard-shell.tsx) |

## goals (5)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/goals/analysis` | [page.tsx](../../src/app/dashboard/goals/analysis/page.tsx) | [goals-analysis-dashboard.tsx](../../src/components/goals-analysis-dashboard.tsx), [permission-guard.tsx](../../src/components/permission-guard.tsx) |
| `dashboard/goals/history` | [page.tsx](../../src/app/dashboard/goals/history/page.tsx) | [goals-context.tsx](../../src/contexts/goals-context.tsx), [use-kiosks.ts](../../src/hooks/use-kiosks.ts) |
| `dashboard/goals` | [page.tsx](../../src/app/dashboard/goals/page.tsx) | Redireciona para `/dashboard/goals/tracking` |
| `dashboard/goals/registration` | [page.tsx](../../src/app/dashboard/goals/registration/page.tsx) | [goals-registration-dashboard.tsx](../../src/components/goals-registration-dashboard.tsx), [permission-guard.tsx](../../src/components/permission-guard.tsx) |
| `dashboard/goals/tracking` | [page.tsx](../../src/app/dashboard/goals/tracking/page.tsx) | [goals-tracking-dashboard.tsx](../../src/components/goals-tracking-dashboard.tsx), [permission-guard.tsx](../../src/components/permission-guard.tsx) |

## help (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/help` | [page.tsx](../../src/app/dashboard/help/page.tsx) | Ler a própria página |

## hr (6)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/hr/org-chart` | [page.tsx](../../src/app/dashboard/hr/org-chart/page.tsx) | [use-profiles.ts](../../src/hooks/use-profiles.ts), [use-hr-bootstrap.ts](../../src/hooks/use-hr-bootstrap.ts) |
| `dashboard/hr/recruitment/forms` | [page.tsx](../../src/app/dashboard/hr/recruitment/forms/page.tsx) | Redireciona para `/dashboard/settings?department=pessoal&tab=recruitment` |
| `dashboard/hr/recruitment/integration/clinics` | [page.tsx](../../src/app/dashboard/hr/recruitment/integration/clinics/page.tsx) | Redireciona para `/dashboard/registration/entities` |
| `dashboard/hr/recruitment/integration` | [page.tsx](../../src/app/dashboard/hr/recruitment/integration/page.tsx) | [recruitment-shell.tsx](../../src/components/hr/recruitment/recruitment-shell.tsx) |
| `dashboard/hr/recruitment` | [page.tsx](../../src/app/dashboard/hr/recruitment/page.tsx) | [recruitment-shell.tsx](../../src/components/hr/recruitment/recruitment-shell.tsx), [recruitment-coming-soon.tsx](../../src/components/hr/recruitment/recruitment-coming-soon.tsx) |
| `dashboard/hr/recruitment/talents` | [page.tsx](../../src/app/dashboard/hr/recruitment/talents/page.tsx) | [recruitment-shell.tsx](../../src/components/hr/recruitment/recruitment-shell.tsx), [recruitment-coming-soon.tsx](../../src/components/hr/recruitment/recruitment-coming-soon.tsx) |

## import (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/import` | [page.tsx](../../src/app/dashboard/import/page.tsx) | Retorna `null` |

## inventory (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/inventory` | [page.tsx](../../src/app/dashboard/inventory/page.tsx) | [inventory-converter.tsx](../../src/components/inventory-converter.tsx) |

## inventory-control (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/inventory-control` | [page.tsx](../../src/app/dashboard/inventory-control/page.tsx) | [expiry-control.tsx](../../src/components/expiry-control.tsx), [movement-history-modal.tsx](../../src/components/movement-history-modal.tsx) |

## items (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/items` | [page.tsx](../../src/app/dashboard/items/page.tsx) | Retorna `null` |

## manager-diary (2)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/manager-diary/[logId]` | [page.tsx](../../src/app/dashboard/manager-diary/[logId]/page.tsx) | Retorna `null` |
| `dashboard/manager-diary` | [page.tsx](../../src/app/dashboard/manager-diary/page.tsx) | Retorna `null` |

## operations (2)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/operations` | [page.tsx](../../src/app/dashboard/operations/page.tsx) | [use-expiry-products.tsx](../../src/hooks/use-expiry-products.tsx), [use-products.ts](../../src/hooks/use-products.ts) |
| `dashboard/operations/settings` | [page.tsx](../../src/app/dashboard/operations/settings/page.tsx) | Redireciona para `/dashboard/settings?department=operacional&tab=forms` |

## predefined (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/predefined` | [page.tsx](../../src/app/dashboard/predefined/page.tsx) | Retorna `null` |

## pricing (4)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/pricing/competitors` | [page.tsx](../../src/app/dashboard/pricing/competitors/page.tsx) | Redireciona para `/dashboard/pricing/price-comparison` |
| `dashboard/pricing/cost-analysis` | [page.tsx](../../src/app/dashboard/pricing/cost-analysis/page.tsx) | [pricing-simulator.tsx](../../src/components/pricing-simulator.tsx), [permission-guard.tsx](../../src/components/permission-guard.tsx) |
| `dashboard/pricing` | [page.tsx](../../src/app/dashboard/pricing/page.tsx) | Ler a própria página |
| `dashboard/pricing/price-comparison` | [page.tsx](../../src/app/dashboard/pricing/price-comparison/page.tsx) | [price-comparison-table.tsx](../../src/components/price-comparison-table.tsx), [competitor-management-modal.tsx](../../src/components/competitor-management-modal.tsx) |

## processes (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/processes` | [page.tsx](../../src/app/dashboard/processes/page.tsx) | [process-center-page.tsx](../../src/features/hr/termination/process-center-page.tsx) |

## purchasing (11)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/purchasing/costs` | [page.tsx](../../src/app/dashboard/purchasing/costs/page.tsx) | [permission-guard.tsx](../../src/components/permission-guard.tsx), [purchasing-module-navigation.tsx](../../src/components/purchasing/purchasing-module-navigation.tsx) |
| `dashboard/purchasing/financial` | [page.tsx](../../src/app/dashboard/purchasing/financial/page.tsx) | Redireciona para `/dashboard/financial/expenses?origin=purchasing&status=pending_audit` |
| `dashboard/purchasing/orders/[orderId]` | [page.tsx](../../src/app/dashboard/purchasing/orders/[orderId]/page.tsx) | [permission-guard.tsx](../../src/components/permission-guard.tsx), [account-plan-tree-select.tsx](../../src/components/purchasing/account-plan-tree-select.tsx) |
| `dashboard/purchasing/orders/[orderId]/receipt` | [page.tsx](../../src/app/dashboard/purchasing/orders/[orderId]/receipt/page.tsx) | [permission-guard.tsx](../../src/components/permission-guard.tsx), [receipt-workspace.tsx](../../src/components/purchasing/receipt-workspace.tsx) |
| `dashboard/purchasing/orders` | [page.tsx](../../src/app/dashboard/purchasing/orders/page.tsx) | [permission-guard.tsx](../../src/components/permission-guard.tsx), [use-purchase-orders.ts](../../src/hooks/use-purchase-orders.ts) |
| `dashboard/purchasing` | [page.tsx](../../src/app/dashboard/purchasing/page.tsx) | Redireciona para `/dashboard/purchasing/orders` |
| `dashboard/purchasing/quotations/[quotationId]/confirm-purchase` | [page.tsx](../../src/app/dashboard/purchasing/quotations/[quotationId]/confirm-purchase/page.tsx) | [account-plan-tree-select.tsx](../../src/components/purchasing/account-plan-tree-select.tsx), [result-center-select.tsx](../../src/components/purchasing/result-center-select.tsx) |
| `dashboard/purchasing/quotations/[quotationId]` | [page.tsx](../../src/app/dashboard/purchasing/quotations/[quotationId]/page.tsx) | [permission-guard.tsx](../../src/components/permission-guard.tsx), [quotation-workspace.tsx](../../src/components/purchasing/quotation-workspace.tsx) |
| `dashboard/purchasing/quotations/compare` | [page.tsx](../../src/app/dashboard/purchasing/quotations/compare/page.tsx) | [permission-guard.tsx](../../src/components/permission-guard.tsx), [purchasing-module-navigation.tsx](../../src/components/purchasing/purchasing-module-navigation.tsx) |
| `dashboard/purchasing/quotations` | [page.tsx](../../src/app/dashboard/purchasing/quotations/page.tsx) | [permission-guard.tsx](../../src/components/permission-guard.tsx), [create-quotation-modal.tsx](../../src/components/purchasing/create-quotation-modal.tsx) |
| `dashboard/purchasing/receipts` | [page.tsx](../../src/app/dashboard/purchasing/receipts/page.tsx) | [permission-guard.tsx](../../src/components/permission-guard.tsx), [purchasing-module-navigation.tsx](../../src/components/purchasing/purchasing-module-navigation.tsx) |

## raiz (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard` | [page.tsx](../../src/app/dashboard/page.tsx) | [goals-provider.tsx](../../src/components/goals-provider.tsx), [dp-context.tsx](../../src/components/dp-context.tsx) |

## registration (4)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/registration/base-products` | [page.tsx](../../src/app/dashboard/registration/base-products/page.tsx) | [registration-catalog.tsx](../../src/components/registration/registration-catalog.tsx) |
| `dashboard/registration/entities` | [page.tsx](../../src/app/dashboard/registration/entities/page.tsx) | [registration-catalog.tsx](../../src/components/registration/registration-catalog.tsx) |
| `dashboard/registration/items` | [page.tsx](../../src/app/dashboard/registration/items/page.tsx) | [registration-catalog.tsx](../../src/components/registration/registration-catalog.tsx) |
| `dashboard/registration` | [page.tsx](../../src/app/dashboard/registration/page.tsx) | [registration-catalog.tsx](../../src/components/registration/registration-catalog.tsx) |

## reports (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/reports` | [page.tsx](../../src/app/dashboard/reports/page.tsx) | Ler a própria página |

## resignation (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/resignation` | [page.tsx](../../src/app/dashboard/resignation/page.tsx) | [resignation-self-service.tsx](../../src/features/hr/termination/resignation-self-service.tsx) |

## rh (6)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/rh/config/fields` | [page.tsx](../../src/app/dashboard/rh/config/fields/page.tsx) | [FieldConfigPage.tsx](../../src/features/rh/components/FieldConfigPage.tsx) |
| `dashboard/rh/config/roles` | [page.tsx](../../src/app/dashboard/rh/config/roles/page.tsx) | [RolesConfigPage.tsx](../../src/features/rh/components/RolesConfigPage.tsx) |
| `dashboard/rh/employees/[bizneo_employee_id]` | [page.tsx](../../src/app/dashboard/rh/employees/[bizneo_employee_id]/page.tsx) | [ProfilePage.tsx](../../src/features/rh/components/ProfilePage.tsx) |
| `dashboard/rh/employees` | [page.tsx](../../src/app/dashboard/rh/employees/page.tsx) | [EmployeeListPage.tsx](../../src/features/rh/components/EmployeeListPage.tsx) |
| `dashboard/rh/me` | [page.tsx](../../src/app/dashboard/rh/me/page.tsx) | [MyProfilePage.tsx](../../src/features/rh/components/MyProfilePage.tsx) |
| `dashboard/rh/sync` | [page.tsx](../../src/app/dashboard/rh/sync/page.tsx) | [SyncPanel.tsx](../../src/features/rh/components/SyncPanel.tsx) |

## settings (3)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/settings` | [page.tsx](../../src/app/dashboard/settings/page.tsx) | [use-hr-bootstrap.ts](../../src/hooks/use-hr-bootstrap.ts), [permission-guard.tsx](../../src/components/permission-guard.tsx) |
| `dashboard/settings/pdv-sync` | [page.tsx](../../src/app/dashboard/settings/pdv-sync/page.tsx) | [permission-guard.tsx](../../src/components/permission-guard.tsx), [pdv-sync-management.tsx](../../src/components/pdv-sync-management.tsx) |
| `dashboard/settings/units` | [page.tsx](../../src/app/dashboard/settings/units/page.tsx) | [permission-guard.tsx](../../src/components/permission-guard.tsx), [dp-runtime-guard.tsx](../../src/components/dp-runtime-guard.tsx) |

## signage (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/signage` | [page.tsx](../../src/app/dashboard/signage/page.tsx) | [signage-admin.tsx](../../src/components/signage/signage-admin.tsx) |

## stock (24)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/stock/analysis/consumption` | [page.tsx](../../src/app/dashboard/stock/analysis/consumption/page.tsx) | [consumption-analysis-dashboard.tsx](../../src/components/consumption-analysis-dashboard.tsx), [permission-guard.tsx](../../src/components/permission-guard.tsx) |
| `dashboard/stock/analysis/movement-analysis` | [page.tsx](../../src/app/dashboard/stock/analysis/movement-analysis/page.tsx) | [movement-analysis.tsx](../../src/components/movement-analysis.tsx) |
| `dashboard/stock/analysis` | [page.tsx](../../src/app/dashboard/stock/analysis/page.tsx) | [reposition-management.tsx](../../src/components/reposition-management.tsx), [use-kiosks.ts](../../src/hooks/use-kiosks.ts) |
| `dashboard/stock/analysis/projection` | [page.tsx](../../src/app/dashboard/stock/analysis/projection/page.tsx) | [consumption-projection.tsx](../../src/components/consumption-projection.tsx), [permission-guard.tsx](../../src/components/permission-guard.tsx) |
| `dashboard/stock/analysis/restock` | [page.tsx](../../src/app/dashboard/stock/analysis/restock/page.tsx) | [restock-analysis.tsx](../../src/components/restock-analysis.tsx), [index.ts](../../src/types/index.ts) |
| `dashboard/stock/analysis/sales` | [page.tsx](../../src/app/dashboard/stock/analysis/sales/page.tsx) | [sales-analysis-dashboard.tsx](../../src/components/sales-analysis-dashboard.tsx) |
| `dashboard/stock/analysis/valuation` | [page.tsx](../../src/app/dashboard/stock/analysis/valuation/page.tsx) | [stock-valuation.tsx](../../src/components/stock-valuation.tsx), [permission-guard.tsx](../../src/components/permission-guard.tsx) |
| `dashboard/stock/audit` | [page.tsx](../../src/app/dashboard/stock/audit/page.tsx) | Retorna `null` |
| `dashboard/stock/audit/stock-audit` | [page.tsx](../../src/app/dashboard/stock/audit/stock-audit/page.tsx) | Retorna `null` |
| `dashboard/stock/count` | [page.tsx](../../src/app/dashboard/stock/count/page.tsx) | [stock-session-management.tsx](../../src/components/stock-session-management.tsx) |
| `dashboard/stock/inventory-control` | [page.tsx](../../src/app/dashboard/stock/inventory-control/page.tsx) | [expiry-control.tsx](../../src/components/expiry-control.tsx), [movement-history-modal.tsx](../../src/components/movement-history-modal.tsx) |
| `dashboard/stock/item-requests` | [page.tsx](../../src/app/dashboard/stock/item-requests/page.tsx) | [item-addition-request-management.tsx](../../src/components/item-addition-request-management.tsx) |
| `dashboard/stock/movement-history` | [page.tsx](../../src/app/dashboard/stock/movement-history/page.tsx) | Retorna `null` |
| `dashboard/stock` | [page.tsx](../../src/app/dashboard/stock/page.tsx) | [stock-management.tsx](../../src/components/stock-management.tsx) |
| `dashboard/stock/purchasing/history` | [page.tsx](../../src/app/dashboard/stock/purchasing/history/page.tsx) | [purchase-history-dashboard.tsx](../../src/components/purchase-history-dashboard.tsx) |
| `dashboard/stock/purchasing` | [page.tsx](../../src/app/dashboard/stock/purchasing/page.tsx) | [use-purchase.ts](../../src/hooks/use-purchase.ts), [permission-guard.tsx](../../src/components/permission-guard.tsx) |
| `dashboard/stock/purchasing/sessions/[sessionId]` | [page.tsx](../../src/app/dashboard/stock/purchasing/sessions/[sessionId]/page.tsx) | [use-purchase.ts](../../src/hooks/use-purchase.ts), [purchase-session-card.tsx](../../src/components/purchase-session-card.tsx) |
| `dashboard/stock/purchasing/sessions` | [page.tsx](../../src/app/dashboard/stock/purchasing/sessions/page.tsx) | Redireciona para `/dashboard/stock/purchasing` |
| `dashboard/stock/purchasing/suggestion` | [page.tsx](../../src/app/dashboard/stock/purchasing/suggestion/page.tsx) | Retorna `null` |
| `dashboard/stock/reposition` | [page.tsx](../../src/app/dashboard/stock/reposition/page.tsx) | [reposition-management.tsx](../../src/components/reposition-management.tsx), [use-reposition.ts](../../src/hooks/use-reposition.ts) |
| `dashboard/stock/returns` | [page.tsx](../../src/app/dashboard/stock/returns/page.tsx) | [return-request-management.tsx](../../src/components/return-request-management.tsx), [add-return-request-modal.tsx](../../src/components/add-return-request-modal.tsx) |
| `dashboard/stock/transfer` | [page.tsx](../../src/app/dashboard/stock/transfer/page.tsx) | [stock-transfer.tsx](../../src/components/stock-transfer.tsx) |
| `dashboard/stock/uniforms` | [page.tsx](../../src/app/dashboard/stock/uniforms/page.tsx) | [uniform-management.tsx](../../src/components/uniform-management.tsx) |
| `dashboard/stock/write-down` | [page.tsx](../../src/app/dashboard/stock/write-down/page.tsx) | [stock-write-down.tsx](../../src/components/stock-write-down.tsx) |

## tasks (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/tasks` | [page.tsx](../../src/app/dashboard/tasks/page.tsx) | [task-manager.tsx](../../src/components/task-manager.tsx) |

## team (1)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/team` | [page.tsx](../../src/app/dashboard/team/page.tsx) | Retorna `null` |

## users (2)

| Pasta sob `src/app` | Arquivo | Próximo ponto direto |
| --- | --- | --- |
| `dashboard/users/inactive` | [page.tsx](../../src/app/dashboard/users/inactive/page.tsx) | [inactive-users-screen.tsx](../../src/components/inactive-users-screen.tsx) |
| `dashboard/users` | [page.tsx](../../src/app/dashboard/users/page.tsx) | Redireciona para `/dashboard/dp/collaborators` |

Total: **156 páginas** no checkout usado para a geração.
