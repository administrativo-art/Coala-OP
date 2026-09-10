import assert from "node:assert/strict";
import test from "node:test";

import {
  FINANCIAL_INBOX_STAGE_STATUSES,
  financialInboxStageForStatus,
  isFinancialInboxBulkDiscardEligible,
  matchesFinancialInboxSearch,
} from "../../src/features/financial/inbox/presentation";
import type { FinancialInboxMessage, FinancialInboxStatus } from "../../src/features/financial/inbox/types";

function message(overrides: Partial<FinancialInboxMessage> = {}): FinancialInboxMessage {
  return {
    id: "message-1",
    workspaceId: "workspace-1",
    provider: "resend",
    providerEmailId: "provider-email-1",
    providerEventId: "provider-event-1",
    messageId: null,
    status: "pending_review",
    from: "Vivo <contadigitalvivo@vivo.com.br>",
    fromAddress: "contadigitalvivo@vivo.com.br",
    senderDomain: "vivo.com.br",
    to: ["financeiro@example.com"],
    originalRecipients: ["financeiro@example.com"],
    subject: "A fatura Vivo Móvel da sua empresa chegou",
    receivedAt: "2026-09-08T23:10:00.000Z",
    textPreview: "Conta de telefonia",
    textContent: "Conta de telefonia",
    classification: {
      documentType: "utility_bill",
      financeLikely: true,
      confidence: "high",
      supplierName: "Telefônica Brasil S.A.",
      competence: "2026-08",
      dueDate: "2026-09-12",
      amountCents: 19600,
      barcode: null,
      barcodeMasked: null,
      links: [],
      billingIdentity: {
        supplierTaxId: "02558157000162",
        customerAccount: "123456789",
        contractNumber: "987654",
        serviceType: "mobile",
        serviceNumbers: ["+5598999991234"],
      },
    },
    attachments: [],
    rawStoragePath: null,
    rawSha256: null,
    archiveWarnings: [],
    linkedExpenseId: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: "2026-09-08T23:10:00.000Z",
    updatedAt: "2026-09-08T23:10:00.000Z",
    ...overrides,
  };
}

test("organiza todos os estados nas etapas operacionais sem misturar banco e conciliação", () => {
  const expected: Record<FinancialInboxStatus, string> = {
    pending_review: "classify",
    document_pending: "classify",
    suggestion_available: "link",
    under_review: "classify",
    linked: "pay",
    awaiting_authorization: "bank",
    scheduled: "bank",
    awaiting_statement: "bank",
    reconciled: "done",
    divergent: "link",
    ignored: "off",
    archived: "archive",
    error: "classify",
  };

  for (const [status, stage] of Object.entries(expected)) {
    assert.equal(financialInboxStageForStatus(status as FinancialInboxStatus), stage);
  }

  const configured = Object.values(FINANCIAL_INBOX_STAGE_STATUSES).flat();
  assert.equal(new Set(configured).size, configured.length);
  assert.deepEqual(new Set(configured), new Set(Object.keys(expected)));
});

test("só permite descarte em lote antes de vínculo ou pagamento", () => {
  assert.equal(isFinancialInboxBulkDiscardEligible(message()), true);
  assert.equal(isFinancialInboxBulkDiscardEligible(message({ status: "suggestion_available" })), true);
  assert.equal(isFinancialInboxBulkDiscardEligible(message({ status: "linked", linkedExpenseId: "expense-1" })), false);
  assert.equal(isFinancialInboxBulkDiscardEligible(message({ paymentRequestId: "payment-1" })), false);
  assert.equal(isFinancialInboxBulkDiscardEligible(message({ status: "scheduled" })), false);
});

test("busca por fornecedor, valor brasileiro, conta e número de telefone", () => {
  const target = message();
  assert.equal(matchesFinancialInboxSearch(target, "telefonica"), true);
  assert.equal(matchesFinancialInboxSearch(target, "196,00"), true);
  assert.equal(matchesFinancialInboxSearch(target, "123456789"), true);
  assert.equal(matchesFinancialInboxSearch(target, "98999991234"), true);
  assert.equal(matchesFinancialInboxSearch(target, "vivo 196,00 999991234"), true);
  assert.equal(matchesFinancialInboxSearch(target, "Amazon"), false);
});
