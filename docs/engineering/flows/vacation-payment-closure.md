# Férias: preparação do pagamento, assinatura do recibo e encerramento

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** subfluxo traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. Registra comportamento implementado; autorização bancária continua regida por [regras operacionais](../../../AGENTS.md).

## Entrada e percurso

A [tela de férias](../../../src/components/dp/dp-ferias-profile.tsx) chama `prepare_payment`, `sync_payment`, `retry_receipt_signature`, `sync_receipt_signature` e `finalize_workflow` por [`PATCH /api/dp/vacations/{id}`](../../../src/app/api/dp/vacations/%5BvacationId%5D/route.ts). A aprovação do recibo também chama a preparação de pagamento. Essas ações exigem, no [serviço de férias](../../../src/features/hr/vacations/server.ts), permissão de aprovação e acesso à colaboradora por unidade.

1. [`prepareVacationPaymentControl`](../../../src/features/hr/vacations/server.ts) exige trilha ativa, recibo aprovado e valores conferidos. Uma transação marca `payment.preparing` e registra evento. A rotina cria `expenses/vacation_{vacationId}` no banco financeiro de modo idempotente e chama [`createPaymentRequest`](../../../src/features/financial/payment-requests/service.server.ts), que inicia a solicitação em `awaiting_financial_authorization`. Uma segunda transação projeta ID, valor, vencimento e estado em `dp_vacations`; há também notificação ao grupo financeiro no banco RH. A ação **não autoriza o pagamento bancário**.
2. `syncVacationPayment` lê a solicitação financeira, atualiza seu estado junto ao serviço de pagamentos quando aplicável e projeta status, data, comprovante ou falha na trilha de férias. Quando o serviço financeiro confirma o pagamento, chama [`completeVacationPayment`](../../../src/features/hr/vacations/payment-completion.server.ts): a transação marca `paid`, conclui a etapa de pagamento, cria evento uma vez e libera a assinatura do recibo. Depois tenta enviar o recibo à Autentique. [Fonte financeira](../../../src/features/financial/payment-requests/service.server.ts).
3. [`ensureVacationReceiptSignatureSent` e `syncVacationReceiptSignatureRequest`](../../../src/features/hr/vacations/payment-completion.server.ts) exigem pagamento confirmado, enviam à colaboradora, recebem o estado pelo [webhook Autentique](../../../src/app/api/webhooks/autentique/route.ts) ou pela ação de sincronização, arquivam PDF assinado no Storage e marcam `receiptSignature.signed` e `closure.ready`. A ação de retry reenvia convites pendentes ou tenta o envio novamente. [Serviço](../../../src/features/hr/vacations/payment-completion.server.ts).
4. [`finalizeVacationWorkflow`](../../../src/features/hr/vacations/server.ts) exige trilha ativa, férias aprovadas, recibo assinado e fechamento `ready`. Em transação, marca a trilha `completed`, conclui a etapa de fechamento e grava `VACATION_WORKFLOW_COMPLETED`.

## Dados, acesso e contratos

| Item | Operação | Controle observado |
| --- | --- | --- |
| `dp_vacations`, `dp_vacationEvents` no banco principal | Estado da trilha e eventos | `requireVacationApprovalAccess`; transações por etapa. |
| `expenses`, solicitações financeiras | Despesa e pedido de pagamento | ID de despesa `vacation_{id}` e `sourceType: vacation`; fluxo de autorização do Financeiro. |
| `hrNotifications`, `hrSignatureRequests` no banco RH | Notificação e assinatura | Escritas após a projeção da etapa; webhook e sincronização. |
| Storage e Autentique | Recibo e PDF assinado | Hash e caminho arquivado no serviço de assinatura. |

**Inferência de impacto:** bancos, Storage e Autentique são atualizados em operações separadas; a projeção de RH pode falhar depois de criar despesa ou solicitação financeira. A chave estável da despesa e o ID do pagamento precisam ser preservados ao corrigir/reconciliar esses estados. O cancelamento de férias aprovadas é bloqueado quando há solicitação financeira; veja [agendamento](vacation-scheduling.md).

## Verificação e limites

O [teste estrutural ponta a ponta](../../../tests/unit/dp-vacation-end-to-end-workflow.test.ts) confere que a solicitação aguarda autorização, o recibo só segue para assinatura após pagamento e o encerramento exige recibo assinado. Conferir os testes do [serviço financeiro](../../../tests/unit) e o [E2E de férias](../../../tests/e2e/hr/vacations.spec.ts) para mudanças de comportamento. Este guia não certifica o processamento bancário completo, nem a política de reversão financeira; esses percursos pertencem ao grupo de pagamentos da etapa 3.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
