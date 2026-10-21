import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync("src/features/financial/inbox/workflow.server.ts", "utf8");
const ingestion = readFileSync("src/features/financial/inbox/ingest.server.ts", "utf8");
const paymentService = readFileSync("src/features/financial/payment-requests/service.server.ts", "utf8");
const documentExtraction = readFileSync("src/features/financial/inbox/document-extraction.server.ts", "utf8");
const statementSync = readFileSync("src/features/financial/inter-statement-sync.server.ts", "utf8");
const statementSettlement = readFileSync("src/features/financial/payment-requests/statement-settlement.ts", "utf8");
const reconciliationJob = readFileSync("src/app/api/jobs/inter/reconcile/route.ts", "utf8");
const inboxPaymentRoute = readFileSync("src/app/api/financial/inbox/[id]/payment/route.ts", "utf8");
const inboxRepository = readFileSync("src/features/financial/inbox/repository.server.ts", "utf8");
const inboxMaintenance = readFileSync("src/features/financial/inbox/maintenance.server.ts", "utf8");
const paymentRepository = readFileSync("src/features/financial/payment-requests/repository.server.ts", "utf8");
const obligationsService = readFileSync("src/features/financial/obligations/service.server.ts", "utf8");

test("cruzamento automático consulta apenas conjuntos financeiros filtrados e limitados", () => {
  assert.match(workflow, /where\("status", "in", \["pending", "partially_paid"\]\)/);
  assert.match(workflow, /limit\(MAX_EXISTING_EXPENSE_CANDIDATES \+ 1\)/);
  assert.match(workflow, /where\("principalAmountCents", "==", classification\.amountCents\)/);
  assert.match(workflow, /limit\(MAX_MATCHED_PAYMENT_CANDIDATES \+ 1\)/);
  assert.match(workflow, /where\("barcodeSnapshot\.codeHash", "==", incomingBarcodeHash\)/);
  assert.match(workflow, /where\("barcodeSnapshot\.code", "==", classification\.barcode\)/);
  assert.match(workflow, /limit\(MAX_MATCHED_BARCODE_PAYMENT_CANDIDATES \+ 1\)/);
  assert.match(paymentService, /codeHash: paymentBarcodeHash\(code\)/);
});

