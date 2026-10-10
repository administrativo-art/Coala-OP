# Inventário de contratos de segurança das APIs

Arquivo gerado. O baseline congela dívida estrutural e **não aprova** autenticação, autorização ou comportamento das rotas legadas.

- Arquivos de rota: **413**
- Totalmente contratados: **41**
- Legados congelados: **372**
- Exceções temporárias: **0**
- Violações: **0**

Qualquer arquivo de rota novo ou alterado precisa usar `secureRoute` em todos os métodos exportados ou possuir exceção temporária válida. Uma rota só deixa de ser legada quando seus métodos são efetivamente contratados.

| Rota | Métodos | Estado | Fonte |
| --- | --- | --- | --- |
| `/api/admin/fix-receipts` | POST | `LEGACY_BASELINE` | [src/app/api/admin/fix-receipts/route.ts](../../src/app/api/admin/fix-receipts/route.ts) |
| `/api/ai/analyze-consumption` | POST | `LEGACY_BASELINE` | [src/app/api/ai/analyze-consumption/route.ts](../../src/app/api/ai/analyze-consumption/route.ts) |
| `/api/ai/analyze-goals` | POST | `LEGACY_BASELINE` | [src/app/api/ai/analyze-goals/route.ts](../../src/app/api/ai/analyze-goals/route.ts) |
| `/api/assets` | GET, POST | `LEGACY_BASELINE` | [src/app/api/assets/route.ts](../../src/app/api/assets/route.ts) |
| `/api/assets/[assetId]` | GET, PATCH, POST | `LEGACY_BASELINE` | [src/app/api/assets/[assetId]/route.ts](../../src/app/api/assets/[assetId]/route.ts) |
| `/api/assets/[assetId]/movements` | GET | `LEGACY_BASELINE` | [src/app/api/assets/[assetId]/movements/route.ts](../../src/app/api/assets/[assetId]/movements/route.ts) |
| `/api/assets/barcode-labels` | GET, POST | `LEGACY_BASELINE` | [src/app/api/assets/barcode-labels/route.ts](../../src/app/api/assets/barcode-labels/route.ts) |
| `/api/assets/categories` | GET, POST | `LEGACY_BASELINE` | [src/app/api/assets/categories/route.ts](../../src/app/api/assets/categories/route.ts) |
| `/api/assets/upload` | POST | `LEGACY_BASELINE` | [src/app/api/assets/upload/route.ts](../../src/app/api/assets/upload/route.ts) |
| `/api/audit/log` | POST | `LEGACY_BASELINE` | [src/app/api/audit/log/route.ts](../../src/app/api/audit/log/route.ts) |
| `/api/audit/logs` | GET | `LEGACY_BASELINE` | [src/app/api/audit/logs/route.ts](../../src/app/api/audit/logs/route.ts) |
| `/api/auth/first-access/[token]` | GET ✓, POST ✓ | `CONTRACTED` | [src/app/api/auth/first-access/[token]/route.ts](../../src/app/api/auth/first-access/[token]/route.ts) |
| `/api/auth/forgot-password` | POST | `LEGACY_BASELINE` | [src/app/api/auth/forgot-password/route.ts](../../src/app/api/auth/forgot-password/route.ts) |
| `/api/auth/last-login` | POST | `LEGACY_BASELINE` | [src/app/api/auth/last-login/route.ts](../../src/app/api/auth/last-login/route.ts) |
| `/api/auth/password-changed` | POST | `LEGACY_BASELINE` | [src/app/api/auth/password-changed/route.ts](../../src/app/api/auth/password-changed/route.ts) |
| `/api/catalogo` | GET | `LEGACY_BASELINE` | [src/app/api/catalogo/route.ts](../../src/app/api/catalogo/route.ts) |
| `/api/client/bootstrap` | GET | `LEGACY_BASELINE` | [src/app/api/client/bootstrap/route.ts](../../src/app/api/client/bootstrap/route.ts) |
| `/api/collaborator/dashboard` | GET | `LEGACY_BASELINE` | [src/app/api/collaborator/dashboard/route.ts](../../src/app/api/collaborator/dashboard/route.ts) |
| `/api/collaborator/schedule` | GET | `LEGACY_BASELINE` | [src/app/api/collaborator/schedule/route.ts](../../src/app/api/collaborator/schedule/route.ts) |
| `/api/companies` | POST | `LEGACY_BASELINE` | [src/app/api/companies/route.ts](../../src/app/api/companies/route.ts) |
| `/api/companies/[id]` | PUT | `LEGACY_BASELINE` | [src/app/api/companies/[id]/route.ts](../../src/app/api/companies/[id]/route.ts) |
| `/api/companies/[id]/consultation-history` | GET | `LEGACY_BASELINE` | [src/app/api/companies/[id]/consultation-history/route.ts](../../src/app/api/companies/[id]/consultation-history/route.ts) |
| `/api/companies/cnpj/[cnpj]` | GET | `LEGACY_BASELINE` | [src/app/api/companies/cnpj/[cnpj]/route.ts](../../src/app/api/companies/cnpj/[cnpj]/route.ts) |
| `/api/companies/cnpj/[cnpj]/refresh` | POST | `LEGACY_BASELINE` | [src/app/api/companies/cnpj/[cnpj]/refresh/route.ts](../../src/app/api/companies/cnpj/[cnpj]/refresh/route.ts) |
| `/api/companies/document-signatories` | GET | `LEGACY_BASELINE` | [src/app/api/companies/document-signatories/route.ts](../../src/app/api/companies/document-signatories/route.ts) |
| `/api/dashboard/layouts` | DELETE ✓, GET ✓, PATCH ✓, PUT ✓ | `CONTRACTED` | [src/app/api/dashboard/layouts/route.ts](../../src/app/api/dashboard/layouts/route.ts) |
| `/api/documents/collective-agreements` | GET, POST | `LEGACY_BASELINE` | [src/app/api/documents/collective-agreements/route.ts](../../src/app/api/documents/collective-agreements/route.ts) |
| `/api/documents/collective-agreements/[id]` | PATCH | `LEGACY_BASELINE` | [src/app/api/documents/collective-agreements/[id]/route.ts](../../src/app/api/documents/collective-agreements/[id]/route.ts) |
| `/api/documents/company` | DELETE, GET, POST | `LEGACY_BASELINE` | [src/app/api/documents/company/route.ts](../../src/app/api/documents/company/route.ts) |
| `/api/documents/company/access` | POST | `LEGACY_BASELINE` | [src/app/api/documents/company/access/route.ts](../../src/app/api/documents/company/access/route.ts) |
| `/api/documents/company/analyze` | POST | `LEGACY_BASELINE` | [src/app/api/documents/company/analyze/route.ts](../../src/app/api/documents/company/analyze/route.ts) |
| `/api/documents/company/units` | GET | `LEGACY_BASELINE` | [src/app/api/documents/company/units/route.ts](../../src/app/api/documents/company/units/route.ts) |
| `/api/documents/generate` | POST | `LEGACY_BASELINE` | [src/app/api/documents/generate/route.ts](../../src/app/api/documents/generate/route.ts) |
| `/api/documents/generated` | GET | `LEGACY_BASELINE` | [src/app/api/documents/generated/route.ts](../../src/app/api/documents/generated/route.ts) |
| `/api/documents/generated/[id]` | DELETE, PATCH, POST | `LEGACY_BASELINE` | [src/app/api/documents/generated/[id]/route.ts](../../src/app/api/documents/generated/[id]/route.ts) |
| `/api/documents/generated/[id]/audit` | GET | `LEGACY_BASELINE` | [src/app/api/documents/generated/[id]/audit/route.ts](../../src/app/api/documents/generated/[id]/audit/route.ts) |
| `/api/documents/generated/[id]/file` | GET | `LEGACY_BASELINE` | [src/app/api/documents/generated/[id]/file/route.ts](../../src/app/api/documents/generated/[id]/file/route.ts) |
| `/api/documents/generated/[id]/signature` | GET, POST | `LEGACY_BASELINE` | [src/app/api/documents/generated/[id]/signature/route.ts](../../src/app/api/documents/generated/[id]/signature/route.ts) |
| `/api/documents/generator/parties` | GET | `LEGACY_BASELINE` | [src/app/api/documents/generator/parties/route.ts](../../src/app/api/documents/generator/parties/route.ts) |
| `/api/documents/generator/templates` | GET | `LEGACY_BASELINE` | [src/app/api/documents/generator/templates/route.ts](../../src/app/api/documents/generator/templates/route.ts) |
| `/api/documents/templates` | GET, POST | `LEGACY_BASELINE` | [src/app/api/documents/templates/route.ts](../../src/app/api/documents/templates/route.ts) |
| `/api/documents/templates/[id]` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/documents/templates/[id]/route.ts](../../src/app/api/documents/templates/[id]/route.ts) |
| `/api/documents/templates/[id]/ai-plan` | GET, PATCH, POST | `LEGACY_BASELINE` | [src/app/api/documents/templates/[id]/ai-plan/route.ts](../../src/app/api/documents/templates/[id]/ai-plan/route.ts) |
| `/api/documents/templates/[id]/editable-version` | POST | `LEGACY_BASELINE` | [src/app/api/documents/templates/[id]/editable-version/route.ts](../../src/app/api/documents/templates/[id]/editable-version/route.ts) |
| `/api/documents/templates/[id]/editor` | GET, POST | `LEGACY_BASELINE` | [src/app/api/documents/templates/[id]/editor/route.ts](../../src/app/api/documents/templates/[id]/editor/route.ts) |
| `/api/documents/templates/[id]/file` | POST | `LEGACY_BASELINE` | [src/app/api/documents/templates/[id]/file/route.ts](../../src/app/api/documents/templates/[id]/file/route.ts) |
| `/api/documents/templates/[id]/integrity` | POST | `LEGACY_BASELINE` | [src/app/api/documents/templates/[id]/integrity/route.ts](../../src/app/api/documents/templates/[id]/integrity/route.ts) |
| `/api/documents/templates/[id]/preview` | GET | `LEGACY_BASELINE` | [src/app/api/documents/templates/[id]/preview/route.ts](../../src/app/api/documents/templates/[id]/preview/route.ts) |
| `/api/documents/templates/[id]/source` | GET | `LEGACY_BASELINE` | [src/app/api/documents/templates/[id]/source/route.ts](../../src/app/api/documents/templates/[id]/source/route.ts) |
| `/api/documents/templates/[id]/text` | GET | `LEGACY_BASELINE` | [src/app/api/documents/templates/[id]/text/route.ts](../../src/app/api/documents/templates/[id]/text/route.ts) |
| `/api/documents/templates/[id]/workflow` | PATCH | `LEGACY_BASELINE` | [src/app/api/documents/templates/[id]/workflow/route.ts](../../src/app/api/documents/templates/[id]/workflow/route.ts) |
| `/api/dp/bootstrap` | GET | `LEGACY_BASELINE` | [src/app/api/dp/bootstrap/route.ts](../../src/app/api/dp/bootstrap/route.ts) |
| `/api/dp/mobile-schedule` | GET ✓ | `CONTRACTED` | [src/app/api/dp/mobile-schedule/route.ts](../../src/app/api/dp/mobile-schedule/route.ts) |
| `/api/dp/natasha/availability` | GET | `LEGACY_BASELINE` | [src/app/api/dp/natasha/availability/route.ts](../../src/app/api/dp/natasha/availability/route.ts) |
| `/api/dp/natasha/shift-definitions` | GET | `LEGACY_BASELINE` | [src/app/api/dp/natasha/shift-definitions/route.ts](../../src/app/api/dp/natasha/shift-definitions/route.ts) |
| `/api/dp/natasha/team` | GET | `LEGACY_BASELINE` | [src/app/api/dp/natasha/team/route.ts](../../src/app/api/dp/natasha/team/route.ts) |
| `/api/dp/schedules/[scheduleId]/coverage-demands/[date]` | PUT | `LEGACY_BASELINE` | [src/app/api/dp/schedules/[scheduleId]/coverage-demands/[date]/route.ts](../../src/app/api/dp/schedules/[scheduleId]/coverage-demands/[date]/route.ts) |
| `/api/dp/schedules/[scheduleId]/day-offs` | DELETE, POST | `LEGACY_BASELINE` | [src/app/api/dp/schedules/[scheduleId]/day-offs/route.ts](../../src/app/api/dp/schedules/[scheduleId]/day-offs/route.ts) |
| `/api/dp/schedules/[scheduleId]/shifts/[shiftId]` | DELETE, PATCH, PUT | `LEGACY_BASELINE` | [src/app/api/dp/schedules/[scheduleId]/shifts/[shiftId]/route.ts](../../src/app/api/dp/schedules/[scheduleId]/shifts/[shiftId]/route.ts) |
| `/api/dp/schedules/[scheduleId]/shifts/bulk` | POST | `LEGACY_BASELINE` | [src/app/api/dp/schedules/[scheduleId]/shifts/bulk/route.ts](../../src/app/api/dp/schedules/[scheduleId]/shifts/bulk/route.ts) |
| `/api/dp/schedules/[scheduleId]/vacations` | GET | `LEGACY_BASELINE` | [src/app/api/dp/schedules/[scheduleId]/vacations/route.ts](../../src/app/api/dp/schedules/[scheduleId]/vacations/route.ts) |
| `/api/dp/unit-groups` | POST | `LEGACY_BASELINE` | [src/app/api/dp/unit-groups/route.ts](../../src/app/api/dp/unit-groups/route.ts) |
| `/api/dp/unit-groups/[groupId]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/dp/unit-groups/[groupId]/route.ts](../../src/app/api/dp/unit-groups/[groupId]/route.ts) |
| `/api/dp/unit-organizations` | POST | `LEGACY_BASELINE` | [src/app/api/dp/unit-organizations/route.ts](../../src/app/api/dp/unit-organizations/route.ts) |
| `/api/dp/unit-organizations/[organizationId]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/dp/unit-organizations/[organizationId]/route.ts](../../src/app/api/dp/unit-organizations/[organizationId]/route.ts) |
| `/api/dp/units` | POST | `LEGACY_BASELINE` | [src/app/api/dp/units/route.ts](../../src/app/api/dp/units/route.ts) |
| `/api/dp/units/[unitId]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/dp/units/[unitId]/route.ts](../../src/app/api/dp/units/[unitId]/route.ts) |
| `/api/dp/vacations` | GET, POST | `LEGACY_BASELINE` | [src/app/api/dp/vacations/route.ts](../../src/app/api/dp/vacations/route.ts) |
| `/api/dp/vacations/[vacationId]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/dp/vacations/[vacationId]/route.ts](../../src/app/api/dp/vacations/[vacationId]/route.ts) |
| `/api/dp/vacations/[vacationId]/assets/[kind]` | GET | `LEGACY_BASELINE` | [src/app/api/dp/vacations/[vacationId]/assets/[kind]/route.ts](../../src/app/api/dp/vacations/[vacationId]/assets/[kind]/route.ts) |
| `/api/dp/vacations/[vacationId]/events` | GET | `LEGACY_BASELINE` | [src/app/api/dp/vacations/[vacationId]/events/route.ts](../../src/app/api/dp/vacations/[vacationId]/events/route.ts) |
| `/api/dp/vacations/[vacationId]/notice` | GET | `LEGACY_BASELINE` | [src/app/api/dp/vacations/[vacationId]/notice/route.ts](../../src/app/api/dp/vacations/[vacationId]/notice/route.ts) |
| `/api/dp/vacations/[vacationId]/receipt-documents/[documentId]` | GET | `LEGACY_BASELINE` | [src/app/api/dp/vacations/[vacationId]/receipt-documents/[documentId]/route.ts](../../src/app/api/dp/vacations/[vacationId]/receipt-documents/[documentId]/route.ts) |
| `/api/financial/accounts` | DELETE, PATCH, POST | `LEGACY_BASELINE` | [src/app/api/financial/accounts/route.ts](../../src/app/api/financial/accounts/route.ts) |
| `/api/financial/acquirer-fees` | GET, POST | `LEGACY_BASELINE` | [src/app/api/financial/acquirer-fees/route.ts](../../src/app/api/financial/acquirer-fees/route.ts) |
| `/api/financial/agent` | POST | `LEGACY_BASELINE` | [src/app/api/financial/agent/route.ts](../../src/app/api/financial/agent/route.ts) |
| `/api/financial/analysis-routines` | GET, POST | `LEGACY_BASELINE` | [src/app/api/financial/analysis-routines/route.ts](../../src/app/api/financial/analysis-routines/route.ts) |
| `/api/financial/analysis-routines/scheduler` | POST | `LEGACY_BASELINE` | [src/app/api/financial/analysis-routines/scheduler/route.ts](../../src/app/api/financial/analysis-routines/scheduler/route.ts) |
| `/api/financial/beneficiaries` | GET | `LEGACY_BASELINE` | [src/app/api/financial/beneficiaries/route.ts](../../src/app/api/financial/beneficiaries/route.ts) |
| `/api/financial/beneficiaries/entities/[entityId]` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/financial/beneficiaries/entities/[entityId]/route.ts](../../src/app/api/financial/beneficiaries/entities/[entityId]/route.ts) |
| `/api/financial/bootstrap` | POST | `LEGACY_BASELINE` | [src/app/api/financial/bootstrap/route.ts](../../src/app/api/financial/bootstrap/route.ts) |
| `/api/financial/budget-inputs` | GET | `LEGACY_BASELINE` | [src/app/api/financial/budget-inputs/route.ts](../../src/app/api/financial/budget-inputs/route.ts) |
| `/api/financial/budget-projects` | GET, POST | `LEGACY_BASELINE` | [src/app/api/financial/budget-projects/route.ts](../../src/app/api/financial/budget-projects/route.ts) |
| `/api/financial/budget-projects/[id]` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/financial/budget-projects/[id]/route.ts](../../src/app/api/financial/budget-projects/[id]/route.ts) |
| `/api/financial/budget-projects/[id]/candidates` | GET | `LEGACY_BASELINE` | [src/app/api/financial/budget-projects/[id]/candidates/route.ts](../../src/app/api/financial/budget-projects/[id]/candidates/route.ts) |
| `/api/financial/budget-projects/[id]/expenses` | DELETE, POST | `LEGACY_BASELINE` | [src/app/api/financial/budget-projects/[id]/expenses/route.ts](../../src/app/api/financial/budget-projects/[id]/expenses/route.ts) |
| `/api/financial/budget-projects/[id]/stages` | POST | `LEGACY_BASELINE` | [src/app/api/financial/budget-projects/[id]/stages/route.ts](../../src/app/api/financial/budget-projects/[id]/stages/route.ts) |
| `/api/financial/budget-rules` | GET, POST | `LEGACY_BASELINE` | [src/app/api/financial/budget-rules/route.ts](../../src/app/api/financial/budget-rules/route.ts) |
| `/api/financial/budget-rules/[id]` | PATCH | `LEGACY_BASELINE` | [src/app/api/financial/budget-rules/[id]/route.ts](../../src/app/api/financial/budget-rules/[id]/route.ts) |
| `/api/financial/budget-rules/generate` | POST | `LEGACY_BASELINE` | [src/app/api/financial/budget-rules/generate/route.ts](../../src/app/api/financial/budget-rules/generate/route.ts) |
| `/api/financial/budget-rules/preview` | POST | `LEGACY_BASELINE` | [src/app/api/financial/budget-rules/preview/route.ts](../../src/app/api/financial/budget-rules/preview/route.ts) |
| `/api/financial/budgets` | GET, POST | `LEGACY_BASELINE` | [src/app/api/financial/budgets/route.ts](../../src/app/api/financial/budgets/route.ts) |
| `/api/financial/budgets/[id]` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/financial/budgets/[id]/route.ts](../../src/app/api/financial/budgets/[id]/route.ts) |
| `/api/financial/budgets/[id]/coverage` | POST | `LEGACY_BASELINE` | [src/app/api/financial/budgets/[id]/coverage/route.ts](../../src/app/api/financial/budgets/[id]/coverage/route.ts) |
| `/api/financial/budgets/cash-projections` | GET | `LEGACY_BASELINE` | [src/app/api/financial/budgets/cash-projections/route.ts](../../src/app/api/financial/budgets/cash-projections/route.ts) |
| `/api/financial/budgets/centers` | GET | `LEGACY_BASELINE` | [src/app/api/financial/budgets/centers/route.ts](../../src/app/api/financial/budgets/centers/route.ts) |
| `/api/financial/budgets/forecast-conversion` | GET, POST | `LEGACY_BASELINE` | [src/app/api/financial/budgets/forecast-conversion/route.ts](../../src/app/api/financial/budgets/forecast-conversion/route.ts) |
| `/api/financial/budgets/person-references` | GET, POST | `LEGACY_BASELINE` | [src/app/api/financial/budgets/person-references/route.ts](../../src/app/api/financial/budgets/person-references/route.ts) |
| `/api/financial/card-statements/[statementId]/reconcile` | POST | `LEGACY_BASELINE` | [src/app/api/financial/card-statements/[statementId]/reconcile/route.ts](../../src/app/api/financial/card-statements/[statementId]/reconcile/route.ts) |
| `/api/financial/card-statements/import` | POST | `LEGACY_BASELINE` | [src/app/api/financial/card-statements/import/route.ts](../../src/app/api/financial/card-statements/import/route.ts) |
| `/api/financial/card-statements/import-preview` | POST | `LEGACY_BASELINE` | [src/app/api/financial/card-statements/import-preview/route.ts](../../src/app/api/financial/card-statements/import-preview/route.ts) |
| `/api/financial/cash-closures` | GET | `LEGACY_BASELINE` | [src/app/api/financial/cash-closures/route.ts](../../src/app/api/financial/cash-closures/route.ts) |
| `/api/financial/cash-closures/[closureId]` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/financial/cash-closures/[closureId]/route.ts](../../src/app/api/financial/cash-closures/[closureId]/route.ts) |
| `/api/financial/cash-closures/[closureId]/audit` | GET | `LEGACY_BASELINE` | [src/app/api/financial/cash-closures/[closureId]/audit/route.ts](../../src/app/api/financial/cash-closures/[closureId]/audit/route.ts) |
| `/api/financial/cash-closures/[closureId]/expected-adjustment` | DELETE, POST | `LEGACY_BASELINE` | [src/app/api/financial/cash-closures/[closureId]/expected-adjustment/route.ts](../../src/app/api/financial/cash-closures/[closureId]/expected-adjustment/route.ts) |
| `/api/financial/cash-closures/[closureId]/finalize` | POST | `LEGACY_BASELINE` | [src/app/api/financial/cash-closures/[closureId]/finalize/route.ts](../../src/app/api/financial/cash-closures/[closureId]/finalize/route.ts) |
| `/api/financial/cash-closures/[closureId]/reopen` | POST | `LEGACY_BASELINE` | [src/app/api/financial/cash-closures/[closureId]/reopen/route.ts](../../src/app/api/financial/cash-closures/[closureId]/reopen/route.ts) |
| `/api/financial/cash-closures/[closureId]/split-deposit` | POST | `LEGACY_BASELINE` | [src/app/api/financial/cash-closures/[closureId]/split-deposit/route.ts](../../src/app/api/financial/cash-closures/[closureId]/split-deposit/route.ts) |
| `/api/financial/cash-closures/[closureId]/withdrawals` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/financial/cash-closures/[closureId]/withdrawals/route.ts](../../src/app/api/financial/cash-closures/[closureId]/withdrawals/route.ts) |
| `/api/financial/cash-closures/months` | GET | `LEGACY_BASELINE` | [src/app/api/financial/cash-closures/months/route.ts](../../src/app/api/financial/cash-closures/months/route.ts) |
| `/api/financial/cash-closures/overview` | GET | `LEGACY_BASELINE` | [src/app/api/financial/cash-closures/overview/route.ts](../../src/app/api/financial/cash-closures/overview/route.ts) |
| `/api/financial/cash-closures/sync` | POST ✓ | `CONTRACTED` | [src/app/api/financial/cash-closures/sync/route.ts](../../src/app/api/financial/cash-closures/sync/route.ts) |
| `/api/financial/cash-counting-sessions` | GET, POST | `LEGACY_BASELINE` | [src/app/api/financial/cash-counting-sessions/route.ts](../../src/app/api/financial/cash-counting-sessions/route.ts) |
| `/api/financial/cash-counting-sessions/[sessionId]` | GET | `LEGACY_BASELINE` | [src/app/api/financial/cash-counting-sessions/[sessionId]/route.ts](../../src/app/api/financial/cash-counting-sessions/[sessionId]/route.ts) |
| `/api/financial/cash-counting-sessions/[sessionId]/cancel` | POST | `LEGACY_BASELINE` | [src/app/api/financial/cash-counting-sessions/[sessionId]/cancel/route.ts](../../src/app/api/financial/cash-counting-sessions/[sessionId]/cancel/route.ts) |
| `/api/financial/cash-counting-sessions/[sessionId]/coins/exchange` | POST | `LEGACY_BASELINE` | [src/app/api/financial/cash-counting-sessions/[sessionId]/coins/exchange/route.ts](../../src/app/api/financial/cash-counting-sessions/[sessionId]/coins/exchange/route.ts) |
| `/api/financial/cash-counting-sessions/[sessionId]/denominations` | POST | `LEGACY_BASELINE` | [src/app/api/financial/cash-counting-sessions/[sessionId]/denominations/route.ts](../../src/app/api/financial/cash-counting-sessions/[sessionId]/denominations/route.ts) |
| `/api/financial/cash-counting-sessions/[sessionId]/draft-position` | PATCH | `LEGACY_BASELINE` | [src/app/api/financial/cash-counting-sessions/[sessionId]/draft-position/route.ts](../../src/app/api/financial/cash-counting-sessions/[sessionId]/draft-position/route.ts) |
| `/api/financial/cash-counting-sessions/[sessionId]/finish` | POST | `LEGACY_BASELINE` | [src/app/api/financial/cash-counting-sessions/[sessionId]/finish/route.ts](../../src/app/api/financial/cash-counting-sessions/[sessionId]/finish/route.ts) |
| `/api/financial/cash-deposits` | GET | `LEGACY_BASELINE` | [src/app/api/financial/cash-deposits/route.ts](../../src/app/api/financial/cash-deposits/route.ts) |
| `/api/financial/cash-deposits/[batchId]` | GET | `LEGACY_BASELINE` | [src/app/api/financial/cash-deposits/[batchId]/route.ts](../../src/app/api/financial/cash-deposits/[batchId]/route.ts) |
| `/api/financial/cash-deposits/[batchId]/cancel` | POST | `LEGACY_BASELINE` | [src/app/api/financial/cash-deposits/[batchId]/cancel/route.ts](../../src/app/api/financial/cash-deposits/[batchId]/cancel/route.ts) |
| `/api/financial/cash-deposits/[batchId]/coins` | POST | `LEGACY_BASELINE` | [src/app/api/financial/cash-deposits/[batchId]/coins/route.ts](../../src/app/api/financial/cash-deposits/[batchId]/coins/route.ts) |
| `/api/financial/cash-deposits/[batchId]/issue` | POST | `LEGACY_BASELINE` | [src/app/api/financial/cash-deposits/[batchId]/issue/route.ts](../../src/app/api/financial/cash-deposits/[batchId]/issue/route.ts) |
| `/api/financial/cash-deposits/[batchId]/pdf` | GET | `LEGACY_BASELINE` | [src/app/api/financial/cash-deposits/[batchId]/pdf/route.ts](../../src/app/api/financial/cash-deposits/[batchId]/pdf/route.ts) |
| `/api/financial/cash-deposits/[batchId]/refresh` | POST | `LEGACY_BASELINE` | [src/app/api/financial/cash-deposits/[batchId]/refresh/route.ts](../../src/app/api/financial/cash-deposits/[batchId]/refresh/route.ts) |
| `/api/financial/cash-deposits/adjustments/allocate` | POST | `LEGACY_BASELINE` | [src/app/api/financial/cash-deposits/adjustments/allocate/route.ts](../../src/app/api/financial/cash-deposits/adjustments/allocate/route.ts) |
| `/api/financial/cash-deposits/coins/exchange` | POST | `LEGACY_BASELINE` | [src/app/api/financial/cash-deposits/coins/exchange/route.ts](../../src/app/api/financial/cash-deposits/coins/exchange/route.ts) |
| `/api/financial/cash-deposits/inter/webhook` | GET, POST | `LEGACY_BASELINE` | [src/app/api/financial/cash-deposits/inter/webhook/route.ts](../../src/app/api/financial/cash-deposits/inter/webhook/route.ts) |
| `/api/financial/cash-deposits/reports` | GET | `LEGACY_BASELINE` | [src/app/api/financial/cash-deposits/reports/route.ts](../../src/app/api/financial/cash-deposits/reports/route.ts) |
| `/api/financial/cash-deposits/reports/export` | GET | `LEGACY_BASELINE` | [src/app/api/financial/cash-deposits/reports/export/route.ts](../../src/app/api/financial/cash-deposits/reports/export/route.ts) |
| `/api/financial/data` | GET | `LEGACY_BASELINE` | [src/app/api/financial/data/route.ts](../../src/app/api/financial/data/route.ts) |
| `/api/financial/dre/cmv-closure` | POST | `LEGACY_BASELINE` | [src/app/api/financial/dre/cmv-closure/route.ts](../../src/app/api/financial/dre/cmv-closure/route.ts) |
| `/api/financial/dre/source-data` | GET | `LEGACY_BASELINE` | [src/app/api/financial/dre/source-data/route.ts](../../src/app/api/financial/dre/source-data/route.ts) |
| `/api/financial/dre/stock-cmv` | GET | `LEGACY_BASELINE` | [src/app/api/financial/dre/stock-cmv/route.ts](../../src/app/api/financial/dre/stock-cmv/route.ts) |
| `/api/financial/expenses/[expenseId]/adjustments/[adjustmentId]` | PATCH | `LEGACY_BASELINE` | [src/app/api/financial/expenses/[expenseId]/adjustments/[adjustmentId]/route.ts](../../src/app/api/financial/expenses/[expenseId]/adjustments/[adjustmentId]/route.ts) |
| `/api/financial/expenses/[expenseId]/boleto` | GET, POST | `LEGACY_BASELINE` | [src/app/api/financial/expenses/[expenseId]/boleto/route.ts](../../src/app/api/financial/expenses/[expenseId]/boleto/route.ts) |
| `/api/financial/expenses/[expenseId]/boleto/payment` | POST | `LEGACY_BASELINE` | [src/app/api/financial/expenses/[expenseId]/boleto/payment/route.ts](../../src/app/api/financial/expenses/[expenseId]/boleto/payment/route.ts) |
| `/api/financial/expenses/[expenseId]/payments` | POST | `LEGACY_BASELINE` | [src/app/api/financial/expenses/[expenseId]/payments/route.ts](../../src/app/api/financial/expenses/[expenseId]/payments/route.ts) |
| `/api/financial/expenses/[expenseId]/reconcile-provision` | POST | `LEGACY_BASELINE` | [src/app/api/financial/expenses/[expenseId]/reconcile-provision/route.ts](../../src/app/api/financial/expenses/[expenseId]/reconcile-provision/route.ts) |
| `/api/financial/expenses/[expenseId]/settlement` | GET | `LEGACY_BASELINE` | [src/app/api/financial/expenses/[expenseId]/settlement/route.ts](../../src/app/api/financial/expenses/[expenseId]/settlement/route.ts) |
| `/api/financial/import-sessions/[sessionId]` | PATCH | `LEGACY_BASELINE` | [src/app/api/financial/import-sessions/[sessionId]/route.ts](../../src/app/api/financial/import-sessions/[sessionId]/route.ts) |
| `/api/financial/inbox` | GET | `LEGACY_BASELINE` | [src/app/api/financial/inbox/route.ts](../../src/app/api/financial/inbox/route.ts) |
| `/api/financial/inbox/[id]` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/financial/inbox/[id]/route.ts](../../src/app/api/financial/inbox/[id]/route.ts) |
| `/api/financial/inbox/[id]/analyze` | POST | `LEGACY_BASELINE` | [src/app/api/financial/inbox/[id]/analyze/route.ts](../../src/app/api/financial/inbox/[id]/analyze/route.ts) |
| `/api/financial/inbox/[id]/files/[fileId]` | GET | `LEGACY_BASELINE` | [src/app/api/financial/inbox/[id]/files/[fileId]/route.ts](../../src/app/api/financial/inbox/[id]/files/[fileId]/route.ts) |
| `/api/financial/inbox/[id]/link` | POST | `LEGACY_BASELINE` | [src/app/api/financial/inbox/[id]/link/route.ts](../../src/app/api/financial/inbox/[id]/link/route.ts) |
| `/api/financial/inbox/[id]/payment` | POST | `LEGACY_BASELINE` | [src/app/api/financial/inbox/[id]/payment/route.ts](../../src/app/api/financial/inbox/[id]/payment/route.ts) |
| `/api/financial/inbox/[id]/restore` | POST | `LEGACY_BASELINE` | [src/app/api/financial/inbox/[id]/restore/route.ts](../../src/app/api/financial/inbox/[id]/restore/route.ts) |
| `/api/financial/inbox/bulk-review` | POST | `LEGACY_BASELINE` | [src/app/api/financial/inbox/bulk-review/route.ts](../../src/app/api/financial/inbox/bulk-review/route.ts) |
| `/api/financial/inbox/mobile-upload` | POST ✓ | `CONTRACTED` | [src/app/api/financial/inbox/mobile-upload/route.ts](../../src/app/api/financial/inbox/mobile-upload/route.ts) |
| `/api/financial/inbox/settings` | GET, PUT | `LEGACY_BASELINE` | [src/app/api/financial/inbox/settings/route.ts](../../src/app/api/financial/inbox/settings/route.ts) |
| `/api/financial/management-analysis` | POST | `LEGACY_BASELINE` | [src/app/api/financial/management-analysis/route.ts](../../src/app/api/financial/management-analysis/route.ts) |
| `/api/financial/payment-requests` | GET, POST | `LEGACY_BASELINE` | [src/app/api/financial/payment-requests/route.ts](../../src/app/api/financial/payment-requests/route.ts) |
| `/api/financial/payment-requests/[id]/authorize` | POST | `LEGACY_BASELINE` | [src/app/api/financial/payment-requests/[id]/authorize/route.ts](../../src/app/api/financial/payment-requests/[id]/authorize/route.ts) |
| `/api/financial/payment-requests/[id]/proof` | GET | `LEGACY_BASELINE` | [src/app/api/financial/payment-requests/[id]/proof/route.ts](../../src/app/api/financial/payment-requests/[id]/proof/route.ts) |
| `/api/financial/payment-requests/[id]/refresh` | POST | `LEGACY_BASELINE` | [src/app/api/financial/payment-requests/[id]/refresh/route.ts](../../src/app/api/financial/payment-requests/[id]/refresh/route.ts) |
| `/api/financial/payment-requests/[id]/submit` | POST | `LEGACY_BASELINE` | [src/app/api/financial/payment-requests/[id]/submit/route.ts](../../src/app/api/financial/payment-requests/[id]/submit/route.ts) |
| `/api/financial/pdv-stone-review` | GET, POST | `LEGACY_BASELINE` | [src/app/api/financial/pdv-stone-review/route.ts](../../src/app/api/financial/pdv-stone-review/route.ts) |
| `/api/financial/stone-agenda` | GET | `LEGACY_BASELINE` | [src/app/api/financial/stone-agenda/route.ts](../../src/app/api/financial/stone-agenda/route.ts) |
| `/api/financial/stone-anticipations` | GET | `LEGACY_BASELINE` | [src/app/api/financial/stone-anticipations/route.ts](../../src/app/api/financial/stone-anticipations/route.ts) |
| `/api/financial/stone-future-receivables` | POST | `LEGACY_BASELINE` | [src/app/api/financial/stone-future-receivables/route.ts](../../src/app/api/financial/stone-future-receivables/route.ts) |
| `/api/financial/stone-mappings` | GET, POST | `LEGACY_BASELINE` | [src/app/api/financial/stone-mappings/route.ts](../../src/app/api/financial/stone-mappings/route.ts) |
| `/api/financial/stone-portfolio` | GET, POST | `LEGACY_BASELINE` | [src/app/api/financial/stone-portfolio/route.ts](../../src/app/api/financial/stone-portfolio/route.ts) |
| `/api/financial/stone-portfolio-cron` | POST | `LEGACY_BASELINE` | [src/app/api/financial/stone-portfolio-cron/route.ts](../../src/app/api/financial/stone-portfolio-cron/route.ts) |
| `/api/financial/stone-receipts/reconcile` | POST | `LEGACY_BASELINE` | [src/app/api/financial/stone-receipts/reconcile/route.ts](../../src/app/api/financial/stone-receipts/reconcile/route.ts) |
| `/api/financial/stone-wallet-position` | GET | `LEGACY_BASELINE` | [src/app/api/financial/stone-wallet-position/route.ts](../../src/app/api/financial/stone-wallet-position/route.ts) |
| `/api/forms/analytics/admin/aggregates/recompute` | POST | `LEGACY_BASELINE` | [src/app/api/forms/analytics/admin/aggregates/recompute/route.ts](../../src/app/api/forms/analytics/admin/aggregates/recompute/route.ts) |
| `/api/forms/analytics/admin/privacy/anonymize-due` | POST | `LEGACY_BASELINE` | [src/app/api/forms/analytics/admin/privacy/anonymize-due/route.ts](../../src/app/api/forms/analytics/admin/privacy/anonymize-due/route.ts) |
| `/api/forms/analytics/admin/privacy/backfill` | POST | `LEGACY_BASELINE` | [src/app/api/forms/analytics/admin/privacy/backfill/route.ts](../../src/app/api/forms/analytics/admin/privacy/backfill/route.ts) |
| `/api/forms/analytics/admin/reprocess/execute` | POST | `LEGACY_BASELINE` | [src/app/api/forms/analytics/admin/reprocess/execute/route.ts](../../src/app/api/forms/analytics/admin/reprocess/execute/route.ts) |
| `/api/forms/analytics/admin/reprocess/simulate` | POST | `LEGACY_BASELINE` | [src/app/api/forms/analytics/admin/reprocess/simulate/route.ts](../../src/app/api/forms/analytics/admin/reprocess/simulate/route.ts) |
| `/api/forms/analytics/criteria` | GET, POST | `LEGACY_BASELINE` | [src/app/api/forms/analytics/criteria/route.ts](../../src/app/api/forms/analytics/criteria/route.ts) |
| `/api/forms/analytics/criteria/[criterionId]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/forms/analytics/criteria/[criterionId]/route.ts](../../src/app/api/forms/analytics/criteria/[criterionId]/route.ts) |
| `/api/forms/analytics/domains` | GET, POST | `LEGACY_BASELINE` | [src/app/api/forms/analytics/domains/route.ts](../../src/app/api/forms/analytics/domains/route.ts) |
| `/api/forms/analytics/domains/[domainId]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/forms/analytics/domains/[domainId]/route.ts](../../src/app/api/forms/analytics/domains/[domainId]/route.ts) |
| `/api/forms/analytics/jobs/anonymize-due` | GET | `LEGACY_BASELINE` | [src/app/api/forms/analytics/jobs/anonymize-due/route.ts](../../src/app/api/forms/analytics/jobs/anonymize-due/route.ts) |
| `/api/forms/analytics/jobs/recompute-daily` | GET | `LEGACY_BASELINE` | [src/app/api/forms/analytics/jobs/recompute-daily/route.ts](../../src/app/api/forms/analytics/jobs/recompute-daily/route.ts) |
| `/api/forms/analytics/occurrences` | GET | `LEGACY_BASELINE` | [src/app/api/forms/analytics/occurrences/route.ts](../../src/app/api/forms/analytics/occurrences/route.ts) |
| `/api/forms/analytics/occurrences/[occurrenceId]` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/forms/analytics/occurrences/[occurrenceId]/route.ts](../../src/app/api/forms/analytics/occurrences/[occurrenceId]/route.ts) |
| `/api/forms/analytics/occurrences/[occurrenceId]/cancel` | POST | `LEGACY_BASELINE` | [src/app/api/forms/analytics/occurrences/[occurrenceId]/cancel/route.ts](../../src/app/api/forms/analytics/occurrences/[occurrenceId]/cancel/route.ts) |
| `/api/forms/analytics/occurrences/[occurrenceId]/reject-resolution` | POST | `LEGACY_BASELINE` | [src/app/api/forms/analytics/occurrences/[occurrenceId]/reject-resolution/route.ts](../../src/app/api/forms/analytics/occurrences/[occurrenceId]/reject-resolution/route.ts) |
| `/api/forms/analytics/occurrences/[occurrenceId]/resolve` | POST | `LEGACY_BASELINE` | [src/app/api/forms/analytics/occurrences/[occurrenceId]/resolve/route.ts](../../src/app/api/forms/analytics/occurrences/[occurrenceId]/resolve/route.ts) |
| `/api/forms/analytics/occurrences/[occurrenceId]/validate-resolution` | POST | `LEGACY_BASELINE` | [src/app/api/forms/analytics/occurrences/[occurrenceId]/validate-resolution/route.ts](../../src/app/api/forms/analytics/occurrences/[occurrenceId]/validate-resolution/route.ts) |
| `/api/forms/analytics/occurrences/export.csv` | GET | `LEGACY_BASELINE` | [src/app/api/forms/analytics/occurrences/export.csv/route.ts](../../src/app/api/forms/analytics/occurrences/export.csv/route.ts) |
| `/api/forms/analytics/results` | GET, POST | `LEGACY_BASELINE` | [src/app/api/forms/analytics/results/route.ts](../../src/app/api/forms/analytics/results/route.ts) |
| `/api/forms/analytics/results/[resultId]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/forms/analytics/results/[resultId]/route.ts](../../src/app/api/forms/analytics/results/[resultId]/route.ts) |
| `/api/forms/analytics/retention-policies` | GET, POST | `LEGACY_BASELINE` | [src/app/api/forms/analytics/retention-policies/route.ts](../../src/app/api/forms/analytics/retention-policies/route.ts) |
| `/api/forms/analytics/retention-policies/[policyId]` | PATCH | `LEGACY_BASELINE` | [src/app/api/forms/analytics/retention-policies/[policyId]/route.ts](../../src/app/api/forms/analytics/retention-policies/[policyId]/route.ts) |
| `/api/forms/analytics/seed` | POST | `LEGACY_BASELINE` | [src/app/api/forms/analytics/seed/route.ts](../../src/app/api/forms/analytics/seed/route.ts) |
| `/api/forms/analytics/summary` | GET | `LEGACY_BASELINE` | [src/app/api/forms/analytics/summary/route.ts](../../src/app/api/forms/analytics/summary/route.ts) |
| `/api/forms/analytics/targets` | GET, POST | `LEGACY_BASELINE` | [src/app/api/forms/analytics/targets/route.ts](../../src/app/api/forms/analytics/targets/route.ts) |
| `/api/forms/analytics/targets/[targetId]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/forms/analytics/targets/[targetId]/route.ts](../../src/app/api/forms/analytics/targets/[targetId]/route.ts) |
| `/api/forms/bootstrap` | GET | `LEGACY_BASELINE` | [src/app/api/forms/bootstrap/route.ts](../../src/app/api/forms/bootstrap/route.ts) |
| `/api/forms/events/trigger` | POST | `LEGACY_BASELINE` | [src/app/api/forms/events/trigger/route.ts](../../src/app/api/forms/events/trigger/route.ts) |
| `/api/forms/executions` | GET, POST | `LEGACY_BASELINE` | [src/app/api/forms/executions/route.ts](../../src/app/api/forms/executions/route.ts) |
| `/api/forms/executions/[executionId]` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/forms/executions/[executionId]/route.ts](../../src/app/api/forms/executions/[executionId]/route.ts) |
| `/api/forms/executions/[executionId]/claim` | POST | `LEGACY_BASELINE` | [src/app/api/forms/executions/[executionId]/claim/route.ts](../../src/app/api/forms/executions/[executionId]/claim/route.ts) |
| `/api/forms/models` | GET, POST | `LEGACY_BASELINE` | [src/app/api/forms/models/route.ts](../../src/app/api/forms/models/route.ts) |
| `/api/forms/models/[modelId]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/forms/models/[modelId]/route.ts](../../src/app/api/forms/models/[modelId]/route.ts) |
| `/api/forms/navigation` | GET | `LEGACY_BASELINE` | [src/app/api/forms/navigation/route.ts](../../src/app/api/forms/navigation/route.ts) |
| `/api/forms/projects` | GET, POST | `LEGACY_BASELINE` | [src/app/api/forms/projects/route.ts](../../src/app/api/forms/projects/route.ts) |
| `/api/forms/projects/[projectId]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/forms/projects/[projectId]/route.ts](../../src/app/api/forms/projects/[projectId]/route.ts) |
| `/api/forms/projects/ensure-units` | POST | `LEGACY_BASELINE` | [src/app/api/forms/projects/ensure-units/route.ts](../../src/app/api/forms/projects/ensure-units/route.ts) |
| `/api/forms/scheduler` | POST | `LEGACY_BASELINE` | [src/app/api/forms/scheduler/route.ts](../../src/app/api/forms/scheduler/route.ts) |
| `/api/forms/subtypes` | GET, POST | `LEGACY_BASELINE` | [src/app/api/forms/subtypes/route.ts](../../src/app/api/forms/subtypes/route.ts) |
| `/api/forms/subtypes/[subtypeId]` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/forms/subtypes/[subtypeId]/route.ts](../../src/app/api/forms/subtypes/[subtypeId]/route.ts) |
| `/api/forms/templates` | GET, POST | `LEGACY_BASELINE` | [src/app/api/forms/templates/route.ts](../../src/app/api/forms/templates/route.ts) |
| `/api/forms/templates/[templateId]` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/forms/templates/[templateId]/route.ts](../../src/app/api/forms/templates/[templateId]/route.ts) |
| `/api/forms/templates/[templateId]/application` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/forms/templates/[templateId]/application/route.ts](../../src/app/api/forms/templates/[templateId]/application/route.ts) |
| `/api/forms/types` | GET, POST | `LEGACY_BASELINE` | [src/app/api/forms/types/route.ts](../../src/app/api/forms/types/route.ts) |
| `/api/forms/types/[typeId]` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/forms/types/[typeId]/route.ts](../../src/app/api/forms/types/[typeId]/route.ts) |
| `/api/forms/upload` | PATCH, POST | `LEGACY_BASELINE` | [src/app/api/forms/upload/route.ts](../../src/app/api/forms/upload/route.ts) |
| `/api/goals/mobile` | GET ✓ | `CONTRACTED` | [src/app/api/goals/mobile/route.ts](../../src/app/api/goals/mobile/route.ts) |
| `/api/hr/accountant/[token]` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/accountant/[token]/route.ts](../../src/app/api/hr/accountant/[token]/route.ts) |
| `/api/hr/apply` | POST | `LEGACY_BASELINE` | [src/app/api/hr/apply/route.ts](../../src/app/api/hr/apply/route.ts) |
| `/api/hr/aso-clinics` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/aso-clinics/route.ts](../../src/app/api/hr/aso-clinics/route.ts) |
| `/api/hr/aso/candidate/[token]` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/aso/candidate/[token]/route.ts](../../src/app/api/hr/aso/candidate/[token]/route.ts) |
| `/api/hr/aso/clinic/[token]` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/aso/clinic/[token]/route.ts](../../src/app/api/hr/aso/clinic/[token]/route.ts) |
| `/api/hr/bootstrap` | GET | `LEGACY_BASELINE` | [src/app/api/hr/bootstrap/route.ts](../../src/app/api/hr/bootstrap/route.ts) |
| `/api/hr/candidates` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/candidates/route.ts](../../src/app/api/hr/candidates/route.ts) |
| `/api/hr/candidates/[id]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/hr/candidates/[id]/route.ts](../../src/app/api/hr/candidates/[id]/route.ts) |
| `/api/hr/candidates/[id]/profile` | GET | `LEGACY_BASELINE` | [src/app/api/hr/candidates/[id]/profile/route.ts](../../src/app/api/hr/candidates/[id]/profile/route.ts) |
| `/api/hr/collaborators/[userId]/pdv-access` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/hr/collaborators/[userId]/pdv-access/route.ts](../../src/app/api/hr/collaborators/[userId]/pdv-access/route.ts) |
| `/api/hr/consents/image-voice/[employeeId]` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/consents/image-voice/[employeeId]/route.ts](../../src/app/api/hr/consents/image-voice/[employeeId]/route.ts) |
| `/api/hr/departments` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/departments/route.ts](../../src/app/api/hr/departments/route.ts) |
| `/api/hr/departments/[departmentId]` | PATCH | `LEGACY_BASELINE` | [src/app/api/hr/departments/[departmentId]/route.ts](../../src/app/api/hr/departments/[departmentId]/route.ts) |
| `/api/hr/employee-documents` | DELETE, GET, PATCH, POST | `LEGACY_BASELINE` | [src/app/api/hr/employee-documents/route.ts](../../src/app/api/hr/employee-documents/route.ts) |
| `/api/hr/employee-documents/access` | POST | `LEGACY_BASELINE` | [src/app/api/hr/employee-documents/access/route.ts](../../src/app/api/hr/employee-documents/access/route.ts) |
| `/api/hr/employee-documents/analyze-upload` | POST | `LEGACY_BASELINE` | [src/app/api/hr/employee-documents/analyze-upload/route.ts](../../src/app/api/hr/employee-documents/analyze-upload/route.ts) |
| `/api/hr/employee-documents/batches` | GET | `LEGACY_BASELINE` | [src/app/api/hr/employee-documents/batches/route.ts](../../src/app/api/hr/employee-documents/batches/route.ts) |
| `/api/hr/employee-documents/cleanup` | POST | `LEGACY_BASELINE` | [src/app/api/hr/employee-documents/cleanup/route.ts](../../src/app/api/hr/employee-documents/cleanup/route.ts) |
| `/api/hr/employee-documents/confirm` | POST | `LEGACY_BASELINE` | [src/app/api/hr/employee-documents/confirm/route.ts](../../src/app/api/hr/employee-documents/confirm/route.ts) |
| `/api/hr/employee-documents/item` | PATCH | `LEGACY_BASELINE` | [src/app/api/hr/employee-documents/item/route.ts](../../src/app/api/hr/employee-documents/item/route.ts) |
| `/api/hr/employee-documents/reanalyze` | POST | `LEGACY_BASELINE` | [src/app/api/hr/employee-documents/reanalyze/route.ts](../../src/app/api/hr/employee-documents/reanalyze/route.ts) |
| `/api/hr/employee-documents/summary` | GET | `LEGACY_BASELINE` | [src/app/api/hr/employee-documents/summary/route.ts](../../src/app/api/hr/employee-documents/summary/route.ts) |
| `/api/hr/employee-documents/visibility` | GET, PUT | `LEGACY_BASELINE` | [src/app/api/hr/employee-documents/visibility/route.ts](../../src/app/api/hr/employee-documents/visibility/route.ts) |
| `/api/hr/functions` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/functions/route.ts](../../src/app/api/hr/functions/route.ts) |
| `/api/hr/functions/[functionId]` | PATCH | `LEGACY_BASELINE` | [src/app/api/hr/functions/[functionId]/route.ts](../../src/app/api/hr/functions/[functionId]/route.ts) |
| `/api/hr/integration-templates` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/integration-templates/route.ts](../../src/app/api/hr/integration-templates/route.ts) |
| `/api/hr/integration-templates/[templateId]` | DELETE, GET, PATCH | `LEGACY_BASELINE` | [src/app/api/hr/integration-templates/[templateId]/route.ts](../../src/app/api/hr/integration-templates/[templateId]/route.ts) |
| `/api/hr/integration-templates/[templateId]/publish` | POST | `LEGACY_BASELINE` | [src/app/api/hr/integration-templates/[templateId]/publish/route.ts](../../src/app/api/hr/integration-templates/[templateId]/publish/route.ts) |
| `/api/hr/integration-templates/[templateId]/versions/[version]` | GET | `LEGACY_BASELINE` | [src/app/api/hr/integration-templates/[templateId]/versions/[version]/route.ts](../../src/app/api/hr/integration-templates/[templateId]/versions/[version]/route.ts) |
| `/api/hr/integrations/pdvlegal/catalog` | GET | `LEGACY_BASELINE` | [src/app/api/hr/integrations/pdvlegal/catalog/route.ts](../../src/app/api/hr/integrations/pdvlegal/catalog/route.ts) |
| `/api/hr/login-access` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/login-access/route.ts](../../src/app/api/hr/login-access/route.ts) |
| `/api/hr/login-access/audit` | GET | `LEGACY_BASELINE` | [src/app/api/hr/login-access/audit/route.ts](../../src/app/api/hr/login-access/audit/route.ts) |
| `/api/hr/navigation` | GET | `LEGACY_BASELINE` | [src/app/api/hr/navigation/route.ts](../../src/app/api/hr/navigation/route.ts) |
| `/api/hr/onboarding` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/onboarding/route.ts](../../src/app/api/hr/onboarding/route.ts) |
| `/api/hr/onboarding/[id]` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/hr/onboarding/[id]/route.ts](../../src/app/api/hr/onboarding/[id]/route.ts) |
| `/api/hr/onboarding/[id]/accountant-form` | POST | `LEGACY_BASELINE` | [src/app/api/hr/onboarding/[id]/accountant-form/route.tsx](../../src/app/api/hr/onboarding/[id]/accountant-form/route.tsx) |
| `/api/hr/onboarding/[id]/accountant-workflow` | GET, PATCH, POST | `LEGACY_BASELINE` | [src/app/api/hr/onboarding/[id]/accountant-workflow/route.ts](../../src/app/api/hr/onboarding/[id]/accountant-workflow/route.ts) |
| `/api/hr/onboarding/[id]/aso-guide` | POST | `LEGACY_BASELINE` | [src/app/api/hr/onboarding/[id]/aso-guide/route.tsx](../../src/app/api/hr/onboarding/[id]/aso-guide/route.tsx) |
| `/api/hr/onboarding/[id]/aso-workflow` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/hr/onboarding/[id]/aso-workflow/route.ts](../../src/app/api/hr/onboarding/[id]/aso-workflow/route.ts) |
| `/api/hr/onboarding/[id]/integration` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/hr/onboarding/[id]/integration/route.ts](../../src/app/api/hr/onboarding/[id]/integration/route.ts) |
| `/api/hr/onboarding/[id]/pj-workflow` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/hr/onboarding/[id]/pj-workflow/route.ts](../../src/app/api/hr/onboarding/[id]/pj-workflow/route.ts) |
| `/api/hr/onboarding/[id]/probation` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/hr/onboarding/[id]/probation/route.ts](../../src/app/api/hr/onboarding/[id]/probation/route.ts) |
| `/api/hr/onboarding/[id]/signature-documents` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/onboarding/[id]/signature-documents/route.ts](../../src/app/api/hr/onboarding/[id]/signature-documents/route.ts) |
| `/api/hr/onboarding/[id]/training` | PATCH | `LEGACY_BASELINE` | [src/app/api/hr/onboarding/[id]/training/route.ts](../../src/app/api/hr/onboarding/[id]/training/route.ts) |
| `/api/hr/onboarding/access-catalog` | GET | `LEGACY_BASELINE` | [src/app/api/hr/onboarding/access-catalog/route.ts](../../src/app/api/hr/onboarding/access-catalog/route.ts) |
| `/api/hr/onboarding/public/[token]` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/onboarding/public/[token]/route.ts](../../src/app/api/hr/onboarding/public/[token]/route.ts) |
| `/api/hr/openings` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/openings/route.ts](../../src/app/api/hr/openings/route.ts) |
| `/api/hr/openings/[id]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/hr/openings/[id]/route.ts](../../src/app/api/hr/openings/[id]/route.ts) |
| `/api/hr/openings/public` | GET | `LEGACY_BASELINE` | [src/app/api/hr/openings/public/route.ts](../../src/app/api/hr/openings/public/route.ts) |
| `/api/hr/probation/alerts` | POST | `LEGACY_BASELINE` | [src/app/api/hr/probation/alerts/route.ts](../../src/app/api/hr/probation/alerts/route.ts) |
| `/api/hr/public-stats` | GET | `LEGACY_BASELINE` | [src/app/api/hr/public-stats/route.ts](../../src/app/api/hr/public-stats/route.ts) |
| `/api/hr/recruitment/forms/talent-pool` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/hr/recruitment/forms/talent-pool/route.ts](../../src/app/api/hr/recruitment/forms/talent-pool/route.ts) |
| `/api/hr/recruitment/forms/talent-pool/public` | GET | `LEGACY_BASELINE` | [src/app/api/hr/recruitment/forms/talent-pool/public/route.ts](../../src/app/api/hr/recruitment/forms/talent-pool/public/route.ts) |
| `/api/hr/roles` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/roles/route.ts](../../src/app/api/hr/roles/route.ts) |
| `/api/hr/roles/[roleId]` | PATCH | `LEGACY_BASELINE` | [src/app/api/hr/roles/[roleId]/route.ts](../../src/app/api/hr/roles/[roleId]/route.ts) |
| `/api/hr/roles/[roleId]/sync-profile` | POST | `LEGACY_BASELINE` | [src/app/api/hr/roles/[roleId]/sync-profile/route.ts](../../src/app/api/hr/roles/[roleId]/sync-profile/route.ts) |
| `/api/hr/talent` | POST | `LEGACY_BASELINE` | [src/app/api/hr/talent/route.ts](../../src/app/api/hr/talent/route.ts) |
| `/api/hr/termination-accountant/[token]` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/termination-accountant/[token]/route.ts](../../src/app/api/hr/termination-accountant/[token]/route.ts) |
| `/api/hr/termination-documents/[token]` | GET | `LEGACY_BASELINE` | [src/app/api/hr/termination-documents/[token]/route.ts](../../src/app/api/hr/termination-documents/[token]/route.ts) |
| `/api/hr/terminations` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/terminations/route.ts](../../src/app/api/hr/terminations/route.ts) |
| `/api/hr/terminations/[id]` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/hr/terminations/[id]/route.ts](../../src/app/api/hr/terminations/[id]/route.ts) |
| `/api/hr/terminations/[id]/asset` | GET | `LEGACY_BASELINE` | [src/app/api/hr/terminations/[id]/asset/route.ts](../../src/app/api/hr/terminations/[id]/asset/route.ts) |
| `/api/hr/terminations/[id]/letter` | POST | `LEGACY_BASELINE` | [src/app/api/hr/terminations/[id]/letter/route.ts](../../src/app/api/hr/terminations/[id]/letter/route.ts) |
| `/api/hr/upload` | POST | `LEGACY_BASELINE` | [src/app/api/hr/upload/route.ts](../../src/app/api/hr/upload/route.ts) |
| `/api/hr/vacation-accountant/[token]` | GET, POST | `LEGACY_BASELINE` | [src/app/api/hr/vacation-accountant/[token]/route.ts](../../src/app/api/hr/vacation-accountant/[token]/route.ts) |
| `/api/integrations/bizneo/push-schedule` | POST | `LEGACY_BASELINE` | [src/app/api/integrations/bizneo/push-schedule/route.ts](../../src/app/api/integrations/bizneo/push-schedule/route.ts) |
| `/api/integrations/bizneo/shift-templates` | GET | `LEGACY_BASELINE` | [src/app/api/integrations/bizneo/shift-templates/route.ts](../../src/app/api/integrations/bizneo/shift-templates/route.ts) |
| `/api/integrations/bizneo/sync-taxons` | GET | `LEGACY_BASELINE` | [src/app/api/integrations/bizneo/sync-taxons/route.ts](../../src/app/api/integrations/bizneo/sync-taxons/route.ts) |
| `/api/integrations/bizneo/sync-users` | GET | `LEGACY_BASELINE` | [src/app/api/integrations/bizneo/sync-users/route.ts](../../src/app/api/integrations/bizneo/sync-users/route.ts) |
| `/api/integrations/instagram/feed` | GET | `LEGACY_BASELINE` | [src/app/api/integrations/instagram/feed/route.ts](../../src/app/api/integrations/instagram/feed/route.ts) |
| `/api/integrations/instagram/insights` | GET | `LEGACY_BASELINE` | [src/app/api/integrations/instagram/insights/route.ts](../../src/app/api/integrations/instagram/insights/route.ts) |
| `/api/integrations/instagram/media` | GET, POST | `LEGACY_BASELINE` | [src/app/api/integrations/instagram/media/route.ts](../../src/app/api/integrations/instagram/media/route.ts) |
| `/api/integrations/instagram/media/[id]` | GET | `LEGACY_BASELINE` | [src/app/api/integrations/instagram/media/[id]/route.ts](../../src/app/api/integrations/instagram/media/[id]/route.ts) |
| `/api/integrations/instagram/media/folders` | GET, POST | `LEGACY_BASELINE` | [src/app/api/integrations/instagram/media/folders/route.ts](../../src/app/api/integrations/instagram/media/folders/route.ts) |
| `/api/integrations/instagram/media/folders/[id]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/integrations/instagram/media/folders/[id]/route.ts](../../src/app/api/integrations/instagram/media/folders/[id]/route.ts) |
| `/api/integrations/instagram/media/move` | POST | `LEGACY_BASELINE` | [src/app/api/integrations/instagram/media/move/route.ts](../../src/app/api/integrations/instagram/media/move/route.ts) |
| `/api/integrations/instagram/posts` | GET, POST | `LEGACY_BASELINE` | [src/app/api/integrations/instagram/posts/route.ts](../../src/app/api/integrations/instagram/posts/route.ts) |
| `/api/integrations/instagram/posts/[id]` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/integrations/instagram/posts/[id]/route.ts](../../src/app/api/integrations/instagram/posts/[id]/route.ts) |
| `/api/integrations/instagram/posts/[id]/actions` | POST | `LEGACY_BASELINE` | [src/app/api/integrations/instagram/posts/[id]/actions/route.ts](../../src/app/api/integrations/instagram/posts/[id]/actions/route.ts) |
| `/api/integrations/instagram/posts/[id]/media` | POST | `LEGACY_BASELINE` | [src/app/api/integrations/instagram/posts/[id]/media/route.ts](../../src/app/api/integrations/instagram/posts/[id]/media/route.ts) |
| `/api/integrations/instagram/posts/[id]/media/[mediaId]` | GET | `LEGACY_BASELINE` | [src/app/api/integrations/instagram/posts/[id]/media/[mediaId]/route.ts](../../src/app/api/integrations/instagram/posts/[id]/media/[mediaId]/route.ts) |
| `/api/integrations/instagram/schedule` | GET, POST | `LEGACY_BASELINE` | [src/app/api/integrations/instagram/schedule/route.ts](../../src/app/api/integrations/instagram/schedule/route.ts) |
| `/api/integrations/instagram/schedule/[id]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/integrations/instagram/schedule/[id]/route.ts](../../src/app/api/integrations/instagram/schedule/[id]/route.ts) |
| `/api/integrations/instagram/schedule/[id]/media/[index]` | GET | `LEGACY_BASELINE` | [src/app/api/integrations/instagram/schedule/[id]/media/[index]/route.ts](../../src/app/api/integrations/instagram/schedule/[id]/media/[index]/route.ts) |
| `/api/integrations/marketing/products` | GET | `LEGACY_BASELINE` | [src/app/api/integrations/marketing/products/route.ts](../../src/app/api/integrations/marketing/products/route.ts) |
| `/api/integrations/pdvlegal/filiais` | GET | `LEGACY_BASELINE` | [src/app/api/integrations/pdvlegal/filiais/route.ts](../../src/app/api/integrations/pdvlegal/filiais/route.ts) |
| `/api/integrations/pdvlegal/inspect` | GET | `LEGACY_BASELINE` | [src/app/api/integrations/pdvlegal/inspect/route.ts](../../src/app/api/integrations/pdvlegal/inspect/route.ts) |
| `/api/integrations/pdvlegal/sync` | GET | `LEGACY_BASELINE` | [src/app/api/integrations/pdvlegal/sync/route.ts](../../src/app/api/integrations/pdvlegal/sync/route.ts) |
| `/api/jobs/cash-closures/daily-sync` | POST | `LEGACY_BASELINE` | [src/app/api/jobs/cash-closures/daily-sync/route.ts](../../src/app/api/jobs/cash-closures/daily-sync/route.ts) |
| `/api/jobs/cash-deposits/reconcile` | POST | `LEGACY_BASELINE` | [src/app/api/jobs/cash-deposits/reconcile/route.ts](../../src/app/api/jobs/cash-deposits/reconcile/route.ts) |
| `/api/jobs/documents/retention-reconcile` | POST | `LEGACY_BASELINE` | [src/app/api/jobs/documents/retention-reconcile/route.ts](../../src/app/api/jobs/documents/retention-reconcile/route.ts) |
| `/api/jobs/financial-budgets/generate` | POST | `LEGACY_BASELINE` | [src/app/api/jobs/financial-budgets/generate/route.ts](../../src/app/api/jobs/financial-budgets/generate/route.ts) |
| `/api/jobs/financial-inbox/maintenance` | POST | `LEGACY_BASELINE` | [src/app/api/jobs/financial-inbox/maintenance/route.ts](../../src/app/api/jobs/financial-inbox/maintenance/route.ts) |
| `/api/jobs/inter/cobrancas/reconcile` | POST | `LEGACY_BASELINE` | [src/app/api/jobs/inter/cobrancas/reconcile/route.ts](../../src/app/api/jobs/inter/cobrancas/reconcile/route.ts) |
| `/api/jobs/inter/reconcile` | POST | `LEGACY_BASELINE` | [src/app/api/jobs/inter/reconcile/route.ts](../../src/app/api/jobs/inter/reconcile/route.ts) |
| `/api/jobs/inter/statements/sync` | POST | `LEGACY_BASELINE` | [src/app/api/jobs/inter/statements/sync/route.ts](../../src/app/api/jobs/inter/statements/sync/route.ts) |
| `/api/jobs/stone-pix/request` | POST | `LEGACY_BASELINE` | [src/app/api/jobs/stone-pix/request/route.ts](../../src/app/api/jobs/stone-pix/request/route.ts) |
| `/api/jobs/stone-sales-review/reconcile` | POST | `LEGACY_BASELINE` | [src/app/api/jobs/stone-sales-review/reconcile/route.ts](../../src/app/api/jobs/stone-sales-review/reconcile/route.ts) |
| `/api/mercadorias` | GET | `LEGACY_BASELINE` | [src/app/api/mercadorias/route.ts](../../src/app/api/mercadorias/route.ts) |
| `/api/mercadorias/export` | GET | `LEGACY_BASELINE` | [src/app/api/mercadorias/export/route.ts](../../src/app/api/mercadorias/export/route.ts) |
| `/api/mobile/app-attestation` | POST ✓ | `CONTRACTED` | [src/app/api/mobile/app-attestation/route.ts](../../src/app/api/mobile/app-attestation/route.ts) |
| `/api/mobile/profile` | GET ✓ | `CONTRACTED` | [src/app/api/mobile/profile/route.ts](../../src/app/api/mobile/profile/route.ts) |
| `/api/mobile/profile/photo` | POST ✓ | `CONTRACTED` | [src/app/api/mobile/profile/photo/route.ts](../../src/app/api/mobile/profile/photo/route.ts) |
| `/api/observability/client-errors` | POST | `LEGACY_BASELINE` | [src/app/api/observability/client-errors/route.ts](../../src/app/api/observability/client-errors/route.ts) |
| `/api/privacy/incidents` | GET, POST | `LEGACY_BASELINE` | [src/app/api/privacy/incidents/route.ts](../../src/app/api/privacy/incidents/route.ts) |
| `/api/privacy/incidents/[id]` | PATCH | `LEGACY_BASELINE` | [src/app/api/privacy/incidents/[id]/route.ts](../../src/app/api/privacy/incidents/[id]/route.ts) |
| `/api/privacy/requests` | GET, POST | `LEGACY_BASELINE` | [src/app/api/privacy/requests/route.ts](../../src/app/api/privacy/requests/route.ts) |
| `/api/privacy/requests/[id]` | PATCH | `LEGACY_BASELINE` | [src/app/api/privacy/requests/[id]/route.ts](../../src/app/api/privacy/requests/[id]/route.ts) |
| `/api/processes` | GET | `LEGACY_BASELINE` | [src/app/api/processes/route.ts](../../src/app/api/processes/route.ts) |
| `/api/products` | POST | `LEGACY_BASELINE` | [src/app/api/products/route.ts](../../src/app/api/products/route.ts) |
| `/api/products/[id]` | PUT | `LEGACY_BASELINE` | [src/app/api/products/[id]/route.ts](../../src/app/api/products/[id]/route.ts) |
| `/api/products/barcode/[codigo]` | GET | `LEGACY_BASELINE` | [src/app/api/products/barcode/[codigo]/route.ts](../../src/app/api/products/barcode/[codigo]/route.ts) |
| `/api/products/barcode/[codigo]/sources` | GET | `LEGACY_BASELINE` | [src/app/api/products/barcode/[codigo]/sources/route.ts](../../src/app/api/products/barcode/[codigo]/sources/route.ts) |
| `/api/profile-compliance` | GET, POST | `LEGACY_BASELINE` | [src/app/api/profile-compliance/route.ts](../../src/app/api/profile-compliance/route.ts) |
| `/api/profile-compliance/overview` | GET | `LEGACY_BASELINE` | [src/app/api/profile-compliance/overview/route.ts](../../src/app/api/profile-compliance/overview/route.ts) |
| `/api/public/bio` | GET | `LEGACY_BASELINE` | [src/app/api/public/bio/route.ts](../../src/app/api/public/bio/route.ts) |
| `/api/public/bio/analytics` | POST | `LEGACY_BASELINE` | [src/app/api/public/bio/analytics/route.ts](../../src/app/api/public/bio/analytics/route.ts) |
| `/api/public/bio/media/[id]` | GET | `LEGACY_BASELINE` | [src/app/api/public/bio/media/[id]/route.ts](../../src/app/api/public/bio/media/[id]/route.ts) |
| `/api/purchasing/[...path]` | DELETE, GET, PATCH, POST | `LEGACY_BASELINE` | [src/app/api/purchasing/[...path]/route.ts](../../src/app/api/purchasing/[...path]/route.ts) |
| `/api/purchasing/local-purchases/confirm` | POST ✓ | `CONTRACTED` | [src/app/api/purchasing/local-purchases/confirm/route.ts](../../src/app/api/purchasing/local-purchases/confirm/route.ts) |
| `/api/purchasing/local-purchases/context` | GET ✓ | `CONTRACTED` | [src/app/api/purchasing/local-purchases/context/route.ts](../../src/app/api/purchasing/local-purchases/context/route.ts) |
| `/api/purchasing/local-purchases/link-withdrawal` | POST ✓ | `CONTRACTED` | [src/app/api/purchasing/local-purchases/link-withdrawal/route.ts](../../src/app/api/purchasing/local-purchases/link-withdrawal/route.ts) |
| `/api/purchasing/local-purchases/list` | GET ✓ | `CONTRACTED` | [src/app/api/purchasing/local-purchases/list/route.ts](../../src/app/api/purchasing/local-purchases/list/route.ts) |
| `/api/purchasing/local-purchases/reverse` | POST ✓ | `CONTRACTED` | [src/app/api/purchasing/local-purchases/reverse/route.ts](../../src/app/api/purchasing/local-purchases/reverse/route.ts) |
| `/api/purchasing/local-purchases/withdrawals` | GET ✓ | `CONTRACTED` | [src/app/api/purchasing/local-purchases/withdrawals/route.ts](../../src/app/api/purchasing/local-purchases/withdrawals/route.ts) |
| `/api/purchasing/pending-by-destination` | GET | `LEGACY_BASELINE` | [src/app/api/purchasing/pending-by-destination/route.ts](../../src/app/api/purchasing/pending-by-destination/route.ts) |
| `/api/purchasing/pending-by-destination/ignore` | POST | `LEGACY_BASELINE` | [src/app/api/purchasing/pending-by-destination/ignore/route.ts](../../src/app/api/purchasing/pending-by-destination/ignore/route.ts) |
| `/api/registry/[...path]` | DELETE, GET, PATCH, POST | `LEGACY_BASELINE` | [src/app/api/registry/[...path]/route.ts](../../src/app/api/registry/[...path]/route.ts) |
| `/api/registry/cnpj/[cnpj]` | GET | `LEGACY_BASELINE` | [src/app/api/registry/cnpj/[cnpj]/route.ts](../../src/app/api/registry/cnpj/[cnpj]/route.ts) |
| `/api/rh/employee-profile/[employeeId]` | GET | `LEGACY_BASELINE` | [src/app/api/rh/employee-profile/[employeeId]/route.ts](../../src/app/api/rh/employee-profile/[employeeId]/route.ts) |
| `/api/rh/employee-profile/[employeeId]/image-voice-consent` | POST | `LEGACY_BASELINE` | [src/app/api/rh/employee-profile/[employeeId]/image-voice-consent/route.ts](../../src/app/api/rh/employee-profile/[employeeId]/image-voice-consent/route.ts) |
| `/api/rh/field-map` | GET, PUT | `LEGACY_BASELINE` | [src/app/api/rh/field-map/route.ts](../../src/app/api/rh/field-map/route.ts) |
| `/api/settings/ai-management` | GET ✓ | `CONTRACTED` | [src/app/api/settings/ai-management/route.ts](../../src/app/api/settings/ai-management/route.ts) |
| `/api/settings/public-bio` | GET, PUT | `LEGACY_BASELINE` | [src/app/api/settings/public-bio/route.ts](../../src/app/api/settings/public-bio/route.ts) |
| `/api/settings/public-bio/media` | POST | `LEGACY_BASELINE` | [src/app/api/settings/public-bio/media/route.ts](../../src/app/api/settings/public-bio/media/route.ts) |
| `/api/settings/public-bio/media/[id]` | GET | `LEGACY_BASELINE` | [src/app/api/settings/public-bio/media/[id]/route.ts](../../src/app/api/settings/public-bio/media/[id]/route.ts) |
| `/api/signage/app/downloads` | POST ✓ | `CONTRACTED` | [src/app/api/signage/app/downloads/route.ts](../../src/app/api/signage/app/downloads/route.ts) |
| `/api/signage/asset/[...assetPath]` | GET | `LEGACY_BASELINE` | [src/app/api/signage/asset/[...assetPath]/route.ts](../../src/app/api/signage/asset/[...assetPath]/route.ts) |
| `/api/signage/heartbeat` | GET ✓, POST ✓ | `CONTRACTED` | [src/app/api/signage/heartbeat/route.ts](../../src/app/api/signage/heartbeat/route.ts) |
| `/api/signage/media` | GET ✓, POST ✓ | `CONTRACTED` | [src/app/api/signage/media/route.ts](../../src/app/api/signage/media/route.ts) |
| `/api/signage/media/[mediaId]` | DELETE ✓, PATCH ✓ | `CONTRACTED` | [src/app/api/signage/media/[mediaId]/route.ts](../../src/app/api/signage/media/[mediaId]/route.ts) |
| `/api/signage/media/folders` | POST ✓ | `CONTRACTED` | [src/app/api/signage/media/folders/route.ts](../../src/app/api/signage/media/folders/route.ts) |
| `/api/signage/media/folders/[folderId]` | DELETE ✓, PATCH ✓ | `CONTRACTED` | [src/app/api/signage/media/folders/[folderId]/route.ts](../../src/app/api/signage/media/folders/[folderId]/route.ts) |
| `/api/signage/media/import` | POST ✓ | `CONTRACTED` | [src/app/api/signage/media/import/route.ts](../../src/app/api/signage/media/import/route.ts) |
| `/api/signage/mobile` | GET ✓ | `CONTRACTED` | [src/app/api/signage/mobile/route.ts](../../src/app/api/signage/mobile/route.ts) |
| `/api/signage/mobile/screens` | POST ✓ | `CONTRACTED` | [src/app/api/signage/mobile/screens/route.ts](../../src/app/api/signage/mobile/screens/route.ts) |
| `/api/signage/pair` | POST ✓ | `CONTRACTED` | [src/app/api/signage/pair/route.ts](../../src/app/api/signage/pair/route.ts) |
| `/api/signage/pair/qr` | GET ✓ | `CONTRACTED` | [src/app/api/signage/pair/qr/route.ts](../../src/app/api/signage/pair/qr/route.ts) |
| `/api/signage/public/[kioskId]` | GET ✓ | `CONTRACTED` | [src/app/api/signage/public/[kioskId]/route.ts](../../src/app/api/signage/public/[kioskId]/route.ts) |
| `/api/signage/publish` | POST ✓ | `CONTRACTED` | [src/app/api/signage/publish/route.ts](../../src/app/api/signage/publish/route.ts) |
| `/api/signage/screens` | GET ✓, POST ✓ | `CONTRACTED` | [src/app/api/signage/screens/route.ts](../../src/app/api/signage/screens/route.ts) |
| `/api/signage/screens/[screenId]` | DELETE ✓, PATCH ✓ | `CONTRACTED` | [src/app/api/signage/screens/[screenId]/route.ts](../../src/app/api/signage/screens/[screenId]/route.ts) |
| `/api/signage/slides` | GET ✓, POST ✓ | `CONTRACTED` | [src/app/api/signage/slides/route.ts](../../src/app/api/signage/slides/route.ts) |
| `/api/signage/slides/[slideId]` | DELETE ✓, PUT ✓ | `CONTRACTED` | [src/app/api/signage/slides/[slideId]/route.ts](../../src/app/api/signage/slides/[slideId]/route.ts) |
| `/api/signage/upload` | POST | `LEGACY_BASELINE` | [src/app/api/signage/upload/route.ts](../../src/app/api/signage/upload/route.ts) |
| `/api/stock/count-sessions` | GET | `LEGACY_BASELINE` | [src/app/api/stock/count-sessions/route.ts](../../src/app/api/stock/count-sessions/route.ts) |
| `/api/stock/item-requests` | GET, POST | `LEGACY_BASELINE` | [src/app/api/stock/item-requests/route.ts](../../src/app/api/stock/item-requests/route.ts) |
| `/api/stock/item-requests/[requestId]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/stock/item-requests/[requestId]/route.ts](../../src/app/api/stock/item-requests/[requestId]/route.ts) |
| `/api/stock/mobile-count` | GET ✓ | `CONTRACTED` | [src/app/api/stock/mobile-count/route.ts](../../src/app/api/stock/mobile-count/route.ts) |
| `/api/stock/mobile-count/save` | POST ✓ | `CONTRACTED` | [src/app/api/stock/mobile-count/save/route.ts](../../src/app/api/stock/mobile-count/save/route.ts) |
| `/api/stock/mobile-count/start` | POST ✓ | `CONTRACTED` | [src/app/api/stock/mobile-count/start/route.ts](../../src/app/api/stock/mobile-count/start/route.ts) |
| `/api/stock/mobile-reposition` | GET ✓ | `CONTRACTED` | [src/app/api/stock/mobile-reposition/route.ts](../../src/app/api/stock/mobile-reposition/route.ts) |
| `/api/stock/mobile-reposition/receive` | POST ✓ | `CONTRACTED` | [src/app/api/stock/mobile-reposition/receive/route.ts](../../src/app/api/stock/mobile-reposition/receive/route.ts) |
| `/api/stock/movement-history` | GET | `LEGACY_BASELINE` | [src/app/api/stock/movement-history/route.ts](../../src/app/api/stock/movement-history/route.ts) |
| `/api/stock/replenishment-policy` | GET | `LEGACY_BASELINE` | [src/app/api/stock/replenishment-policy/route.ts](../../src/app/api/stock/replenishment-policy/route.ts) |
| `/api/stock/reposition-activities` | GET, POST | `LEGACY_BASELINE` | [src/app/api/stock/reposition-activities/route.ts](../../src/app/api/stock/reposition-activities/route.ts) |
| `/api/stock/reposition-activities/[activityId]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/stock/reposition-activities/[activityId]/route.ts](../../src/app/api/stock/reposition-activities/[activityId]/route.ts) |
| `/api/stock/reposition-activities/[activityId]/finalize` | POST | `LEGACY_BASELINE` | [src/app/api/stock/reposition-activities/[activityId]/finalize/route.ts](../../src/app/api/stock/reposition-activities/[activityId]/finalize/route.ts) |
| `/api/stock/reposition-activities/[activityId]/reopen-audit` | POST | `LEGACY_BASELINE` | [src/app/api/stock/reposition-activities/[activityId]/reopen-audit/route.ts](../../src/app/api/stock/reposition-activities/[activityId]/reopen-audit/route.ts) |
| `/api/stock/reposition-activities/[activityId]/reopen-dispatch` | POST | `LEGACY_BASELINE` | [src/app/api/stock/reposition-activities/[activityId]/reopen-dispatch/route.ts](../../src/app/api/stock/reposition-activities/[activityId]/reopen-dispatch/route.ts) |
| `/api/stock/reposition-activities/[activityId]/revert` | POST | `LEGACY_BASELINE` | [src/app/api/stock/reposition-activities/[activityId]/revert/route.ts](../../src/app/api/stock/reposition-activities/[activityId]/revert/route.ts) |
| `/api/stock/reposition-requests` | GET ✓, POST ✓ | `CONTRACTED` | [src/app/api/stock/reposition-requests/route.ts](../../src/app/api/stock/reposition-requests/route.ts) |
| `/api/stock/reposition-requests/[requestId]` | PATCH ✓ | `CONTRACTED` | [src/app/api/stock/reposition-requests/[requestId]/route.ts](../../src/app/api/stock/reposition-requests/[requestId]/route.ts) |
| `/api/stock/return-requests` | GET, POST | `LEGACY_BASELINE` | [src/app/api/stock/return-requests/route.ts](../../src/app/api/stock/return-requests/route.ts) |
| `/api/stock/return-requests/[requestId]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/stock/return-requests/[requestId]/route.ts](../../src/app/api/stock/return-requests/[requestId]/route.ts) |
| `/api/tasks` | GET, POST | `LEGACY_BASELINE` | [src/app/api/tasks/route.ts](../../src/app/api/tasks/route.ts) |
| `/api/tasks/[taskId]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/tasks/[taskId]/route.ts](../../src/app/api/tasks/[taskId]/route.ts) |
| `/api/tasks/[taskId]/status` | PATCH | `LEGACY_BASELINE` | [src/app/api/tasks/[taskId]/status/route.ts](../../src/app/api/tasks/[taskId]/status/route.ts) |
| `/api/tasks/navigation` | GET | `LEGACY_BASELINE` | [src/app/api/tasks/navigation/route.ts](../../src/app/api/tasks/navigation/route.ts) |
| `/api/tasks/projects` | GET, POST | `LEGACY_BASELINE` | [src/app/api/tasks/projects/route.ts](../../src/app/api/tasks/projects/route.ts) |
| `/api/tasks/projects/[projectId]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/tasks/projects/[projectId]/route.ts](../../src/app/api/tasks/projects/[projectId]/route.ts) |
| `/api/tasks/purchase-receipt-sync` | POST | `LEGACY_BASELINE` | [src/app/api/tasks/purchase-receipt-sync/route.ts](../../src/app/api/tasks/purchase-receipt-sync/route.ts) |
| `/api/tasks/statuses` | GET, POST | `LEGACY_BASELINE` | [src/app/api/tasks/statuses/route.ts](../../src/app/api/tasks/statuses/route.ts) |
| `/api/tasks/statuses/[statusId]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/tasks/statuses/[statusId]/route.ts](../../src/app/api/tasks/statuses/[statusId]/route.ts) |
| `/api/tasks/subprojects` | GET, POST | `LEGACY_BASELINE` | [src/app/api/tasks/subprojects/route.ts](../../src/app/api/tasks/subprojects/route.ts) |
| `/api/tasks/subprojects/[subprojectId]` | DELETE, PATCH | `LEGACY_BASELINE` | [src/app/api/tasks/subprojects/[subprojectId]/route.ts](../../src/app/api/tasks/subprojects/[subprojectId]/route.ts) |
| `/api/uniforms` | GET, PATCH | `LEGACY_BASELINE` | [src/app/api/uniforms/route.ts](../../src/app/api/uniforms/route.ts) |
| `/api/uniforms/deliver` | POST | `LEGACY_BASELINE` | [src/app/api/uniforms/deliver/route.ts](../../src/app/api/uniforms/deliver/route.ts) |
| `/api/uniforms/exchange` | POST | `LEGACY_BASELINE` | [src/app/api/uniforms/exchange/route.ts](../../src/app/api/uniforms/exchange/route.ts) |
| `/api/uniforms/return` | POST | `LEGACY_BASELINE` | [src/app/api/uniforms/return/route.ts](../../src/app/api/uniforms/return/route.ts) |
| `/api/uniforms/terms/[id]` | GET | `LEGACY_BASELINE` | [src/app/api/uniforms/terms/[id]/route.ts](../../src/app/api/uniforms/terms/[id]/route.ts) |
| `/api/uploads/operations` | POST ✓ | `CONTRACTED` | [src/app/api/uploads/operations/route.ts](../../src/app/api/uploads/operations/route.ts) |
| `/api/users` | POST | `LEGACY_BASELINE` | [src/app/api/users/route.ts](../../src/app/api/users/route.ts) |
| `/api/users/[userId]` | PATCH | `LEGACY_BASELINE` | [src/app/api/users/[userId]/route.ts](../../src/app/api/users/[userId]/route.ts) |
| `/api/webhooks/autentique` | POST | `LEGACY_BASELINE` | [src/app/api/webhooks/autentique/route.ts](../../src/app/api/webhooks/autentique/route.ts) |
| `/api/webhooks/inter/banking` | POST | `LEGACY_BASELINE` | [src/app/api/webhooks/inter/banking/route.ts](../../src/app/api/webhooks/inter/banking/route.ts) |
| `/api/webhooks/inter/cobranca` | POST | `LEGACY_BASELINE` | [src/app/api/webhooks/inter/cobranca/route.ts](../../src/app/api/webhooks/inter/cobranca/route.ts) |
| `/api/webhooks/resend` | POST | `LEGACY_BASELINE` | [src/app/api/webhooks/resend/route.ts](../../src/app/api/webhooks/resend/route.ts) |
| `/api/webhooks/stone/conciliation` | GET, POST | `LEGACY_BASELINE` | [src/app/api/webhooks/stone/conciliation/route.ts](../../src/app/api/webhooks/stone/conciliation/route.ts) |
