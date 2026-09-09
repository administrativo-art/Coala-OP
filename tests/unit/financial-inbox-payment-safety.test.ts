import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync("src/features/financial/inbox/workflow.server.ts", "utf8");
const paymentService = readFileSync("src/features/financial/payment-requests/service.server.ts", "utf8");
const documentExtraction = readFileSync("src/features/financial/inbox/document-extraction.server.ts", "utf8");

test("cruzamento automático consulta apenas conjuntos financeiros filtrados e limitados", () => {
  assert.match(workflow, /where\("status", "in", \["pending", "partially_paid"\]\)/);
  assert.match(workflow, /limit\(MAX_EXISTING_EXPENSE_CANDIDATES \+ 1\)/);
  assert.match(workflow, /where\("principalAmountCents", "==", classification\.amountCents\)/);
  assert.match(workflow, /limit\(MAX_MATCHED_PAYMENT_CANDIDATES \+ 1\)/);
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
});

test("análise usa documentos arquivados e persiste identidade antes do cruzamento", () => {
  const documentPreparation = workflow.indexOf("prepareFinancialInboxDocuments(message)");
  const matchingQuery = workflow.indexOf('where("status", "in", ["pending", "partially_paid"])');
  assert.ok(documentPreparation >= 0 && documentPreparation < matchingQuery);
  assert.match(workflow, /billingIdentity: message\.classification\.billingIdentity/);
});

test("extração por IA não retém a resposta e remove o PDF temporário", () => {
  assert.match(documentExtraction, /form\.set\("purpose", "user_data"\)/);
  assert.match(documentExtraction, /store: false/);
  assert.match(documentExtraction, /method: "DELETE"/);
  assert.match(documentExtraction, /finally \{\s*if \(fileId\) await deleteOpenAiFile\(fileId, apiKey\)/);
  assert.match(documentExtraction, /type: "json_schema"/);
});
