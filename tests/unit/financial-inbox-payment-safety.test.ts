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

test("cruzamento automático consulta apenas conjuntos financeiros filtrados e limitados", () => {
  assert.match(workflow, /where\("status", "in", \["pending", "partially_paid"\]\)/);
  assert.match(workflow, /limit\(MAX_EXISTING_EXPENSE_CANDIDATES \+ 1\)/);
  assert.match(workflow, /where\("principalAmountCents", "==", classification\.amountCents\)/);
  assert.match(workflow, /limit\(MAX_MATCHED_PAYMENT_CANDIDATES \+ 1\)/);
  assert.match(workflow, /where\("barcodeSnapshot\.code", "==", classification\.barcode\)/);
  assert.match(workflow, /limit\(MAX_MATCHED_BARCODE_PAYMENT_CANDIDATES \+ 1\)/);
});

test("vínculo de parcela e sua auditoria são gravados na mesma transação", () => {
  assert.match(workflow, /runTransaction\(async \(transaction\) =>/);
  assert.match(workflow, /financialInboxMessageId: id, financialInboxLinkedAt: now/);
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
});

test("lembrete identificado não recebe vínculo financeiro principal", () => {
  assert.match(workflow, /automaticReminderResolutionPatch/);
  assert.match(workflow, /shouldAutomaticallyIdentifyInboxCharge/);
  assert.match(workflow, /getFinancialInboxAutomationSettings/);
  assert.match(workflow, /analysisCanResolve/);
  assert.match(workflow, /classification\.marketingLikely \|\| !analysisCanResolve/);
  assert.match(workflow, /: resolutionForDisplay\(message\)/);
  assert.match(workflow, /\? automaticReminder\.status/);
  assert.doesNotMatch(workflow, /automaticReminder[\s\S]{0,240}linkedExpenseId/);
  assert.match(workflow, /resolutionOnly \? \{\} : \{\s*linkedExpenseId: expenseId/);
});

test("análise usa documentos arquivados e persiste identidade antes do cruzamento", () => {
  const documentPreparation = workflow.indexOf("prepareFinancialInboxDocuments(message)");
  const matchingQuery = workflow.indexOf('where("status", "in", ["pending", "partially_paid"])');
  assert.ok(documentPreparation >= 0 && documentPreparation < matchingQuery);
  assert.match(workflow, /billingIdentity: message\.classification\.billingIdentity/);
});

test("campanha comercial é ignorada com auditoria e não dispara análise financeira", () => {
  assert.match(ingestion, /parsed\.classification\.marketingLikely\s*\? "ignored"/);
  assert.match(ingestion, /MESSAGE_AUTO_IGNORED_MARKETING/);
  assert.match(ingestion, /if \(!parsed\.classification\.marketingLikely\) \{\s*await analyzeFinancialInboxMessage/);
  assert.match(workflow, /classification\.marketingLikely\s*\? "ignored"/);
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
});
