# Entradas externas e rotas de API

Inventário estrutural gerado de `src/app`: **353 rotas de API** e **20 páginas fora do dashboard**. Os métodos são extraídos dos exports; uma linha aqui não comprova autenticação, autorização, uso efetivo nem cobertura de fluxo. Para páginas internas, veja o [inventário do dashboard](route-inventory.md). Para entender comportamento, siga o [harness](investigation-harness.md) e confira o código.

Inclui **42 exports de Cloud Functions** resolvidos de `functions/src/index.ts`. Destinos manuais na [matriz de superfícies](surface-flow-matrix.csv); uma entrada nova exige classificação explícita. Esta associação indica onde investigar, não certifica autorização, implantação nem execução. Veja a [auditoria ampliada](surface-audit.md).

## Páginas fora do dashboard

| Caminho | Arquivo | Guia |
| --- | --- | --- |
| `/` | [src/app/page.tsx](../../src/app/page.tsx) | [recruitment](flows/recruitment.md) |
| `/aso/candidato/[token]` | [src/app/aso/candidato/[token]/page.tsx](../../src/app/aso/candidato/%5Btoken%5D/page.tsx) | [onboarding-aso](flows/onboarding-aso.md) |
| `/aso/clinica/[token]` | [src/app/aso/clinica/[token]/page.tsx](../../src/app/aso/clinica/%5Btoken%5D/page.tsx) | [onboarding-aso](flows/onboarding-aso.md) |
| `/catalogo` | [src/app/catalogo/page.tsx](../../src/app/catalogo/page.tsx) | [catalog](flows/catalog.md) |
| `/contador/ficha-registro/[token]` | [src/app/contador/ficha-registro/[token]/page.tsx](../../src/app/contador/ficha-registro/%5Btoken%5D/page.tsx) | [onboarding-accountant](flows/onboarding-accountant.md) |
| `/desligamento/contabilidade/[token]` | [src/app/desligamento/contabilidade/[token]/page.tsx](../../src/app/desligamento/contabilidade/%5Btoken%5D/page.tsx) | [termination-notice-accountant](flows/termination-notice-accountant.md) |
| `/desligamento/documentos/[token]` | [src/app/desligamento/documentos/[token]/page.tsx](../../src/app/desligamento/documentos/%5Btoken%5D/page.tsx) | [termination-audit-payment-closure](flows/termination-audit-payment-closure.md) |
| `/document-preview/[id]` | [src/app/document-preview/[id]/page.tsx](../../src/app/document-preview/%5Bid%5D/page.tsx) | [document-generation](flows/document-generation.md) |
| `/escala` | [src/app/(modules)/escala/page.tsx](../../src/app/%28modules%29/escala/page.tsx) | [dp-schedules](flows/dp-schedules.md) |
| `/ferias/contabilidade/[token]` | [src/app/ferias/contabilidade/[token]/page.tsx](../../src/app/ferias/contabilidade/%5Btoken%5D/page.tsx) | [vacation-accountant-dispatch](flows/vacation-accountant-dispatch.md) |
| `/forgot-password` | [src/app/forgot-password/page.tsx](../../src/app/forgot-password/page.tsx) | [access-and-privacy](access-and-privacy.md) |
| `/login` | [src/app/login/page.tsx](../../src/app/login/page.tsx) | [access-and-privacy](access-and-privacy.md) |
| `/patrimonio/[code]` | [src/app/patrimonio/[code]/page.tsx](../../src/app/patrimonio/%5Bcode%5D/page.tsx) | [assets](flows/assets.md) |
| `/player` | [src/app/player/page.tsx](../../src/app/player/page.tsx) | [signage](flows/signage.md) |
| `/primeiro-acesso/[token]` | [src/app/primeiro-acesso/[token]/page.tsx](../../src/app/primeiro-acesso/%5Btoken%5D/page.tsx) | [onboarding-activation](flows/onboarding-activation.md) |
| `/tv/[kioskId]` | [src/app/tv/[kioskId]/page.tsx](../../src/app/tv/%5BkioskId%5D/page.tsx) | [signage](flows/signage.md) |
| `/vagas` | [src/app/vagas/page.tsx](../../src/app/vagas/page.tsx) | [recruitment](flows/recruitment.md) |
| `/vagas/[slug]` | [src/app/vagas/[slug]/page.tsx](../../src/app/vagas/%5Bslug%5D/page.tsx) | [recruitment](flows/recruitment.md) |
| `/vagas/banco-de-talentos` | [src/app/vagas/banco-de-talentos/page.tsx](../../src/app/vagas/banco-de-talentos/page.tsx) | [recruitment](flows/recruitment.md) |
| `/vagas/onboarding/[token]` | [src/app/vagas/onboarding/[token]/page.tsx](../../src/app/vagas/onboarding/%5Btoken%5D/page.tsx) | [onboarding-public-documents](flows/onboarding-public-documents.md) |

## Rotas de API

