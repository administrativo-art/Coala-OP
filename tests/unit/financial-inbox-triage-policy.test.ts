import assert from "node:assert/strict";
import test from "node:test";

import { classifyFinancialEmail } from "../../src/features/financial/inbox/parser";
import { financialInboxSenderAuthentication, shouldAttemptFinancialInboxDocumentAi, triageFinancialInboxMessage, validatedTrustedInboxSuppliers } from "../../src/features/financial/inbox/triage-policy";
import { shouldUseFinancialDocumentAi } from "../../src/features/financial/inbox/document-ai-policy";
import { disabledInboxBankAutomationPolicy, inboxBankAutomationGuard } from "../../src/features/financial/inbox/automation-policy";
import type { FinancialInboxAttachment } from "../../src/features/financial/inbox/types";

const storedPdf = { filename: "fatura.pdf", archiveStatus: "stored" } as FinancialInboxAttachment;

test("marketing inequívoco é ruído, anexo documental mantém revisão", () => {
  const classification = classifyFinancialEmail({ subject: "Oferta especial: assine agora", text: "Aproveite nossos benefícios." }).classification;
  assert.equal(triageFinancialInboxMessage({ classification, senderDomain: "example.org", attachments: [] }).kind, "noise");
  assert.equal(triageFinancialInboxMessage({ classification, senderDomain: "example.org", attachments: [storedPdf] }).kind, "review");
});

test("PDF genérico só segue ao OCR com plausibilidade financeira ou domínio autenticado", () => {
  const classification = classifyFinancialEmail({ subject: "Documento", text: "Veja o anexo." }).classification;
  const review = triageFinancialInboxMessage({ classification, senderDomain: "example.org", attachments: [storedPdf] });
  const extracted = [{ ...storedPdf, extractionStatus: "empty" as const }];
  assert.equal(review.kind, "review");
  assert.equal(shouldAttemptFinancialInboxDocumentAi({ initial: review, afterDeterministicExtraction: review, attachments: extracted }), false);
  assert.equal(shouldAttemptFinancialInboxDocumentAi({ initial: review, afterDeterministicExtraction: review, attachments: extracted,
    authenticatedTrustedDomain: true }), true);
  assert.equal(shouldUseFinancialDocumentAi({ candidate: true, supported: true, text: "", subject: "Documento", senderDomain: "example.org" }), true);
  assert.equal(shouldAttemptFinancialInboxDocumentAi({ initial: { ...review, kind: "noise" }, afterDeterministicExtraction: review, attachments: extracted }), false);
  assert.equal(shouldAttemptFinancialInboxDocumentAi({ initial: review, afterDeterministicExtraction: review, attachments: [] }), false);
});

test("fornecedor conhecido exige DMARC, política persistida, domínio exato e CNPJ coincidente", () => {
  const classification = classifyFinancialEmail({ subject: "Documento", text: "Fornecedor Exemplo CNPJ 64.433.090/0001-97" }).classification;
  const trustedSuppliers = validatedTrustedInboxSuppliers([{ senderDomain: "billing.example.org", supplierTaxId: "64.433.090/0001-97" }]);
  assert.equal(trustedSuppliers.length, 1);
  assert.equal(validatedTrustedInboxSuppliers([{ senderDomain: "example.org", supplierTaxId: "11111111111111" }]).length, 0);
  assert.equal(triageFinancialInboxMessage({ classification, senderDomain: "billing.example.org", senderAuthenticated: true,
    attachments: [storedPdf], trustedSuppliers }).knownSupplier, true);
  assert.equal(triageFinancialInboxMessage({ classification, senderDomain: "billing.example.org", senderAuthenticated: false,
    attachments: [storedPdf], trustedSuppliers }).knownSupplier, false);
  assert.equal(triageFinancialInboxMessage({ classification, senderDomain: "evil.billing.example.org", senderAuthenticated: true,
    attachments: [storedPdf], trustedSuppliers }).knownSupplier, false);
  assert.equal(financialInboxSenderAuthentication({ "Authentication-Results": "mx; dmarc=pass header.from=billing.example.org" },
    "billing.example.org").status, "pass");
  assert.equal(financialInboxSenderAuthentication({ "authentication-results": "mx; dmarc=pass header.from=evil.example.org" },
    "billing.example.org").status, "fail");
  assert.equal(financialInboxSenderAuthentication({ "authentication-results":
    "mx; dmarc=fail header.from=billing.example.org; dmarc=pass header.from=evil.example.org" },
  "billing.example.org").status, "fail");
  assert.equal(financialInboxSenderAuthentication({ "authentication-results":
    "mx; dmarc=pass header.from=billing.example.org header.from=evil.example.org" },
  "billing.example.org").status, "fail");
  assert.equal(financialInboxSenderAuthentication({
    "Authentication-Results": "mx; dmarc=pass header.from=billing.example.org",
    "authentication-results": "other; dmarc=fail header.from=billing.example.org",
  }, "billing.example.org").status, "fail");
});

test("automação ao Inter permanece bloqueada mesmo com política completa", () => {
  const input = {
    senderDomain: "billing.example.org", supplierTaxId: "64433090000197", amountCents: 1000,
    at: "2026-10-21", linkedExpenseId: "expense-1", ambiguous: false,
  };
  assert.equal(inboxBankAutomationGuard({ ...input, policy: disabledInboxBankAutomationPolicy() }).reasonCode, "BANK_AUTOMATION_DISABLED");
  const policy = {
    enabled: true, suppliers: [{ senderDomain: "billing.example.org", supplierTaxId: "64433090000197" }],
    maxPerPaymentCents: 1000, maxPerPeriodCents: 10000, validFrom: "2026-10-01", validUntil: "2026-10-31", approvedBy: "owner",
  };
  assert.equal(inboxBankAutomationGuard({ ...input, policy }).reasonCode, "DUPLICATE_LOCK_UNAVAILABLE");
  const clear = {
    localRequests: "clear", expenseAndObligation: "clear", interSchedulesAndPayments: "clear",
    importedStatement: "clear", documentFingerprint: "clear", sourceIdentity: "clear", exclusiveLockHeld: true,
  } as const;
  assert.equal(inboxBankAutomationGuard({ ...input, policy, duplicateEvidence: { ...clear, importedStatement: "unknown" } }).reasonCode, "DUPLICATE_EVIDENCE_INCOMPLETE");
  assert.equal(inboxBankAutomationGuard({ ...input, policy, duplicateEvidence: { ...clear, localRequests: "duplicate" } }).reasonCode, "DUPLICATE_FOUND");
  assert.equal(inboxBankAutomationGuard({ ...input, policy, duplicateEvidence: clear }).reasonCode, "BANK_EXECUTION_NOT_IMPLEMENTED");
});