test("vínculo de parcela e sua auditoria são gravados na mesma transação", () => {
  assert.match(workflow, /runTransaction\(async \(transaction\) =>/);
  assert.match(workflow, /financialInboxMessageId: id,[\s\S]{0,120}financialInboxLinkedAt: now/);
  assert.match(workflow, /documentIdentity: mergeFinancialDocumentIdentities/);
  assert.match(workflow, /CHARGE_LINKED_TO_EXISTING_INSTALLMENT/);
});

test("pagamento por boleto não pode ser recriado quando já há extrato ou registro no Inter", () => {
  const settlementGuard = paymentService.indexOf("message.existingSettlement?.transactionId");
  const schedulingGuard = paymentService.indexOf("message.existingBankPayment?.transactionId");
  const requestCreation = paymentService.indexOf("const request: BankPaymentRequest");
  assert.ok(settlementGuard >= 0 && settlementGuard < requestCreation);
  assert.ok(schedulingGuard >= 0 && schedulingGuard < requestCreation);
  assert.match(paymentService, /message\.status !== "linked"/);
  assert.match(paymentService, /Somente a cobrança principal vinculada pode preparar um pagamento/);
  assert.match(paymentService, /installmentNumber: Number\(message\.linkedExpenseInstallmentNumber\)/);
  assert.match(paymentService, /pending\.sourceType === "financial_inbox" && bankCandidates\.some/);
  assert.match(paymentService, /mapInterBarcodeStatus\(candidate\.statusPagamento,[\s\S]{0,100}=== "paid"/);
});

test("resultado bancário atualiza a caixa e separa falha de handoff confirmado", () => {
  assert.match(paymentService, /planFinancialInboxPaymentProjection/);
  assert.match(paymentService, /MESSAGE_ARCHIVED_AFTER_FINANCIAL_HANDOFF/);
  assert.match(paymentService, /BANK_PAYMENT_ACTION_REQUIRED/);
  assert.match(paymentService, /status: "failed", lastError, updatedAt: failedAt/);
  assert.match(statementSync, /planFinancialInboxPaymentProjection/);
  assert.match(statementSync, /message: inboxMessage,/);
});

test("preparação exige e preserva a identidade confirmada do favorecido", () => {
  assert.match(inboxPaymentRoute, /inboxBarcodePaymentPreparationSchema\.parse/);
  assert.match(paymentService, /const beneficiaryDocument = preparation\.beneficiaryDocument/);
  assert.match(paymentService, /barcodeSnapshot: \{[\s\S]{0,300}beneficiaryDocument,/);
  assert.match(paymentService, /assertMatchingInboxBarcodeRequest/);
  assert.doesNotMatch(paymentService, /beneficiaryDocument: null/);
});

test("lembrete identificado não recebe vínculo financeiro principal", () => {
  assert.match(workflow, /automaticReminderResolutionPatch/);
  assert.match(workflow, /shouldAutomaticallyIdentifyInboxCharge/);
  assert.match(workflow, /getFinancialInboxAutomationSettings/);
  assert.match(workflow, /analysisCanResolve/);
  assert.match(workflow, /triage\.kind !== "candidate" \|\| !analysisCanResolve/);
  assert.match(workflow, /: resolutionForDisplay\(message\)/);
  assert.match(workflow, /automaticReminderArchive \? "archived" : automaticReminder\.status/);
  assert.doesNotMatch(workflow, /automaticReminder[\s\S]{0,240}linkedExpenseId/);
  assert.match(workflow, /resolutionOnly \? \{\} : \{\s*linkedExpenseId: expenseId/);
});

test("análise usa documentos arquivados e persiste identidade antes do cruzamento", () => {
  const documentPreparation = workflow.indexOf("prepareFinancialInboxDocuments(message, false)");
  const matchingQuery = workflow.indexOf('where("status", "in", ["pending", "partially_paid"])');
  assert.ok(documentPreparation >= 0 && documentPreparation < matchingQuery);
  assert.match(workflow, /shouldAttemptFinancialInboxDocumentAi/);
  assert.match(workflow, /prepareFinancialInboxDocuments\(message, true, deterministicDocuments\)/);
  assert.match(workflow, /billingIdentity: classification\.billingIdentity/);
});

test("análise isola candidatos por workspace e revalida a despesa na transação", () => {
  assert.match(workflow, /collection\("expenses"\)\s*\.where\("workspaceId", "==", message\.workspaceId\)/);
  assert.match(workflow, /collection\("payments"\)\s*\.where\("workspaceId", "==", message\.workspaceId\)/);
  assert.match(workflow, /collection\("bankPaymentRequests"\)\s*\.where\("workspaceId", "==", message\.workspaceId\)/);
  assert.match(workflow, /targetExpenseSnapshot\.get\("workspaceId"\) !== message\.workspaceId/);
  assert.match(workflow, /expense\.workspaceId !== expectedWorkspaceId/);
  assert.match(workflow, /provision\.workspaceId !== expectedWorkspaceId/);
  assert.match(workflow, /workspaceId: expectedWorkspaceId/);
  assert.match(paymentService, /linkedExpenseSnapshot\.get\("workspaceId"\) !== input\.workspaceId/);
  assert.match(paymentRepository, /where\("workspaceId", "==", workspaceId\)/);
  assert.match(obligationsService, /forecast\.workspaceId \|\| ""/);
});

test("caixa financeira não envia ao Inter até a deduplicação integral existir", () => {
  assert.match(paymentService, /localRequestDuplicateCheck/);
  assert.match(paymentService, /expenseAndObligationDuplicateCheck/);
  assert.match(paymentService, /sourceAndFingerprintDuplicateCheck/);
  assert.match(paymentService, /importedStatementDuplicateCheck/);
  assert.match(paymentService, /findInterBarcodePaymentsByCode/);
  assert.match(paymentService, /interSchedulesAndPayments: "pending"/);
  assert.match(paymentService, /interSchedulesAndPayments: recovered \? "existing_recovered" : "clear"/);
  assert.match(paymentService, /preflightUnidentifiedInboxBarcodeRequest/);
  assert.match(paymentService, /INTER_BANK_PREFLIGHT_CLEAR/);
  assert.match(paymentService, /INTER_BANK_PAYMENT_RECOVERED/);
  assert.match(paymentService, /if \(!current\.interRequestId\) return current/);
});

test("restauração persiste resolution inteiro e filtros aguardam migração legada", () => {
  assert.match(inboxRepository, /resolution: restoredFinancialInboxResolution\(message, restoredStatus\)/);
  assert.doesNotMatch(inboxRepository, /"resolution\.status": restoredStatus/);
  assert.match(inboxRepository, /financialInboxResolutionMigrationComplete\(migration\.data\(\)\)/);
  assert.match(inboxRepository, /FINANCIAL_INBOX_RESOLUTION_MIGRATION_REQUIRED/);
  assert.match(inboxMaintenance, /document\.get\("status"\) === "ignored" && !document\.get\("resolution\.mode"\)/);
});

test("arquivamento relê despesa vinculada na mesma transação", () => {
  assert.match(inboxRepository, /const expenseSnapshots = expenseIds\.length[\s\S]{0,200}transaction\.getAll/);
  assert.match(inboxRepository, /financialInboxArchiveEligibility\(message, \{/);
  assert.match(inboxRepository, /expenseReconciliationStatus:/);
  assert.doesNotMatch(inboxRepository, /expenseHasStatementSettlement:[\s\S]{0,240}linkedBankTransactionId/);
});

test("campanha comercial é ignorada com auditoria e não dispara análise financeira", () => {
  assert.match(ingestion, /triage\.kind === "noise"\s*\? "ignored"/);
  assert.match(ingestion, /MESSAGE_AUTO_IGNORED_MARKETING/);
  assert.match(ingestion, /if \(triage\.kind !== "noise"\) \{\s*await analyzeFinancialInboxMessage/);
  assert.match(workflow, /const nextStatus = triage\.kind === "noise"\s*\? "ignored"/);
  assert.match(workflow, /canCommitFinancialInboxAnalysis\(message,/);
});

test("extração por IA não retém a resposta e remove o PDF temporário", () => {
  assert.match(documentExtraction, /form\.set\("purpose", "user_data"\)/);
  assert.match(documentExtraction, /store: false/);
  assert.match(documentExtraction, /method: "DELETE"/);
  assert.match(documentExtraction, /finally \{\s*if \(fileId\) await deleteOpenAiFile\(fileId, apiKey\)/);
  assert.match(documentExtraction, /type: "json_schema"/);
});

test("boleto conciliado deixa comprovante pendente e o job conclui o pós-pagamento", () => {
  assert.match(statementSync, /planPaymentRequestStatementSettlement/);
  assert.match(statementSettlement, /postPaymentProcessingStatus: postPaymentCompleted \? "completed" as const : "pending" as const/);
  assert.match(reconciliationJob, /where\("postPaymentProcessingStatus", "==", "pending"\)/);
  assert.match(reconciliationJob, /where\("nextPostPaymentAttemptAt", "<=", nowIso\)/);
  assert.match(reconciliationJob, /where\("submissionStartedAt", "<=", staleSubmissionBefore\.toISOString\(\)\)/);
  assert.match(paymentService, /current\.status === "paid"\) return finishPaidPaymentRequest\(current\)/);
  assert.match(paymentService, /attachFinancialInboxProof\(current\)/);
  assert.match(paymentService, /postPaymentProcessingLeaseId/);
  assert.match(paymentService, /releasePostPaymentProcessingAfterFailure/);
  assert.match(paymentService, /persistPostPaymentStep/);
  assert.match(paymentService, /postPaymentProcessingStatus: "completed"/);
});

test("fila bancária evita starvation e mantém transição correlata atômica", () => {
  assert.match(reconciliationJob, /where\("nextBankStatusCheckAt", "<=", nowIso\)/);
  assert.match(reconciliationJob, /orderBy\("nextBankStatusCheckAt", "asc"\)/);
  assert.match(reconciliationJob, /deferBankStatusRefreshAfterFailure/);
  assert.match(paymentService, /async function persistBarcodeBankObservation/);
  assert.match(paymentService, /runTransaction\(async \(transaction\) =>/);
  assert.match(paymentService, /requestRef\.collection\("events"\)\.doc\(eventId\)/);
  assert.match(paymentService, /const requestPatch = \{\s*status: next,\s*updatedAt: submittedAt/);
  assert.match(paymentService, /transaction\.set\(expectedDebitRef/);
});

test("débito esperado órfão é bloqueado e exige revisão", () => {
  assert.match(statementSync, /if \(!paymentRequestSnapshot\.exists\) \{\s*throw new ExpectedBankDebitReviewError/);
  assert.match(statementSync, /paymentRequest\.expenseId !== params\.expected\.expenseId/);
  assert.match(statementSync, /statement:\$\{params\.transactionId\}:\$\{randomUUID\(\)\}/);
  assert.match(statementSync, /status: "review"/);
  assert.match(statementSync, /lastUpdateTime: expectedDebitSnapshot\.updateTime/);
  assert.match(statementSync, /reconciliationError: FieldValue\.delete\(\)/);
  assert.match(statementSync, /statement-payment-\$\{params\.transactionId\}/);
});

test("divergência bancária exige revisão e nunca oferece reenvio automático", () => {
  assert.match(paymentService, /code: "BANK_RECONCILIATION_DIVERGENCE"/);
  assert.match(paymentService, /nextBankStatusCheckAt: null/);
  assert.match(paymentService, /paymentSubmissionRequiresManualReconciliation\(current\)/);
  assert.match(paymentService, /bankCandidates\.length > 0 && previous\.length === 0/);
  assert.match(paymentService, /if \(bankCandidates\.length > 1\)/);
});

test("encargo confirmado do boleto vencido entra na DRE em Juros e multas", () => {
  assert.match(statementSync, /where\("name", "==", "Juros e multas"\)/);
  assert.match(statementSync, /data\.active !== false && data\.isGroup !== true && data\.is_dre_account !== false/);
  assert.match(statementSync, /where\("parentId", "==", candidates\[0\]\.id\)/);
  assert.match(statementSync, /observeBarcodeStatementSettlement/);
  assert.match(statementSync, /paymentRequest\.bankSettlementAmount/);
  assert.match(statementSync, /financialExpenseAccountingFields\(\{ competenceDate: paidAt \}\)/);
  assert.match(statementSync, /accountPlanName: lateChargesAccount\.name/);
  assert.match(statementSync, /isPaymentAdjustment: true/);
  assert.match(statementSync, /chargeExpenseId,/);
});

test("boleto liquidado continua sendo consultado até o Inter informar o valor pago", () => {
  assert.match(reconciliationJob, /"processing", "awaiting_statement"/);
  assert.match(paymentService, /"processing", "awaiting_statement", "failed"/);
  assert.doesNotMatch(paymentService, /current\.status === "awaiting_statement"\) return current/);
  assert.match(paymentService, /expectedBarcodeDebitAmountCents/);
  assert.match(paymentService, /"processing", "awaiting_statement"\]\.includes\(status\)/);
});