| Caminho | Métodos exportados | Arquivo | Guia |
| --- | --- | --- | --- |
| `/api/admin/fix-receipts` | POST | [src/app/api/admin/fix-receipts/route.ts](../../src/app/api/admin/fix-receipts/route.ts) | [access-and-privacy](access-and-privacy.md) |
| `/api/ai/analyze-consumption` | POST | [src/app/api/ai/analyze-consumption/route.ts](../../src/app/api/ai/analyze-consumption/route.ts) | [stock-analysis](flows/stock-analysis.md) |
| `/api/ai/analyze-goals` | POST | [src/app/api/ai/analyze-goals/route.ts](../../src/app/api/ai/analyze-goals/route.ts) | [goals](flows/goals.md) |
| `/api/assets` | GET, POST | [src/app/api/assets/route.ts](../../src/app/api/assets/route.ts) | [assets](flows/assets.md) |
| `/api/assets/[assetId]` | GET, PATCH, POST | [src/app/api/assets/[assetId]/route.ts](../../src/app/api/assets/%5BassetId%5D/route.ts) | [assets](flows/assets.md) |
| `/api/assets/[assetId]/movements` | GET | [src/app/api/assets/[assetId]/movements/route.ts](../../src/app/api/assets/%5BassetId%5D/movements/route.ts) | [assets](flows/assets.md) |
| `/api/assets/barcode-labels` | GET, POST | [src/app/api/assets/barcode-labels/route.ts](../../src/app/api/assets/barcode-labels/route.ts) | [assets](flows/assets.md) |
| `/api/assets/categories` | GET, POST | [src/app/api/assets/categories/route.ts](../../src/app/api/assets/categories/route.ts) | [assets](flows/assets.md) |
| `/api/assets/upload` | POST | [src/app/api/assets/upload/route.ts](../../src/app/api/assets/upload/route.ts) | [assets](flows/assets.md) |
| `/api/audit/log` | POST | [src/app/api/audit/log/route.ts](../../src/app/api/audit/log/route.ts) | [access-and-privacy](access-and-privacy.md) |
| `/api/audit/logs` | GET | [src/app/api/audit/logs/route.ts](../../src/app/api/audit/logs/route.ts) | [access-and-privacy](access-and-privacy.md) |
| `/api/auth/first-access/[token]` | GET, POST | [src/app/api/auth/first-access/[token]/route.ts](../../src/app/api/auth/first-access/%5Btoken%5D/route.ts) | [access-and-privacy](access-and-privacy.md) |
| `/api/auth/forgot-password` | POST | [src/app/api/auth/forgot-password/route.ts](../../src/app/api/auth/forgot-password/route.ts) | [access-and-privacy](access-and-privacy.md) |
| `/api/auth/last-login` | POST | [src/app/api/auth/last-login/route.ts](../../src/app/api/auth/last-login/route.ts) | [access-and-privacy](access-and-privacy.md) |
| `/api/auth/password-changed` | POST | [src/app/api/auth/password-changed/route.ts](../../src/app/api/auth/password-changed/route.ts) | [access-and-privacy](access-and-privacy.md) |
| `/api/catalogo` | GET | [src/app/api/catalogo/route.ts](../../src/app/api/catalogo/route.ts) | [catalog](flows/catalog.md) |
| `/api/client/bootstrap` | GET | [src/app/api/client/bootstrap/route.ts](../../src/app/api/client/bootstrap/route.ts) | [access-and-privacy](access-and-privacy.md) |
| `/api/collaborator/dashboard` | GET | [src/app/api/collaborator/dashboard/route.ts](../../src/app/api/collaborator/dashboard/route.ts) | [collaborator-dashboard](flows/collaborator-dashboard.md) |
| `/api/collaborator/schedule` | GET | [src/app/api/collaborator/schedule/route.ts](../../src/app/api/collaborator/schedule/route.ts) | [collaborator-schedule](flows/collaborator-schedule.md) |
| `/api/companies` | POST | [src/app/api/companies/route.ts](../../src/app/api/companies/route.ts) | [registry](flows/registry.md) |
| `/api/companies/[id]` | PUT | [src/app/api/companies/[id]/route.ts](../../src/app/api/companies/%5Bid%5D/route.ts) | [registry](flows/registry.md) |
| `/api/companies/[id]/consultation-history` | GET | [src/app/api/companies/[id]/consultation-history/route.ts](../../src/app/api/companies/%5Bid%5D/consultation-history/route.ts) | [registry](flows/registry.md) |
| `/api/companies/cnpj/[cnpj]` | GET | [src/app/api/companies/cnpj/[cnpj]/route.ts](../../src/app/api/companies/cnpj/%5Bcnpj%5D/route.ts) | [registry](flows/registry.md) |
| `/api/companies/cnpj/[cnpj]/refresh` | POST | [src/app/api/companies/cnpj/[cnpj]/refresh/route.ts](../../src/app/api/companies/cnpj/%5Bcnpj%5D/refresh/route.ts) | [registry](flows/registry.md) |
| `/api/companies/document-signatories` | GET | [src/app/api/companies/document-signatories/route.ts](../../src/app/api/companies/document-signatories/route.ts) | [document-generation](flows/document-generation.md) |
| `/api/documents/collective-agreements` | GET, POST | [src/app/api/documents/collective-agreements/route.ts](../../src/app/api/documents/collective-agreements/route.ts) | [company-documents](flows/company-documents.md) |
| `/api/documents/collective-agreements/[id]` | PATCH | [src/app/api/documents/collective-agreements/[id]/route.ts](../../src/app/api/documents/collective-agreements/%5Bid%5D/route.ts) | [company-documents](flows/company-documents.md) |
| `/api/documents/company` | GET, POST, DELETE | [src/app/api/documents/company/route.ts](../../src/app/api/documents/company/route.ts) | [company-documents](flows/company-documents.md) |
| `/api/documents/company/access` | POST | [src/app/api/documents/company/access/route.ts](../../src/app/api/documents/company/access/route.ts) | [company-documents](flows/company-documents.md) |
| `/api/documents/company/analyze` | POST | [src/app/api/documents/company/analyze/route.ts](../../src/app/api/documents/company/analyze/route.ts) | [company-documents](flows/company-documents.md) |
| `/api/documents/company/units` | GET | [src/app/api/documents/company/units/route.ts](../../src/app/api/documents/company/units/route.ts) | [company-documents](flows/company-documents.md) |
| `/api/documents/generate` | POST | [src/app/api/documents/generate/route.ts](../../src/app/api/documents/generate/route.ts) | [document-generation](flows/document-generation.md) |
| `/api/documents/generated` | GET | [src/app/api/documents/generated/route.ts](../../src/app/api/documents/generated/route.ts) | [document-generation](flows/document-generation.md) |
| `/api/documents/generated/[id]` | POST, PATCH, DELETE | [src/app/api/documents/generated/[id]/route.ts](../../src/app/api/documents/generated/%5Bid%5D/route.ts) | [document-generation](flows/document-generation.md) |
| `/api/documents/generated/[id]/audit` | GET | [src/app/api/documents/generated/[id]/audit/route.ts](../../src/app/api/documents/generated/%5Bid%5D/audit/route.ts) | [document-generation](flows/document-generation.md) |
| `/api/documents/generated/[id]/file` | GET | [src/app/api/documents/generated/[id]/file/route.ts](../../src/app/api/documents/generated/%5Bid%5D/file/route.ts) | [document-generation](flows/document-generation.md) |
| `/api/documents/generated/[id]/signature` | GET, POST | [src/app/api/documents/generated/[id]/signature/route.ts](../../src/app/api/documents/generated/%5Bid%5D/signature/route.ts) | [document-generation](flows/document-generation.md) |
| `/api/documents/generator/parties` | GET | [src/app/api/documents/generator/parties/route.ts](../../src/app/api/documents/generator/parties/route.ts) | [document-generation](flows/document-generation.md) |
| `/api/documents/generator/templates` | GET | [src/app/api/documents/generator/templates/route.ts](../../src/app/api/documents/generator/templates/route.ts) | [document-generation](flows/document-generation.md) |
| `/api/documents/templates` | GET, POST | [src/app/api/documents/templates/route.ts](../../src/app/api/documents/templates/route.ts) | [document-templates](flows/document-templates.md) |
| `/api/documents/templates/[id]` | GET, PATCH | [src/app/api/documents/templates/[id]/route.ts](../../src/app/api/documents/templates/%5Bid%5D/route.ts) | [document-templates](flows/document-templates.md) |
| `/api/documents/templates/[id]/ai-plan` | GET, POST, PATCH | [src/app/api/documents/templates/[id]/ai-plan/route.ts](../../src/app/api/documents/templates/%5Bid%5D/ai-plan/route.ts) | [document-templates](flows/document-templates.md) |
| `/api/documents/templates/[id]/editable-version` | POST | [src/app/api/documents/templates/[id]/editable-version/route.ts](../../src/app/api/documents/templates/%5Bid%5D/editable-version/route.ts) | [document-templates](flows/document-templates.md) |
| `/api/documents/templates/[id]/editor` | GET, POST | [src/app/api/documents/templates/[id]/editor/route.ts](../../src/app/api/documents/templates/%5Bid%5D/editor/route.ts) | [document-templates](flows/document-templates.md) |
| `/api/documents/templates/[id]/file` | POST | [src/app/api/documents/templates/[id]/file/route.ts](../../src/app/api/documents/templates/%5Bid%5D/file/route.ts) | [document-templates](flows/document-templates.md) |
| `/api/documents/templates/[id]/integrity` | POST | [src/app/api/documents/templates/[id]/integrity/route.ts](../../src/app/api/documents/templates/%5Bid%5D/integrity/route.ts) | [document-templates](flows/document-templates.md) |
| `/api/documents/templates/[id]/preview` | GET | [src/app/api/documents/templates/[id]/preview/route.ts](../../src/app/api/documents/templates/%5Bid%5D/preview/route.ts) | [document-templates](flows/document-templates.md) |
| `/api/documents/templates/[id]/source` | GET | [src/app/api/documents/templates/[id]/source/route.ts](../../src/app/api/documents/templates/%5Bid%5D/source/route.ts) | [document-templates](flows/document-templates.md) |
| `/api/documents/templates/[id]/text` | GET | [src/app/api/documents/templates/[id]/text/route.ts](../../src/app/api/documents/templates/%5Bid%5D/text/route.ts) | [document-templates](flows/document-templates.md) |
| `/api/documents/templates/[id]/workflow` | PATCH | [src/app/api/documents/templates/[id]/workflow/route.ts](../../src/app/api/documents/templates/%5Bid%5D/workflow/route.ts) | [document-templates](flows/document-templates.md) |
| `/api/dp/bootstrap` | GET | [src/app/api/dp/bootstrap/route.ts](../../src/app/api/dp/bootstrap/route.ts) | [dp-overview](flows/dp-overview.md) |
| `/api/dp/schedules/[scheduleId]/coverage-demands/[date]` | PUT | [src/app/api/dp/schedules/[scheduleId]/coverage-demands/[date]/route.ts](../../src/app/api/dp/schedules/%5BscheduleId%5D/coverage-demands/%5Bdate%5D/route.ts) | [dp-schedules](flows/dp-schedules.md) |
| `/api/dp/schedules/[scheduleId]/day-offs` | POST, DELETE | [src/app/api/dp/schedules/[scheduleId]/day-offs/route.ts](../../src/app/api/dp/schedules/%5BscheduleId%5D/day-offs/route.ts) | [dp-schedules](flows/dp-schedules.md) |
| `/api/dp/schedules/[scheduleId]/shifts/[shiftId]` | PUT, PATCH, DELETE | [src/app/api/dp/schedules/[scheduleId]/shifts/[shiftId]/route.ts](../../src/app/api/dp/schedules/%5BscheduleId%5D/shifts/%5BshiftId%5D/route.ts) | [dp-schedules](flows/dp-schedules.md) |
| `/api/dp/schedules/[scheduleId]/shifts/bulk` | POST | [src/app/api/dp/schedules/[scheduleId]/shifts/bulk/route.ts](../../src/app/api/dp/schedules/%5BscheduleId%5D/shifts/bulk/route.ts) | [dp-schedules](flows/dp-schedules.md) |
| `/api/dp/schedules/[scheduleId]/vacations` | GET | [src/app/api/dp/schedules/[scheduleId]/vacations/route.ts](../../src/app/api/dp/schedules/%5BscheduleId%5D/vacations/route.ts) | [dp-schedules](flows/dp-schedules.md) |
| `/api/dp/unit-groups` | POST | [src/app/api/dp/unit-groups/route.ts](../../src/app/api/dp/unit-groups/route.ts) | [dp-configuration](flows/dp-configuration.md) |
| `/api/dp/unit-groups/[groupId]` | PATCH, DELETE | [src/app/api/dp/unit-groups/[groupId]/route.ts](../../src/app/api/dp/unit-groups/%5BgroupId%5D/route.ts) | [dp-configuration](flows/dp-configuration.md) |
| `/api/dp/unit-organizations` | POST | [src/app/api/dp/unit-organizations/route.ts](../../src/app/api/dp/unit-organizations/route.ts) | [dp-configuration](flows/dp-configuration.md) |
| `/api/dp/unit-organizations/[organizationId]` | PATCH, DELETE | [src/app/api/dp/unit-organizations/[organizationId]/route.ts](../../src/app/api/dp/unit-organizations/%5BorganizationId%5D/route.ts) | [dp-configuration](flows/dp-configuration.md) |
| `/api/dp/units` | POST | [src/app/api/dp/units/route.ts](../../src/app/api/dp/units/route.ts) | [dp-configuration](flows/dp-configuration.md) |
| `/api/dp/units/[unitId]` | PATCH, DELETE | [src/app/api/dp/units/[unitId]/route.ts](../../src/app/api/dp/units/%5BunitId%5D/route.ts) | [dp-configuration](flows/dp-configuration.md) |
| `/api/dp/vacations` | GET, POST | [src/app/api/dp/vacations/route.ts](../../src/app/api/dp/vacations/route.ts) | [vacation-payment-closure](flows/vacation-payment-closure.md) |
| `/api/dp/vacations/[vacationId]` | PATCH, DELETE | [src/app/api/dp/vacations/[vacationId]/route.ts](../../src/app/api/dp/vacations/%5BvacationId%5D/route.ts) | [vacation-payment-closure](flows/vacation-payment-closure.md) |
| `/api/dp/vacations/[vacationId]/assets/[kind]` | GET | [src/app/api/dp/vacations/[vacationId]/assets/[kind]/route.ts](../../src/app/api/dp/vacations/%5BvacationId%5D/assets/%5Bkind%5D/route.ts) | [vacation-notice](flows/vacation-notice.md) |
| `/api/dp/vacations/[vacationId]/events` | GET | [src/app/api/dp/vacations/[vacationId]/events/route.ts](../../src/app/api/dp/vacations/%5BvacationId%5D/events/route.ts) | [vacation-payment-closure](flows/vacation-payment-closure.md) |
| `/api/dp/vacations/[vacationId]/notice` | GET | [src/app/api/dp/vacations/[vacationId]/notice/route.ts](../../src/app/api/dp/vacations/%5BvacationId%5D/notice/route.ts) | [vacation-notice](flows/vacation-notice.md) |
| `/api/dp/vacations/[vacationId]/receipt-documents/[documentId]` | GET | [src/app/api/dp/vacations/[vacationId]/receipt-documents/[documentId]/route.ts](../../src/app/api/dp/vacations/%5BvacationId%5D/receipt-documents/%5BdocumentId%5D/route.ts) | [vacation-receipts](flows/vacation-receipts.md) |
| `/api/financial/accounts` | POST, PATCH, DELETE | [src/app/api/financial/accounts/route.ts](../../src/app/api/financial/accounts/route.ts) | [expenses](flows/expenses.md) |
| `/api/financial/agent` | POST | [src/app/api/financial/agent/route.ts](../../src/app/api/financial/agent/route.ts) | [financial-overview](flows/financial-overview.md) |
| `/api/financial/analysis-routines` | GET, POST | [src/app/api/financial/analysis-routines/route.ts](../../src/app/api/financial/analysis-routines/route.ts) | [financial-overview](flows/financial-overview.md) |
| `/api/financial/analysis-routines/scheduler` | POST | [src/app/api/financial/analysis-routines/scheduler/route.ts](../../src/app/api/financial/analysis-routines/scheduler/route.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `/api/financial/beneficiaries` | GET | [src/app/api/financial/beneficiaries/route.ts](../../src/app/api/financial/beneficiaries/route.ts) | [payment-requests](flows/payment-requests.md) |
| `/api/financial/beneficiaries/entities/[entityId]` | GET, PATCH | [src/app/api/financial/beneficiaries/entities/[entityId]/route.ts](../../src/app/api/financial/beneficiaries/entities/%5BentityId%5D/route.ts) | [payment-requests](flows/payment-requests.md) |
| `/api/financial/bootstrap` | POST | [src/app/api/financial/bootstrap/route.ts](../../src/app/api/financial/bootstrap/route.ts) | [expenses](flows/expenses.md) |
| `/api/financial/budget-inputs` | GET | [src/app/api/financial/budget-inputs/route.ts](../../src/app/api/financial/budget-inputs/route.ts) | [financial-budgets](flows/financial-budgets.md) |
| `/api/financial/budget-projects` | GET, POST | [src/app/api/financial/budget-projects/route.ts](../../src/app/api/financial/budget-projects/route.ts) | [financial-budgets](flows/financial-budgets.md) |
| `/api/financial/budget-projects/[id]` | GET, PATCH | [src/app/api/financial/budget-projects/[id]/route.ts](../../src/app/api/financial/budget-projects/%5Bid%5D/route.ts) | [financial-budgets](flows/financial-budgets.md) |
| `/api/financial/budget-projects/[id]/candidates` | GET | [src/app/api/financial/budget-projects/[id]/candidates/route.ts](../../src/app/api/financial/budget-projects/%5Bid%5D/candidates/route.ts) | [financial-budgets](flows/financial-budgets.md) |
| `/api/financial/budget-projects/[id]/expenses` | POST, DELETE | [src/app/api/financial/budget-projects/[id]/expenses/route.ts](../../src/app/api/financial/budget-projects/%5Bid%5D/expenses/route.ts) | [financial-budgets](flows/financial-budgets.md) |
| `/api/financial/budget-projects/[id]/stages` | POST | [src/app/api/financial/budget-projects/[id]/stages/route.ts](../../src/app/api/financial/budget-projects/%5Bid%5D/stages/route.ts) | [financial-budgets](flows/financial-budgets.md) |
| `/api/financial/budget-rules` | GET, POST | [src/app/api/financial/budget-rules/route.ts](../../src/app/api/financial/budget-rules/route.ts) | [financial-budgets](flows/financial-budgets.md) |
| `/api/financial/budget-rules/[id]` | PATCH | [src/app/api/financial/budget-rules/[id]/route.ts](../../src/app/api/financial/budget-rules/%5Bid%5D/route.ts) | [financial-budgets](flows/financial-budgets.md) |
| `/api/financial/budget-rules/generate` | POST | [src/app/api/financial/budget-rules/generate/route.ts](../../src/app/api/financial/budget-rules/generate/route.ts) | [financial-budgets](flows/financial-budgets.md) |
| `/api/financial/budget-rules/preview` | POST | [src/app/api/financial/budget-rules/preview/route.ts](../../src/app/api/financial/budget-rules/preview/route.ts) | [financial-budgets](flows/financial-budgets.md) |
| `/api/financial/budgets` | GET, POST | [src/app/api/financial/budgets/route.ts](../../src/app/api/financial/budgets/route.ts) | [financial-budgets](flows/financial-budgets.md) |
| `/api/financial/budgets/[id]` | GET, PATCH | [src/app/api/financial/budgets/[id]/route.ts](../../src/app/api/financial/budgets/%5Bid%5D/route.ts) | [financial-budgets](flows/financial-budgets.md) |
| `/api/financial/budgets/[id]/coverage` | POST | [src/app/api/financial/budgets/[id]/coverage/route.ts](../../src/app/api/financial/budgets/%5Bid%5D/coverage/route.ts) | [financial-budgets](flows/financial-budgets.md) |
| `/api/financial/budgets/cash-projections` | GET | [src/app/api/financial/budgets/cash-projections/route.ts](../../src/app/api/financial/budgets/cash-projections/route.ts) | [financial-budgets](flows/financial-budgets.md) |
| `/api/financial/budgets/forecast-conversion` | GET, POST | [src/app/api/financial/budgets/forecast-conversion/route.ts](../../src/app/api/financial/budgets/forecast-conversion/route.ts) | [financial-budgets](flows/financial-budgets.md) |
| `/api/financial/budgets/person-references` | POST, GET | [src/app/api/financial/budgets/person-references/route.ts](../../src/app/api/financial/budgets/person-references/route.ts) | [financial-budgets](flows/financial-budgets.md) |
| `/api/financial/card-statements/[statementId]/reconcile` | POST | [src/app/api/financial/card-statements/[statementId]/reconcile/route.ts](../../src/app/api/financial/card-statements/%5BstatementId%5D/reconcile/route.ts) | [card-statements](flows/card-statements.md) |
| `/api/financial/card-statements/import` | POST | [src/app/api/financial/card-statements/import/route.ts](../../src/app/api/financial/card-statements/import/route.ts) | [card-statements](flows/card-statements.md) |
| `/api/financial/card-statements/import-preview` | POST | [src/app/api/financial/card-statements/import-preview/route.ts](../../src/app/api/financial/card-statements/import-preview/route.ts) | [card-statements](flows/card-statements.md) |
| `/api/financial/cash-closures` | GET | [src/app/api/financial/cash-closures/route.ts](../../src/app/api/financial/cash-closures/route.ts) | [cash-closures](flows/cash-closures.md) |
| `/api/financial/cash-closures/[closureId]` | GET, PATCH | [src/app/api/financial/cash-closures/[closureId]/route.ts](../../src/app/api/financial/cash-closures/%5BclosureId%5D/route.ts) | [cash-closures](flows/cash-closures.md) |
| `/api/financial/cash-closures/[closureId]/audit` | GET | [src/app/api/financial/cash-closures/[closureId]/audit/route.ts](../../src/app/api/financial/cash-closures/%5BclosureId%5D/audit/route.ts) | [cash-closures](flows/cash-closures.md) |
| `/api/financial/cash-closures/[closureId]/expected-adjustment` | POST, DELETE | [src/app/api/financial/cash-closures/[closureId]/expected-adjustment/route.ts](../../src/app/api/financial/cash-closures/%5BclosureId%5D/expected-adjustment/route.ts) | [cash-closures](flows/cash-closures.md) |
| `/api/financial/cash-closures/[closureId]/finalize` | POST | [src/app/api/financial/cash-closures/[closureId]/finalize/route.ts](../../src/app/api/financial/cash-closures/%5BclosureId%5D/finalize/route.ts) | [cash-closures](flows/cash-closures.md) |
| `/api/financial/cash-closures/[closureId]/reopen` | POST | [src/app/api/financial/cash-closures/[closureId]/reopen/route.ts](../../src/app/api/financial/cash-closures/%5BclosureId%5D/reopen/route.ts) | [cash-closures](flows/cash-closures.md) |
| `/api/financial/cash-closures/[closureId]/split-deposit` | POST | [src/app/api/financial/cash-closures/[closureId]/split-deposit/route.ts](../../src/app/api/financial/cash-closures/%5BclosureId%5D/split-deposit/route.ts) | [cash-closures](flows/cash-closures.md) |
| `/api/financial/cash-closures/months` | GET | [src/app/api/financial/cash-closures/months/route.ts](../../src/app/api/financial/cash-closures/months/route.ts) | [cash-closures](flows/cash-closures.md) |
| `/api/financial/cash-closures/overview` | GET | [src/app/api/financial/cash-closures/overview/route.ts](../../src/app/api/financial/cash-closures/overview/route.ts) | [cash-closures](flows/cash-closures.md) |
| `/api/financial/cash-closures/sync` | POST | [src/app/api/financial/cash-closures/sync/route.ts](../../src/app/api/financial/cash-closures/sync/route.ts) | [cash-closures](flows/cash-closures.md) |
| `/api/financial/cash-counting-sessions` | GET, POST | [src/app/api/financial/cash-counting-sessions/route.ts](../../src/app/api/financial/cash-counting-sessions/route.ts) | [cash-closures](flows/cash-closures.md) |
| `/api/financial/cash-counting-sessions/[sessionId]` | GET | [src/app/api/financial/cash-counting-sessions/[sessionId]/route.ts](../../src/app/api/financial/cash-counting-sessions/%5BsessionId%5D/route.ts) | [cash-closures](flows/cash-closures.md) |
| `/api/financial/cash-counting-sessions/[sessionId]/cancel` | POST | [src/app/api/financial/cash-counting-sessions/[sessionId]/cancel/route.ts](../../src/app/api/financial/cash-counting-sessions/%5BsessionId%5D/cancel/route.ts) | [cash-closures](flows/cash-closures.md) |
| `/api/financial/cash-counting-sessions/[sessionId]/coins/exchange` | POST | [src/app/api/financial/cash-counting-sessions/[sessionId]/coins/exchange/route.ts](../../src/app/api/financial/cash-counting-sessions/%5BsessionId%5D/coins/exchange/route.ts) | [cash-closures](flows/cash-closures.md) |
| `/api/financial/cash-counting-sessions/[sessionId]/denominations` | POST | [src/app/api/financial/cash-counting-sessions/[sessionId]/denominations/route.ts](../../src/app/api/financial/cash-counting-sessions/%5BsessionId%5D/denominations/route.ts) | [cash-closures](flows/cash-closures.md) |
| `/api/financial/cash-counting-sessions/[sessionId]/draft-position` | PATCH | [src/app/api/financial/cash-counting-sessions/[sessionId]/draft-position/route.ts](../../src/app/api/financial/cash-counting-sessions/%5BsessionId%5D/draft-position/route.ts) | [cash-closures](flows/cash-closures.md) |
| `/api/financial/cash-counting-sessions/[sessionId]/finish` | POST | [src/app/api/financial/cash-counting-sessions/[sessionId]/finish/route.ts](../../src/app/api/financial/cash-counting-sessions/%5BsessionId%5D/finish/route.ts) | [cash-closures](flows/cash-closures.md) |
| `/api/financial/cash-deposits` | GET | [src/app/api/financial/cash-deposits/route.ts](../../src/app/api/financial/cash-deposits/route.ts) | [cash-deposits](flows/cash-deposits.md) |
| `/api/financial/cash-deposits/[batchId]` | GET | [src/app/api/financial/cash-deposits/[batchId]/route.ts](../../src/app/api/financial/cash-deposits/%5BbatchId%5D/route.ts) | [cash-deposits](flows/cash-deposits.md) |
| `/api/financial/cash-deposits/[batchId]/cancel` | POST | [src/app/api/financial/cash-deposits/[batchId]/cancel/route.ts](../../src/app/api/financial/cash-deposits/%5BbatchId%5D/cancel/route.ts) | [cash-deposits](flows/cash-deposits.md) |
| `/api/financial/cash-deposits/[batchId]/coins` | POST | [src/app/api/financial/cash-deposits/[batchId]/coins/route.ts](../../src/app/api/financial/cash-deposits/%5BbatchId%5D/coins/route.ts) | [cash-deposits](flows/cash-deposits.md) |
| `/api/financial/cash-deposits/[batchId]/issue` | POST | [src/app/api/financial/cash-deposits/[batchId]/issue/route.ts](../../src/app/api/financial/cash-deposits/%5BbatchId%5D/issue/route.ts) | [cash-deposits](flows/cash-deposits.md) |
| `/api/financial/cash-deposits/[batchId]/pdf` | GET | [src/app/api/financial/cash-deposits/[batchId]/pdf/route.ts](../../src/app/api/financial/cash-deposits/%5BbatchId%5D/pdf/route.ts) | [cash-deposits](flows/cash-deposits.md) |
| `/api/financial/cash-deposits/[batchId]/refresh` | POST | [src/app/api/financial/cash-deposits/[batchId]/refresh/route.ts](../../src/app/api/financial/cash-deposits/%5BbatchId%5D/refresh/route.ts) | [cash-deposits](flows/cash-deposits.md) |
| `/api/financial/cash-deposits/adjustments/allocate` | POST | [src/app/api/financial/cash-deposits/adjustments/allocate/route.ts](../../src/app/api/financial/cash-deposits/adjustments/allocate/route.ts) | [cash-deposits](flows/cash-deposits.md) |
| `/api/financial/cash-deposits/coins/exchange` | POST | [src/app/api/financial/cash-deposits/coins/exchange/route.ts](../../src/app/api/financial/cash-deposits/coins/exchange/route.ts) | [cash-deposits](flows/cash-deposits.md) |
| `/api/financial/cash-deposits/inter/webhook` | GET, POST | [src/app/api/financial/cash-deposits/inter/webhook/route.ts](../../src/app/api/financial/cash-deposits/inter/webhook/route.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `/api/financial/cash-deposits/reports` | GET | [src/app/api/financial/cash-deposits/reports/route.ts](../../src/app/api/financial/cash-deposits/reports/route.ts) | [cash-deposits](flows/cash-deposits.md) |
| `/api/financial/cash-deposits/reports/export` | GET | [src/app/api/financial/cash-deposits/reports/export/route.ts](../../src/app/api/financial/cash-deposits/reports/export/route.ts) | [cash-deposits](flows/cash-deposits.md) |
| `/api/financial/data` | GET | [src/app/api/financial/data/route.ts](../../src/app/api/financial/data/route.ts) | [cash-flow](flows/cash-flow.md) |
| `/api/financial/dre/source-data` | GET | [src/app/api/financial/dre/source-data/route.ts](../../src/app/api/financial/dre/source-data/route.ts) | [dre](flows/dre.md) |
| `/api/financial/dre/stock-cmv` | GET | [src/app/api/financial/dre/stock-cmv/route.ts](../../src/app/api/financial/dre/stock-cmv/route.ts) | [dre](flows/dre.md) |
| `/api/financial/expenses/[expenseId]/adjustments/[adjustmentId]` | PATCH | [src/app/api/financial/expenses/[expenseId]/adjustments/[adjustmentId]/route.ts](../../src/app/api/financial/expenses/%5BexpenseId%5D/adjustments/%5BadjustmentId%5D/route.ts) | [expenses](flows/expenses.md) |
| `/api/financial/expenses/[expenseId]/boleto` | POST, GET | [src/app/api/financial/expenses/[expenseId]/boleto/route.ts](../../src/app/api/financial/expenses/%5BexpenseId%5D/boleto/route.ts) | [payment-requests](flows/payment-requests.md) |
| `/api/financial/expenses/[expenseId]/boleto/payment` | POST | [src/app/api/financial/expenses/[expenseId]/boleto/payment/route.ts](../../src/app/api/financial/expenses/%5BexpenseId%5D/boleto/payment/route.ts) | [payment-requests](flows/payment-requests.md) |
| `/api/financial/expenses/[expenseId]/payments` | POST | [src/app/api/financial/expenses/[expenseId]/payments/route.ts](../../src/app/api/financial/expenses/%5BexpenseId%5D/payments/route.ts) | [expenses](flows/expenses.md) |
| `/api/financial/expenses/[expenseId]/reconcile-provision` | POST | [src/app/api/financial/expenses/[expenseId]/reconcile-provision/route.ts](../../src/app/api/financial/expenses/%5BexpenseId%5D/reconcile-provision/route.ts) | [expenses](flows/expenses.md) |
| `/api/financial/expenses/[expenseId]/settlement` | GET | [src/app/api/financial/expenses/[expenseId]/settlement/route.ts](../../src/app/api/financial/expenses/%5BexpenseId%5D/settlement/route.ts) | [expenses](flows/expenses.md) |
| `/api/financial/import-sessions/[sessionId]` | PATCH | [src/app/api/financial/import-sessions/[sessionId]/route.ts](../../src/app/api/financial/import-sessions/%5BsessionId%5D/route.ts) | [expenses](flows/expenses.md) |
| `/api/financial/inbox` | GET | [src/app/api/financial/inbox/route.ts](../../src/app/api/financial/inbox/route.ts) | [financial-inbox](flows/financial-inbox.md) |
| `/api/financial/inbox/[id]` | GET, PATCH | [src/app/api/financial/inbox/[id]/route.ts](../../src/app/api/financial/inbox/%5Bid%5D/route.ts) | [financial-inbox](flows/financial-inbox.md) |
| `/api/financial/inbox/[id]/analyze` | POST | [src/app/api/financial/inbox/[id]/analyze/route.ts](../../src/app/api/financial/inbox/%5Bid%5D/analyze/route.ts) | [financial-inbox](flows/financial-inbox.md) |
| `/api/financial/inbox/[id]/files/[fileId]` | GET | [src/app/api/financial/inbox/[id]/files/[fileId]/route.ts](../../src/app/api/financial/inbox/%5Bid%5D/files/%5BfileId%5D/route.ts) | [financial-inbox](flows/financial-inbox.md) |
| `/api/financial/inbox/[id]/link` | POST | [src/app/api/financial/inbox/[id]/link/route.ts](../../src/app/api/financial/inbox/%5Bid%5D/link/route.ts) | [financial-inbox](flows/financial-inbox.md) |
| `/api/financial/inbox/[id]/payment` | POST | [src/app/api/financial/inbox/[id]/payment/route.ts](../../src/app/api/financial/inbox/%5Bid%5D/payment/route.ts) | [financial-inbox](flows/financial-inbox.md) |
| `/api/financial/inbox/[id]/restore` | POST | [src/app/api/financial/inbox/[id]/restore/route.ts](../../src/app/api/financial/inbox/%5Bid%5D/restore/route.ts) | [financial-inbox](flows/financial-inbox.md) |
| `/api/financial/inbox/bulk-review` | POST | [src/app/api/financial/inbox/bulk-review/route.ts](../../src/app/api/financial/inbox/bulk-review/route.ts) | [financial-inbox](flows/financial-inbox.md) |
| `/api/financial/inbox/settings` | GET, PUT | [src/app/api/financial/inbox/settings/route.ts](../../src/app/api/financial/inbox/settings/route.ts) | [financial-inbox](flows/financial-inbox.md) |
| `/api/financial/management-analysis` | POST | [src/app/api/financial/management-analysis/route.ts](../../src/app/api/financial/management-analysis/route.ts) | [financial-overview](flows/financial-overview.md) |
| `/api/financial/payment-requests` | GET, POST | [src/app/api/financial/payment-requests/route.ts](../../src/app/api/financial/payment-requests/route.ts) | [payment-requests](flows/payment-requests.md) |
| `/api/financial/payment-requests/[id]/authorize` | POST | [src/app/api/financial/payment-requests/[id]/authorize/route.ts](../../src/app/api/financial/payment-requests/%5Bid%5D/authorize/route.ts) | [payment-requests](flows/payment-requests.md) |
| `/api/financial/payment-requests/[id]/proof` | GET | [src/app/api/financial/payment-requests/[id]/proof/route.ts](../../src/app/api/financial/payment-requests/%5Bid%5D/proof/route.ts) | [payment-requests](flows/payment-requests.md) |
| `/api/financial/payment-requests/[id]/refresh` | POST | [src/app/api/financial/payment-requests/[id]/refresh/route.ts](../../src/app/api/financial/payment-requests/%5Bid%5D/refresh/route.ts) | [payment-requests](flows/payment-requests.md) |
| `/api/financial/payment-requests/[id]/submit` | POST | [src/app/api/financial/payment-requests/[id]/submit/route.ts](../../src/app/api/financial/payment-requests/%5Bid%5D/submit/route.ts) | [payment-requests](flows/payment-requests.md) |
| `/api/financial/pdv-stone-review` | POST | [src/app/api/financial/pdv-stone-review/route.ts](../../src/app/api/financial/pdv-stone-review/route.ts) | [stone-sales-review](flows/stone-sales-review.md) |
| `/api/financial/stone-agenda` | GET | [src/app/api/financial/stone-agenda/route.ts](../../src/app/api/financial/stone-agenda/route.ts) | [receivables-stone](flows/receivables-stone.md) |
| `/api/financial/stone-anticipations` | GET | [src/app/api/financial/stone-anticipations/route.ts](../../src/app/api/financial/stone-anticipations/route.ts) | [receivables-stone](flows/receivables-stone.md) |
| `/api/financial/stone-future-receivables` | POST | [src/app/api/financial/stone-future-receivables/route.ts](../../src/app/api/financial/stone-future-receivables/route.ts) | [receivables-stone](flows/receivables-stone.md) |
| `/api/financial/stone-mappings` | GET, POST | [src/app/api/financial/stone-mappings/route.ts](../../src/app/api/financial/stone-mappings/route.ts) | [stone-sales-review](flows/stone-sales-review.md) |
| `/api/financial/stone-portfolio` | GET, POST | [src/app/api/financial/stone-portfolio/route.ts](../../src/app/api/financial/stone-portfolio/route.ts) | [receivables-stone](flows/receivables-stone.md) |
| `/api/financial/stone-portfolio-cron` | POST | [src/app/api/financial/stone-portfolio-cron/route.ts](../../src/app/api/financial/stone-portfolio-cron/route.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `/api/financial/stone-wallet-position` | GET | [src/app/api/financial/stone-wallet-position/route.ts](../../src/app/api/financial/stone-wallet-position/route.ts) | [receivables-stone](flows/receivables-stone.md) |
| `/api/forms/analytics/admin/aggregates/recompute` | POST | [src/app/api/forms/analytics/admin/aggregates/recompute/route.ts](../../src/app/api/forms/analytics/admin/aggregates/recompute/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/admin/privacy/anonymize-due` | POST | [src/app/api/forms/analytics/admin/privacy/anonymize-due/route.ts](../../src/app/api/forms/analytics/admin/privacy/anonymize-due/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/admin/privacy/backfill` | POST | [src/app/api/forms/analytics/admin/privacy/backfill/route.ts](../../src/app/api/forms/analytics/admin/privacy/backfill/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/admin/reprocess/execute` | POST | [src/app/api/forms/analytics/admin/reprocess/execute/route.ts](../../src/app/api/forms/analytics/admin/reprocess/execute/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/admin/reprocess/simulate` | POST | [src/app/api/forms/analytics/admin/reprocess/simulate/route.ts](../../src/app/api/forms/analytics/admin/reprocess/simulate/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/criteria` | GET, POST | [src/app/api/forms/analytics/criteria/route.ts](../../src/app/api/forms/analytics/criteria/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/criteria/[criterionId]` | PATCH, DELETE | [src/app/api/forms/analytics/criteria/[criterionId]/route.ts](../../src/app/api/forms/analytics/criteria/%5BcriterionId%5D/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/domains` | GET, POST | [src/app/api/forms/analytics/domains/route.ts](../../src/app/api/forms/analytics/domains/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/domains/[domainId]` | PATCH, DELETE | [src/app/api/forms/analytics/domains/[domainId]/route.ts](../../src/app/api/forms/analytics/domains/%5BdomainId%5D/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/jobs/anonymize-due` | GET | [src/app/api/forms/analytics/jobs/anonymize-due/route.ts](../../src/app/api/forms/analytics/jobs/anonymize-due/route.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `/api/forms/analytics/jobs/recompute-daily` | GET | [src/app/api/forms/analytics/jobs/recompute-daily/route.ts](../../src/app/api/forms/analytics/jobs/recompute-daily/route.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `/api/forms/analytics/occurrences` | GET | [src/app/api/forms/analytics/occurrences/route.ts](../../src/app/api/forms/analytics/occurrences/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/occurrences/[occurrenceId]` | GET, PATCH | [src/app/api/forms/analytics/occurrences/[occurrenceId]/route.ts](../../src/app/api/forms/analytics/occurrences/%5BoccurrenceId%5D/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/occurrences/[occurrenceId]/cancel` | POST | [src/app/api/forms/analytics/occurrences/[occurrenceId]/cancel/route.ts](../../src/app/api/forms/analytics/occurrences/%5BoccurrenceId%5D/cancel/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/occurrences/[occurrenceId]/reject-resolution` | POST | [src/app/api/forms/analytics/occurrences/[occurrenceId]/reject-resolution/route.ts](../../src/app/api/forms/analytics/occurrences/%5BoccurrenceId%5D/reject-resolution/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/occurrences/[occurrenceId]/resolve` | POST | [src/app/api/forms/analytics/occurrences/[occurrenceId]/resolve/route.ts](../../src/app/api/forms/analytics/occurrences/%5BoccurrenceId%5D/resolve/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/occurrences/[occurrenceId]/validate-resolution` | POST | [src/app/api/forms/analytics/occurrences/[occurrenceId]/validate-resolution/route.ts](../../src/app/api/forms/analytics/occurrences/%5BoccurrenceId%5D/validate-resolution/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/occurrences/export.csv` | GET | [src/app/api/forms/analytics/occurrences/export.csv/route.ts](../../src/app/api/forms/analytics/occurrences/export.csv/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/results` | GET, POST | [src/app/api/forms/analytics/results/route.ts](../../src/app/api/forms/analytics/results/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/results/[resultId]` | PATCH, DELETE | [src/app/api/forms/analytics/results/[resultId]/route.ts](../../src/app/api/forms/analytics/results/%5BresultId%5D/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/retention-policies` | GET, POST | [src/app/api/forms/analytics/retention-policies/route.ts](../../src/app/api/forms/analytics/retention-policies/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/retention-policies/[policyId]` | PATCH | [src/app/api/forms/analytics/retention-policies/[policyId]/route.ts](../../src/app/api/forms/analytics/retention-policies/%5BpolicyId%5D/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/seed` | POST | [src/app/api/forms/analytics/seed/route.ts](../../src/app/api/forms/analytics/seed/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/summary` | GET | [src/app/api/forms/analytics/summary/route.ts](../../src/app/api/forms/analytics/summary/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/targets` | GET, POST | [src/app/api/forms/analytics/targets/route.ts](../../src/app/api/forms/analytics/targets/route.ts) | [forms](flows/forms.md) |
| `/api/forms/analytics/targets/[targetId]` | PATCH, DELETE | [src/app/api/forms/analytics/targets/[targetId]/route.ts](../../src/app/api/forms/analytics/targets/%5BtargetId%5D/route.ts) | [forms](flows/forms.md) |
| `/api/forms/bootstrap` | GET | [src/app/api/forms/bootstrap/route.ts](../../src/app/api/forms/bootstrap/route.ts) | [forms](flows/forms.md) |
| `/api/forms/events/trigger` | POST | [src/app/api/forms/events/trigger/route.ts](../../src/app/api/forms/events/trigger/route.ts) | [forms](flows/forms.md) |
| `/api/forms/executions` | GET, POST | [src/app/api/forms/executions/route.ts](../../src/app/api/forms/executions/route.ts) | [forms](flows/forms.md) |
| `/api/forms/executions/[executionId]` | GET, PATCH | [src/app/api/forms/executions/[executionId]/route.ts](../../src/app/api/forms/executions/%5BexecutionId%5D/route.ts) | [forms](flows/forms.md) |
| `/api/forms/executions/[executionId]/claim` | POST | [src/app/api/forms/executions/[executionId]/claim/route.ts](../../src/app/api/forms/executions/%5BexecutionId%5D/claim/route.ts) | [forms](flows/forms.md) |
| `/api/forms/models` | GET, POST | [src/app/api/forms/models/route.ts](../../src/app/api/forms/models/route.ts) | [forms](flows/forms.md) |
| `/api/forms/models/[modelId]` | PATCH, DELETE | [src/app/api/forms/models/[modelId]/route.ts](../../src/app/api/forms/models/%5BmodelId%5D/route.ts) | [forms](flows/forms.md) |
| `/api/forms/navigation` | GET | [src/app/api/forms/navigation/route.ts](../../src/app/api/forms/navigation/route.ts) | [forms](flows/forms.md) |
| `/api/forms/projects` | GET, POST | [src/app/api/forms/projects/route.ts](../../src/app/api/forms/projects/route.ts) | [forms](flows/forms.md) |
| `/api/forms/projects/[projectId]` | PATCH, DELETE | [src/app/api/forms/projects/[projectId]/route.ts](../../src/app/api/forms/projects/%5BprojectId%5D/route.ts) | [forms](flows/forms.md) |
| `/api/forms/projects/ensure-units` | POST | [src/app/api/forms/projects/ensure-units/route.ts](../../src/app/api/forms/projects/ensure-units/route.ts) | [forms](flows/forms.md) |
| `/api/forms/scheduler` | POST | [src/app/api/forms/scheduler/route.ts](../../src/app/api/forms/scheduler/route.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `/api/forms/subtypes` | GET, POST | [src/app/api/forms/subtypes/route.ts](../../src/app/api/forms/subtypes/route.ts) | [forms](flows/forms.md) |
| `/api/forms/subtypes/[subtypeId]` | GET, PATCH | [src/app/api/forms/subtypes/[subtypeId]/route.ts](../../src/app/api/forms/subtypes/%5BsubtypeId%5D/route.ts) | [forms](flows/forms.md) |
| `/api/forms/templates` | GET, POST | [src/app/api/forms/templates/route.ts](../../src/app/api/forms/templates/route.ts) | [forms](flows/forms.md) |
| `/api/forms/templates/[templateId]` | GET, PATCH | [src/app/api/forms/templates/[templateId]/route.ts](../../src/app/api/forms/templates/%5BtemplateId%5D/route.ts) | [forms](flows/forms.md) |
| `/api/forms/templates/[templateId]/application` | GET, PATCH | [src/app/api/forms/templates/[templateId]/application/route.ts](../../src/app/api/forms/templates/%5BtemplateId%5D/application/route.ts) | [forms](flows/forms.md) |
| `/api/forms/types` | GET, POST | [src/app/api/forms/types/route.ts](../../src/app/api/forms/types/route.ts) | [forms](flows/forms.md) |
| `/api/forms/types/[typeId]` | GET, PATCH | [src/app/api/forms/types/[typeId]/route.ts](../../src/app/api/forms/types/%5BtypeId%5D/route.ts) | [forms](flows/forms.md) |
| `/api/forms/upload` | POST, PATCH | [src/app/api/forms/upload/route.ts](../../src/app/api/forms/upload/route.ts) | [forms](flows/forms.md) |
| `/api/hr/accountant/[token]` | GET, POST | [src/app/api/hr/accountant/[token]/route.ts](../../src/app/api/hr/accountant/%5Btoken%5D/route.ts) | [onboarding-accountant](flows/onboarding-accountant.md) |
| `/api/hr/apply` | POST | [src/app/api/hr/apply/route.ts](../../src/app/api/hr/apply/route.ts) | [recruitment](flows/recruitment.md) |
| `/api/hr/aso-clinics` | GET, POST | [src/app/api/hr/aso-clinics/route.ts](../../src/app/api/hr/aso-clinics/route.ts) | [onboarding-aso](flows/onboarding-aso.md) |
| `/api/hr/aso/candidate/[token]` | GET, POST | [src/app/api/hr/aso/candidate/[token]/route.ts](../../src/app/api/hr/aso/candidate/%5Btoken%5D/route.ts) | [onboarding-aso](flows/onboarding-aso.md) |
| `/api/hr/aso/clinic/[token]` | GET, POST | [src/app/api/hr/aso/clinic/[token]/route.ts](../../src/app/api/hr/aso/clinic/%5Btoken%5D/route.ts) | [onboarding-aso](flows/onboarding-aso.md) |
| `/api/hr/bootstrap` | GET | [src/app/api/hr/bootstrap/route.ts](../../src/app/api/hr/bootstrap/route.ts) | [recruitment](flows/recruitment.md) |
| `/api/hr/candidates` | GET, POST | [src/app/api/hr/candidates/route.ts](../../src/app/api/hr/candidates/route.ts) | [recruitment](flows/recruitment.md) |
| `/api/hr/candidates/[id]` | PATCH, DELETE | [src/app/api/hr/candidates/[id]/route.ts](../../src/app/api/hr/candidates/%5Bid%5D/route.ts) | [recruitment](flows/recruitment.md) |
| `/api/hr/candidates/[id]/profile` | GET | [src/app/api/hr/candidates/[id]/profile/route.ts](../../src/app/api/hr/candidates/%5Bid%5D/profile/route.ts) | [recruitment](flows/recruitment.md) |
| `/api/hr/collaborators/[userId]/pdv-access` | PATCH, DELETE | [src/app/api/hr/collaborators/[userId]/pdv-access/route.ts](../../src/app/api/hr/collaborators/%5BuserId%5D/pdv-access/route.ts) | [people-access](flows/people-access.md) |
| `/api/hr/consents/image-voice/[employeeId]` | GET, POST | [src/app/api/hr/consents/image-voice/[employeeId]/route.ts](../../src/app/api/hr/consents/image-voice/%5BemployeeId%5D/route.ts) | [consents](flows/consents.md) |
| `/api/hr/departments` | GET, POST | [src/app/api/hr/departments/route.ts](../../src/app/api/hr/departments/route.ts) | [organization](flows/organization.md) |
| `/api/hr/departments/[departmentId]` | PATCH | [src/app/api/hr/departments/[departmentId]/route.ts](../../src/app/api/hr/departments/%5BdepartmentId%5D/route.ts) | [organization](flows/organization.md) |
| `/api/hr/employee-documents` | GET, POST, PATCH, DELETE | [src/app/api/hr/employee-documents/route.ts](../../src/app/api/hr/employee-documents/route.ts) | [employee-documents](flows/employee-documents.md) |
| `/api/hr/employee-documents/access` | POST | [src/app/api/hr/employee-documents/access/route.ts](../../src/app/api/hr/employee-documents/access/route.ts) | [employee-documents](flows/employee-documents.md) |
| `/api/hr/employee-documents/analyze-upload` | POST | [src/app/api/hr/employee-documents/analyze-upload/route.ts](../../src/app/api/hr/employee-documents/analyze-upload/route.ts) | [employee-documents](flows/employee-documents.md) |
| `/api/hr/employee-documents/batches` | GET | [src/app/api/hr/employee-documents/batches/route.ts](../../src/app/api/hr/employee-documents/batches/route.ts) | [employee-documents](flows/employee-documents.md) |
| `/api/hr/employee-documents/cleanup` | POST | [src/app/api/hr/employee-documents/cleanup/route.ts](../../src/app/api/hr/employee-documents/cleanup/route.ts) | [employee-documents](flows/employee-documents.md) |
| `/api/hr/employee-documents/confirm` | POST | [src/app/api/hr/employee-documents/confirm/route.ts](../../src/app/api/hr/employee-documents/confirm/route.ts) | [employee-documents](flows/employee-documents.md) |
| `/api/hr/employee-documents/item` | PATCH | [src/app/api/hr/employee-documents/item/route.ts](../../src/app/api/hr/employee-documents/item/route.ts) | [employee-documents](flows/employee-documents.md) |
| `/api/hr/employee-documents/reanalyze` | POST | [src/app/api/hr/employee-documents/reanalyze/route.ts](../../src/app/api/hr/employee-documents/reanalyze/route.ts) | [employee-documents](flows/employee-documents.md) |
| `/api/hr/employee-documents/summary` | GET | [src/app/api/hr/employee-documents/summary/route.ts](../../src/app/api/hr/employee-documents/summary/route.ts) | [employee-documents](flows/employee-documents.md) |
| `/api/hr/employee-documents/visibility` | GET, PUT | [src/app/api/hr/employee-documents/visibility/route.ts](../../src/app/api/hr/employee-documents/visibility/route.ts) | [employee-documents](flows/employee-documents.md) |
| `/api/hr/functions` | GET, POST | [src/app/api/hr/functions/route.ts](../../src/app/api/hr/functions/route.ts) | [organization](flows/organization.md) |
| `/api/hr/functions/[functionId]` | PATCH | [src/app/api/hr/functions/[functionId]/route.ts](../../src/app/api/hr/functions/%5BfunctionId%5D/route.ts) | [organization](flows/organization.md) |
| `/api/hr/integration-templates` | GET, POST | [src/app/api/hr/integration-templates/route.ts](../../src/app/api/hr/integration-templates/route.ts) | [onboarding-training](flows/onboarding-training.md) |
| `/api/hr/integration-templates/[templateId]` | GET, PATCH, DELETE | [src/app/api/hr/integration-templates/[templateId]/route.ts](../../src/app/api/hr/integration-templates/%5BtemplateId%5D/route.ts) | [onboarding-training](flows/onboarding-training.md) |
| `/api/hr/integration-templates/[templateId]/publish` | POST | [src/app/api/hr/integration-templates/[templateId]/publish/route.ts](../../src/app/api/hr/integration-templates/%5BtemplateId%5D/publish/route.ts) | [onboarding-training](flows/onboarding-training.md) |
| `/api/hr/integration-templates/[templateId]/versions/[version]` | GET | [src/app/api/hr/integration-templates/[templateId]/versions/[version]/route.ts](../../src/app/api/hr/integration-templates/%5BtemplateId%5D/versions/%5Bversion%5D/route.ts) | [onboarding-training](flows/onboarding-training.md) |
| `/api/hr/integrations/pdvlegal/catalog` | GET | [src/app/api/hr/integrations/pdvlegal/catalog/route.ts](../../src/app/api/hr/integrations/pdvlegal/catalog/route.ts) | [people-access](flows/people-access.md) |
| `/api/hr/login-access` | GET, POST | [src/app/api/hr/login-access/route.ts](../../src/app/api/hr/login-access/route.ts) | [access-and-privacy](access-and-privacy.md) |
| `/api/hr/login-access/audit` | GET | [src/app/api/hr/login-access/audit/route.ts](../../src/app/api/hr/login-access/audit/route.ts) | [access-and-privacy](access-and-privacy.md) |
| `/api/hr/navigation` | GET | [src/app/api/hr/navigation/route.ts](../../src/app/api/hr/navigation/route.ts) | [recruitment](flows/recruitment.md) |
| `/api/hr/onboarding` | GET, POST | [src/app/api/hr/onboarding/route.ts](../../src/app/api/hr/onboarding/route.ts) | [onboarding-stage-control](flows/onboarding-stage-control.md) |
| `/api/hr/onboarding/[id]` | GET, PATCH | [src/app/api/hr/onboarding/[id]/route.ts](../../src/app/api/hr/onboarding/%5Bid%5D/route.ts) | [onboarding-stage-control](flows/onboarding-stage-control.md) |
| `/api/hr/onboarding/[id]/accountant-form` | POST | [src/app/api/hr/onboarding/[id]/accountant-form/route.tsx](../../src/app/api/hr/onboarding/%5Bid%5D/accountant-form/route.tsx) | [onboarding-accountant](flows/onboarding-accountant.md) |
| `/api/hr/onboarding/[id]/accountant-workflow` | GET, POST, PATCH | [src/app/api/hr/onboarding/[id]/accountant-workflow/route.ts](../../src/app/api/hr/onboarding/%5Bid%5D/accountant-workflow/route.ts) | [onboarding-accountant](flows/onboarding-accountant.md) |
| `/api/hr/onboarding/[id]/aso-guide` | POST | [src/app/api/hr/onboarding/[id]/aso-guide/route.tsx](../../src/app/api/hr/onboarding/%5Bid%5D/aso-guide/route.tsx) | [onboarding-aso](flows/onboarding-aso.md) |
| `/api/hr/onboarding/[id]/aso-workflow` | GET, PATCH | [src/app/api/hr/onboarding/[id]/aso-workflow/route.ts](../../src/app/api/hr/onboarding/%5Bid%5D/aso-workflow/route.ts) | [onboarding-aso](flows/onboarding-aso.md) |
| `/api/hr/onboarding/[id]/integration` | GET, PATCH | [src/app/api/hr/onboarding/[id]/integration/route.ts](../../src/app/api/hr/onboarding/%5Bid%5D/integration/route.ts) | [onboarding-training](flows/onboarding-training.md) |
| `/api/hr/onboarding/[id]/pj-workflow` | GET, PATCH | [src/app/api/hr/onboarding/[id]/pj-workflow/route.ts](../../src/app/api/hr/onboarding/%5Bid%5D/pj-workflow/route.ts) | [onboarding-pj-workflow](flows/onboarding-pj-workflow.md) |
| `/api/hr/onboarding/[id]/probation` | GET, PATCH | [src/app/api/hr/onboarding/[id]/probation/route.ts](../../src/app/api/hr/onboarding/%5Bid%5D/probation/route.ts) | [onboarding-training](flows/onboarding-training.md) |
| `/api/hr/onboarding/[id]/signature-documents` | GET, POST | [src/app/api/hr/onboarding/[id]/signature-documents/route.ts](../../src/app/api/hr/onboarding/%5Bid%5D/signature-documents/route.ts) | [onboarding-signatures](flows/onboarding-signatures.md) |
| `/api/hr/onboarding/[id]/training` | PATCH | [src/app/api/hr/onboarding/[id]/training/route.ts](../../src/app/api/hr/onboarding/%5Bid%5D/training/route.ts) | [onboarding-training](flows/onboarding-training.md) |
| `/api/hr/onboarding/access-catalog` | GET | [src/app/api/hr/onboarding/access-catalog/route.ts](../../src/app/api/hr/onboarding/access-catalog/route.ts) | [onboarding-stage-control](flows/onboarding-stage-control.md) |
| `/api/hr/onboarding/public/[token]` | GET, POST | [src/app/api/hr/onboarding/public/[token]/route.ts](../../src/app/api/hr/onboarding/public/%5Btoken%5D/route.ts) | [onboarding-public-documents](flows/onboarding-public-documents.md) |
| `/api/hr/openings` | GET, POST | [src/app/api/hr/openings/route.ts](../../src/app/api/hr/openings/route.ts) | [recruitment](flows/recruitment.md) |
| `/api/hr/openings/[id]` | PATCH, DELETE | [src/app/api/hr/openings/[id]/route.ts](../../src/app/api/hr/openings/%5Bid%5D/route.ts) | [recruitment](flows/recruitment.md) |
| `/api/hr/openings/public` | GET | [src/app/api/hr/openings/public/route.ts](../../src/app/api/hr/openings/public/route.ts) | [recruitment](flows/recruitment.md) |
| `/api/hr/probation/alerts` | POST | [src/app/api/hr/probation/alerts/route.ts](../../src/app/api/hr/probation/alerts/route.ts) | [onboarding-training](flows/onboarding-training.md) |
| `/api/hr/public-stats` | GET | [src/app/api/hr/public-stats/route.ts](../../src/app/api/hr/public-stats/route.ts) | [recruitment](flows/recruitment.md) |
| `/api/hr/recruitment/forms/talent-pool` | GET, PATCH | [src/app/api/hr/recruitment/forms/talent-pool/route.ts](../../src/app/api/hr/recruitment/forms/talent-pool/route.ts) | [recruitment](flows/recruitment.md) |
| `/api/hr/recruitment/forms/talent-pool/public` | GET | [src/app/api/hr/recruitment/forms/talent-pool/public/route.ts](../../src/app/api/hr/recruitment/forms/talent-pool/public/route.ts) | [recruitment](flows/recruitment.md) |
| `/api/hr/roles` | GET, POST | [src/app/api/hr/roles/route.ts](../../src/app/api/hr/roles/route.ts) | [organization](flows/organization.md) |
| `/api/hr/roles/[roleId]` | PATCH | [src/app/api/hr/roles/[roleId]/route.ts](../../src/app/api/hr/roles/%5BroleId%5D/route.ts) | [organization](flows/organization.md) |
| `/api/hr/roles/[roleId]/sync-profile` | POST | [src/app/api/hr/roles/[roleId]/sync-profile/route.ts](../../src/app/api/hr/roles/%5BroleId%5D/sync-profile/route.ts) | [organization](flows/organization.md) |
| `/api/hr/talent` | POST | [src/app/api/hr/talent/route.ts](../../src/app/api/hr/talent/route.ts) | [recruitment](flows/recruitment.md) |
| `/api/hr/termination-accountant/[token]` | GET, POST | [src/app/api/hr/termination-accountant/[token]/route.ts](../../src/app/api/hr/termination-accountant/%5Btoken%5D/route.ts) | [termination-audit-payment-closure](flows/termination-audit-payment-closure.md) |
| `/api/hr/termination-documents/[token]` | GET | [src/app/api/hr/termination-documents/[token]/route.ts](../../src/app/api/hr/termination-documents/%5Btoken%5D/route.ts) | [termination-audit-payment-closure](flows/termination-audit-payment-closure.md) |
| `/api/hr/terminations` | GET, POST | [src/app/api/hr/terminations/route.ts](../../src/app/api/hr/terminations/route.ts) | [termination-audit-payment-closure](flows/termination-audit-payment-closure.md) |
| `/api/hr/terminations/[id]` | GET, PATCH | [src/app/api/hr/terminations/[id]/route.ts](../../src/app/api/hr/terminations/%5Bid%5D/route.ts) | [termination-audit-payment-closure](flows/termination-audit-payment-closure.md) |
| `/api/hr/terminations/[id]/asset` | GET | [src/app/api/hr/terminations/[id]/asset/route.ts](../../src/app/api/hr/terminations/%5Bid%5D/asset/route.ts) | [termination-audit-payment-closure](flows/termination-audit-payment-closure.md) |
| `/api/hr/terminations/[id]/letter` | POST | [src/app/api/hr/terminations/[id]/letter/route.ts](../../src/app/api/hr/terminations/%5Bid%5D/letter/route.ts) | [termination-audit-payment-closure](flows/termination-audit-payment-closure.md) |
| `/api/hr/upload` | POST | [src/app/api/hr/upload/route.ts](../../src/app/api/hr/upload/route.ts) | [recruitment](flows/recruitment.md) |
| `/api/hr/vacation-accountant/[token]` | GET, POST | [src/app/api/hr/vacation-accountant/[token]/route.ts](../../src/app/api/hr/vacation-accountant/%5Btoken%5D/route.ts) | [vacation-accountant-dispatch](flows/vacation-accountant-dispatch.md) |
| `/api/integrations/bizneo/push-schedule` | POST | [src/app/api/integrations/bizneo/push-schedule/route.ts](../../src/app/api/integrations/bizneo/push-schedule/route.ts) | [dp-schedules](flows/dp-schedules.md) |
| `/api/integrations/bizneo/shift-templates` | GET | [src/app/api/integrations/bizneo/shift-templates/route.ts](../../src/app/api/integrations/bizneo/shift-templates/route.ts) | [dp-schedules](flows/dp-schedules.md) |
| `/api/integrations/bizneo/sync-taxons` | GET | [src/app/api/integrations/bizneo/sync-taxons/route.ts](../../src/app/api/integrations/bizneo/sync-taxons/route.ts) | [rh-bizneo](flows/rh-bizneo.md) |
| `/api/integrations/bizneo/sync-users` | GET | [src/app/api/integrations/bizneo/sync-users/route.ts](../../src/app/api/integrations/bizneo/sync-users/route.ts) | [rh-bizneo](flows/rh-bizneo.md) |
| `/api/integrations/pdvlegal/filiais` | GET | [src/app/api/integrations/pdvlegal/filiais/route.ts](../../src/app/api/integrations/pdvlegal/filiais/route.ts) | [pdv-sync](flows/pdv-sync.md) |
| `/api/integrations/pdvlegal/inspect` | GET | [src/app/api/integrations/pdvlegal/inspect/route.ts](../../src/app/api/integrations/pdvlegal/inspect/route.ts) | [pdv-sync](flows/pdv-sync.md) |
| `/api/integrations/pdvlegal/sync` | GET | [src/app/api/integrations/pdvlegal/sync/route.ts](../../src/app/api/integrations/pdvlegal/sync/route.ts) | [pdv-sync](flows/pdv-sync.md) |
| `/api/jobs/cash-closures/daily-sync` | POST | [src/app/api/jobs/cash-closures/daily-sync/route.ts](../../src/app/api/jobs/cash-closures/daily-sync/route.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `/api/jobs/cash-deposits/reconcile` | POST | [src/app/api/jobs/cash-deposits/reconcile/route.ts](../../src/app/api/jobs/cash-deposits/reconcile/route.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `/api/jobs/documents/retention-reconcile` | POST | [src/app/api/jobs/documents/retention-reconcile/route.ts](../../src/app/api/jobs/documents/retention-reconcile/route.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `/api/jobs/financial-budgets/generate` | POST | [src/app/api/jobs/financial-budgets/generate/route.ts](../../src/app/api/jobs/financial-budgets/generate/route.ts) | [financial-budgets](flows/financial-budgets.md) |
| `/api/jobs/financial-inbox/maintenance` | POST | [src/app/api/jobs/financial-inbox/maintenance/route.ts](../../src/app/api/jobs/financial-inbox/maintenance/route.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `/api/jobs/inter/cobrancas/reconcile` | POST | [src/app/api/jobs/inter/cobrancas/reconcile/route.ts](../../src/app/api/jobs/inter/cobrancas/reconcile/route.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `/api/jobs/inter/reconcile` | POST | [src/app/api/jobs/inter/reconcile/route.ts](../../src/app/api/jobs/inter/reconcile/route.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `/api/jobs/inter/statements/sync` | POST | [src/app/api/jobs/inter/statements/sync/route.ts](../../src/app/api/jobs/inter/statements/sync/route.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `/api/mercadorias` | GET | [src/app/api/mercadorias/route.ts](../../src/app/api/mercadorias/route.ts) | [registry](flows/registry.md) |
| `/api/mercadorias/export` | GET | [src/app/api/mercadorias/export/route.ts](../../src/app/api/mercadorias/export/route.ts) | [registry](flows/registry.md) |
| `/api/observability/client-errors` | POST | [src/app/api/observability/client-errors/route.ts](../../src/app/api/observability/client-errors/route.ts) | [observability](observability.md) |
| `/api/privacy/incidents` | GET, POST | [src/app/api/privacy/incidents/route.ts](../../src/app/api/privacy/incidents/route.ts) | [access-and-privacy](access-and-privacy.md) |
| `/api/privacy/incidents/[id]` | PATCH | [src/app/api/privacy/incidents/[id]/route.ts](../../src/app/api/privacy/incidents/%5Bid%5D/route.ts) | [access-and-privacy](access-and-privacy.md) |
| `/api/privacy/requests` | GET, POST | [src/app/api/privacy/requests/route.ts](../../src/app/api/privacy/requests/route.ts) | [access-and-privacy](access-and-privacy.md) |
| `/api/privacy/requests/[id]` | PATCH | [src/app/api/privacy/requests/[id]/route.ts](../../src/app/api/privacy/requests/%5Bid%5D/route.ts) | [access-and-privacy](access-and-privacy.md) |
| `/api/processes` | GET | [src/app/api/processes/route.ts](../../src/app/api/processes/route.ts) | [termination-process-center](flows/termination-process-center.md) |
| `/api/products` | POST | [src/app/api/products/route.ts](../../src/app/api/products/route.ts) | [registry](flows/registry.md) |
| `/api/products/[id]` | PUT | [src/app/api/products/[id]/route.ts](../../src/app/api/products/%5Bid%5D/route.ts) | [registry](flows/registry.md) |
| `/api/products/barcode/[codigo]` | GET | [src/app/api/products/barcode/[codigo]/route.ts](../../src/app/api/products/barcode/%5Bcodigo%5D/route.ts) | [registry](flows/registry.md) |
| `/api/products/barcode/[codigo]/sources` | GET | [src/app/api/products/barcode/[codigo]/sources/route.ts](../../src/app/api/products/barcode/%5Bcodigo%5D/sources/route.ts) | [registry](flows/registry.md) |
| `/api/profile-compliance` | GET, POST | [src/app/api/profile-compliance/route.ts](../../src/app/api/profile-compliance/route.ts) | [access-and-privacy](access-and-privacy.md) |
| `/api/profile-compliance/overview` | GET | [src/app/api/profile-compliance/overview/route.ts](../../src/app/api/profile-compliance/overview/route.ts) | [access-and-privacy](access-and-privacy.md) |
| `/api/public/bio` | GET | [src/app/api/public/bio/route.ts](../../src/app/api/public/bio/route.ts) | [settings](flows/settings.md) |
| `/api/public/bio/media/[id]` | GET | [src/app/api/public/bio/media/[id]/route.ts](../../src/app/api/public/bio/media/%5Bid%5D/route.ts) | [settings](flows/settings.md) |
| `/api/purchasing/[...path]` | GET, POST, PATCH, DELETE | [src/app/api/purchasing/[...path]/route.ts](../../src/app/api/purchasing/%5B...path%5D/route.ts) | [purchasing-order-receipt](flows/purchasing-order-receipt.md) |
| `/api/registry/[...path]` | GET, POST, PATCH, DELETE | [src/app/api/registry/[...path]/route.ts](../../src/app/api/registry/%5B...path%5D/route.ts) | [registry](flows/registry.md) |
| `/api/registry/cnpj/[cnpj]` | GET | [src/app/api/registry/cnpj/[cnpj]/route.ts](../../src/app/api/registry/cnpj/%5Bcnpj%5D/route.ts) | [registry](flows/registry.md) |
| `/api/rh/employee-profile/[employeeId]` | GET | [src/app/api/rh/employee-profile/[employeeId]/route.ts](../../src/app/api/rh/employee-profile/%5BemployeeId%5D/route.ts) | [rh-bizneo](flows/rh-bizneo.md) |
| `/api/rh/employee-profile/[employeeId]/image-voice-consent` | POST | [src/app/api/rh/employee-profile/[employeeId]/image-voice-consent/route.ts](../../src/app/api/rh/employee-profile/%5BemployeeId%5D/image-voice-consent/route.ts) | [rh-bizneo](flows/rh-bizneo.md) |
| `/api/rh/field-map` | GET, PUT | [src/app/api/rh/field-map/route.ts](../../src/app/api/rh/field-map/route.ts) | [rh-bizneo](flows/rh-bizneo.md) |
| `/api/settings/ai-management` | GET | [src/app/api/settings/ai-management/route.ts](../../src/app/api/settings/ai-management/route.ts) | [settings](flows/settings.md) |
| `/api/settings/public-bio` | GET, PUT | [src/app/api/settings/public-bio/route.ts](../../src/app/api/settings/public-bio/route.ts) | [settings](flows/settings.md) |
| `/api/settings/public-bio/media` | POST | [src/app/api/settings/public-bio/media/route.ts](../../src/app/api/settings/public-bio/media/route.ts) | [settings](flows/settings.md) |
| `/api/settings/public-bio/media/[id]` | GET | [src/app/api/settings/public-bio/media/[id]/route.ts](../../src/app/api/settings/public-bio/media/%5Bid%5D/route.ts) | [settings](flows/settings.md) |
| `/api/signage/asset/[...assetPath]` | GET | [src/app/api/signage/asset/[...assetPath]/route.ts](../../src/app/api/signage/asset/%5B...assetPath%5D/route.ts) | [signage](flows/signage.md) |
| `/api/signage/heartbeat` | GET, POST | [src/app/api/signage/heartbeat/route.ts](../../src/app/api/signage/heartbeat/route.ts) | [signage](flows/signage.md) |
| `/api/signage/public/[kioskId]` | GET | [src/app/api/signage/public/[kioskId]/route.ts](../../src/app/api/signage/public/%5BkioskId%5D/route.ts) | [signage](flows/signage.md) |
| `/api/signage/publish` | POST | [src/app/api/signage/publish/route.ts](../../src/app/api/signage/publish/route.ts) | [signage](flows/signage.md) |
| `/api/signage/slides` | GET, POST | [src/app/api/signage/slides/route.ts](../../src/app/api/signage/slides/route.ts) | [signage](flows/signage.md) |
| `/api/signage/slides/[slideId]` | PUT, DELETE | [src/app/api/signage/slides/[slideId]/route.ts](../../src/app/api/signage/slides/%5BslideId%5D/route.ts) | [signage](flows/signage.md) |
| `/api/signage/upload` | POST | [src/app/api/signage/upload/route.ts](../../src/app/api/signage/upload/route.ts) | [signage](flows/signage.md) |
| `/api/stock/count-sessions` | GET | [src/app/api/stock/count-sessions/route.ts](../../src/app/api/stock/count-sessions/route.ts) | [stock-count](flows/stock-count.md) |
| `/api/stock/item-requests` | GET, POST | [src/app/api/stock/item-requests/route.ts](../../src/app/api/stock/item-requests/route.ts) | [stock-requests-reposition-returns](flows/stock-requests-reposition-returns.md) |
| `/api/stock/item-requests/[requestId]` | PATCH, DELETE | [src/app/api/stock/item-requests/[requestId]/route.ts](../../src/app/api/stock/item-requests/%5BrequestId%5D/route.ts) | [stock-requests-reposition-returns](flows/stock-requests-reposition-returns.md) |
| `/api/stock/movement-history` | GET | [src/app/api/stock/movement-history/route.ts](../../src/app/api/stock/movement-history/route.ts) | [stock-control](flows/stock-control.md) |
| `/api/stock/reposition-activities` | GET, POST | [src/app/api/stock/reposition-activities/route.ts](../../src/app/api/stock/reposition-activities/route.ts) | [stock-requests-reposition-returns](flows/stock-requests-reposition-returns.md) |
| `/api/stock/reposition-activities/[activityId]` | PATCH, DELETE | [src/app/api/stock/reposition-activities/[activityId]/route.ts](../../src/app/api/stock/reposition-activities/%5BactivityId%5D/route.ts) | [stock-requests-reposition-returns](flows/stock-requests-reposition-returns.md) |
| `/api/stock/reposition-activities/[activityId]/finalize` | POST | [src/app/api/stock/reposition-activities/[activityId]/finalize/route.ts](../../src/app/api/stock/reposition-activities/%5BactivityId%5D/finalize/route.ts) | [stock-requests-reposition-returns](flows/stock-requests-reposition-returns.md) |
| `/api/stock/reposition-activities/[activityId]/reopen-audit` | POST | [src/app/api/stock/reposition-activities/[activityId]/reopen-audit/route.ts](../../src/app/api/stock/reposition-activities/%5BactivityId%5D/reopen-audit/route.ts) | [stock-requests-reposition-returns](flows/stock-requests-reposition-returns.md) |
| `/api/stock/reposition-activities/[activityId]/reopen-dispatch` | POST | [src/app/api/stock/reposition-activities/[activityId]/reopen-dispatch/route.ts](../../src/app/api/stock/reposition-activities/%5BactivityId%5D/reopen-dispatch/route.ts) | [stock-requests-reposition-returns](flows/stock-requests-reposition-returns.md) |
| `/api/stock/reposition-activities/[activityId]/revert` | POST | [src/app/api/stock/reposition-activities/[activityId]/revert/route.ts](../../src/app/api/stock/reposition-activities/%5BactivityId%5D/revert/route.ts) | [stock-requests-reposition-returns](flows/stock-requests-reposition-returns.md) |
| `/api/stock/reposition-requests` | GET, POST | [src/app/api/stock/reposition-requests/route.ts](../../src/app/api/stock/reposition-requests/route.ts) | [stock-requests-reposition-returns](flows/stock-requests-reposition-returns.md) |
| `/api/stock/reposition-requests/[requestId]` | PATCH | [src/app/api/stock/reposition-requests/[requestId]/route.ts](../../src/app/api/stock/reposition-requests/%5BrequestId%5D/route.ts) | [stock-requests-reposition-returns](flows/stock-requests-reposition-returns.md) |
| `/api/stock/return-requests` | GET, POST | [src/app/api/stock/return-requests/route.ts](../../src/app/api/stock/return-requests/route.ts) | [stock-requests-reposition-returns](flows/stock-requests-reposition-returns.md) |
| `/api/stock/return-requests/[requestId]` | PATCH, DELETE | [src/app/api/stock/return-requests/[requestId]/route.ts](../../src/app/api/stock/return-requests/%5BrequestId%5D/route.ts) | [stock-requests-reposition-returns](flows/stock-requests-reposition-returns.md) |
| `/api/tasks` | GET, POST | [src/app/api/tasks/route.ts](../../src/app/api/tasks/route.ts) | [tasks](flows/tasks.md) |
| `/api/tasks/[taskId]` | PATCH, DELETE | [src/app/api/tasks/[taskId]/route.ts](../../src/app/api/tasks/%5BtaskId%5D/route.ts) | [tasks](flows/tasks.md) |
| `/api/tasks/[taskId]/status` | PATCH | [src/app/api/tasks/[taskId]/status/route.ts](../../src/app/api/tasks/%5BtaskId%5D/status/route.ts) | [tasks](flows/tasks.md) |
| `/api/tasks/navigation` | GET | [src/app/api/tasks/navigation/route.ts](../../src/app/api/tasks/navigation/route.ts) | [tasks](flows/tasks.md) |
| `/api/tasks/projects` | GET, POST | [src/app/api/tasks/projects/route.ts](../../src/app/api/tasks/projects/route.ts) | [tasks](flows/tasks.md) |
| `/api/tasks/projects/[projectId]` | PATCH, DELETE | [src/app/api/tasks/projects/[projectId]/route.ts](../../src/app/api/tasks/projects/%5BprojectId%5D/route.ts) | [tasks](flows/tasks.md) |
| `/api/tasks/purchase-receipt-sync` | POST | [src/app/api/tasks/purchase-receipt-sync/route.ts](../../src/app/api/tasks/purchase-receipt-sync/route.ts) | [tasks](flows/tasks.md) |
| `/api/tasks/statuses` | GET, POST | [src/app/api/tasks/statuses/route.ts](../../src/app/api/tasks/statuses/route.ts) | [tasks](flows/tasks.md) |
| `/api/tasks/statuses/[statusId]` | PATCH, DELETE | [src/app/api/tasks/statuses/[statusId]/route.ts](../../src/app/api/tasks/statuses/%5BstatusId%5D/route.ts) | [tasks](flows/tasks.md) |
| `/api/tasks/subprojects` | GET, POST | [src/app/api/tasks/subprojects/route.ts](../../src/app/api/tasks/subprojects/route.ts) | [tasks](flows/tasks.md) |
| `/api/tasks/subprojects/[subprojectId]` | PATCH, DELETE | [src/app/api/tasks/subprojects/[subprojectId]/route.ts](../../src/app/api/tasks/subprojects/%5BsubprojectId%5D/route.ts) | [tasks](flows/tasks.md) |
| `/api/uniforms` | GET, PATCH | [src/app/api/uniforms/route.ts](../../src/app/api/uniforms/route.ts) | [uniforms](flows/uniforms.md) |
| `/api/uniforms/deliver` | POST | [src/app/api/uniforms/deliver/route.ts](../../src/app/api/uniforms/deliver/route.ts) | [uniforms](flows/uniforms.md) |
| `/api/uniforms/exchange` | POST | [src/app/api/uniforms/exchange/route.ts](../../src/app/api/uniforms/exchange/route.ts) | [uniforms](flows/uniforms.md) |
| `/api/uniforms/return` | POST | [src/app/api/uniforms/return/route.ts](../../src/app/api/uniforms/return/route.ts) | [uniforms](flows/uniforms.md) |
| `/api/uniforms/terms/[id]` | GET | [src/app/api/uniforms/terms/[id]/route.ts](../../src/app/api/uniforms/terms/%5Bid%5D/route.ts) | [uniforms](flows/uniforms.md) |
| `/api/uploads/operations` | POST | [src/app/api/uploads/operations/route.ts](../../src/app/api/uploads/operations/route.ts) | [access-and-privacy](access-and-privacy.md) |
| `/api/users` | POST | [src/app/api/users/route.ts](../../src/app/api/users/route.ts) | [people-access](flows/people-access.md) |
| `/api/users/[userId]` | PATCH | [src/app/api/users/[userId]/route.ts](../../src/app/api/users/%5BuserId%5D/route.ts) | [people-access](flows/people-access.md) |
| `/api/webhooks/autentique` | POST | [src/app/api/webhooks/autentique/route.ts](../../src/app/api/webhooks/autentique/route.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `/api/webhooks/inter/banking` | POST | [src/app/api/webhooks/inter/banking/route.ts](../../src/app/api/webhooks/inter/banking/route.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `/api/webhooks/inter/cobranca` | POST | [src/app/api/webhooks/inter/cobranca/route.ts](../../src/app/api/webhooks/inter/cobranca/route.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `/api/webhooks/resend` | POST | [src/app/api/webhooks/resend/route.ts](../../src/app/api/webhooks/resend/route.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `/api/webhooks/stone/conciliation` | POST, GET | [src/app/api/webhooks/stone/conciliation/route.ts](../../src/app/api/webhooks/stone/conciliation/route.ts) | [runtime-surfaces](runtime-surfaces.md) |

## Cloud Functions exportadas

| Export | Gatilho declarado | Fonte | Guia |
| --- | --- | --- | --- |
| `cashClosureDailySync` | `onSchedule` | [functions/src/cash-closure-jobs.ts](../../functions/src/cash-closure-jobs.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `cashClosureSummaryReinforcement` | `onSchedule` | [functions/src/cash-closure-summaries.ts](../../functions/src/cash-closure-summaries.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `cashClosureSummaryWritten` | `onDocumentWritten` | [functions/src/cash-closure-summaries.ts](../../functions/src/cash-closure-summaries.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `cashDepositDailyReconciliation` | `onSchedule` | [functions/src/cash-deposit-reconciliation-job.ts](../../functions/src/cash-deposit-reconciliation-job.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `checkFieldMapConsistency` | `onSchedule` | [functions/src/rh/propagation.ts](../../functions/src/rh/propagation.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `checklistDailyGenerate` | `onSchedule` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `checklistEscalateTasks` | `onSchedule` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `checklistMarkOverdue` | `onSchedule` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `cleanupExpiredActionLogs` | `onSchedule` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `cleanupExpiredEmployeeDocumentBatches` | `onSchedule` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `createUser` | `onCall` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `deleteUser` | `onCall` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `expireQuotations` | `onSchedule` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `financialBudgetGeneration` | `onSchedule` | [functions/src/financial-budget-jobs.ts](../../functions/src/financial-budget-jobs.ts) | [financial-budgets](flows/financial-budgets.md) |
| `financialInboxMaintenance` | `onSchedule` | [functions/src/financial-inbox-jobs.ts](../../functions/src/financial-inbox-jobs.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `hourlyPdvSync` | `onSchedule` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `interCobrancaReconciliation` | `onSchedule` | [functions/src/inter-cobranca-jobs.ts](../../functions/src/inter-cobranca-jobs.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `interPaymentReconciliation` | `onSchedule` | [functions/src/inter-payment-jobs.ts](../../functions/src/inter-payment-jobs.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `interStatementSync` | `onSchedule` | [functions/src/inter-statement-jobs.ts](../../functions/src/inter-statement-jobs.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `lgpdScheduledCleanup` | `onSchedule` | [functions/src/rh/termination.ts](../../functions/src/rh/termination.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `manualSyncFromBizneo` | `onCall` | [functions/src/rh/sync.ts](../../functions/src/rh/sync.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `onFieldUpdate` | `onCall` | [functions/src/rh/field-update.ts](../../functions/src/rh/field-update.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `onProfileChange` | `onDocumentWritten` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `onReceiptStatusChange` | `onDocumentWritten` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `onTermination` | `onDocumentWritten` | [functions/src/rh/termination.ts](../../functions/src/rh/termination.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `onUserProfileChange` | `onDocumentWritten` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `reactivateUser` | `onCall` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `recalculateMinimumStock` | `onSchedule` | [functions/src/stock-min-recalc.ts](../../functions/src/stock-min-recalc.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `reconcileGeneratedDocumentRetention` | `onSchedule` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `reconcilePdvSalesHistory` | `onSchedule` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `scheduledDateAlerts` | `onSchedule` | [functions/src/rh/automations.ts](../../functions/src/rh/automations.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `scheduledProfileCompletion` | `onSchedule` | [functions/src/rh/automations.ts](../../functions/src/rh/automations.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `stonePortfolioDailySync` | `onSchedule` | [functions/src/stone-portfolio-job.ts](../../functions/src/stone-portfolio-job.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `syncBizneoUsersMonthly` | `onSchedule` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `syncFromBizneo` | `onSchedule` | [functions/src/rh/sync.ts](../../functions/src/rh/sync.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `syncGoalsForRange` | `onCall` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `syncRhAccessCache` | `onDocumentWritten` | [functions/src/rh/sync.ts](../../functions/src/rh/sync.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `terminateUser` | `onCall` | [functions/src/index.ts](../../functions/src/index.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `uberExpenseCandidateWritten` | `onDocumentWritten` | [functions/src/uber-sftp/jobs.ts](../../functions/src/uber-sftp/jobs.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `uberSftpDailySync` | `onSchedule` | [functions/src/uber-sftp/jobs.ts](../../functions/src/uber-sftp/jobs.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `uberTransactionCandidateWritten` | `onDocumentWritten` | [functions/src/uber-sftp/jobs.ts](../../functions/src/uber-sftp/jobs.ts) | [runtime-surfaces](runtime-surfaces.md) |
| `vacationWorkflowDailyAlerts` | `onSchedule` | [functions/src/vacation-alerts.ts](../../functions/src/vacation-alerts.ts) | [runtime-surfaces](runtime-surfaces.md) |
