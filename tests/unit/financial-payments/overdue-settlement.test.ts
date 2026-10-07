import assert from "node:assert/strict";
import test from "node:test";

import { planOverdueBarcodeSettlementRevision } from "../../../src/features/financial/payment-requests/overdue-settlement";
import type { BankPaymentRequest } from "../../../src/features/financial/payment-requests/types";

const barcode = "10491158171700010004400014406375415900000146798";
const request = {
  id: "inbox_message_123",
  sourceType: "financial_inbox",
  sourceId: "message_123",
  expenseId: "inbox_message_123",
  paymentRail: "barcode",
  amount: 1467.98,
  description: "Condomínio e energia - 09/2026 | Shopping do Automóvel",
  barcodeSnapshot: {
    type: "barcode",
    code: barcode,
    maskedCode: "10491••••46798",
    dueDate: "2026-10-05",
    scheduledFor: "2026-10-06",
    beneficiaryDocument: "05695860000100",
  },
  status: "failed",
  idempotencyKey: "idem_1",
  statementReconciliationStatus: "not_expected",
  submissionStartedAt: "2026-10-07T01:55:01.890Z",
  submissionAttemptCount: 2,
  lastError: { code: "INTER_HTTP_400", safeMessage: "Recusado", occurredAt: "2026-10-07T01:55:06.148Z" },
  createdAt: "2026-10-07T01:06:00.000Z",
  createdBy: "operator_1",
  updatedAt: "2026-10-07T01:55:06.148Z",
} satisfies BankPaymentRequest;

const message = {
  id: request.sourceId,
  workspaceId: "workspace_1",
  status: "awaiting_authorization",
  bankState: "awaiting_authorization",
  linkedExpenseId: request.expenseId,
  paymentRequestId: request.id,
  classification: {
    amountCents: 146798,
    dueDate: "2026-10-05",
    barcode,
    billingIdentity: { supplierTaxId: "05695860000100" },
  },
  attachments: [{ id: "attachment_1", archiveStatus: "stored", storagePath: "financial/inbox/boleto.pdf", sha256: "a".repeat(64) }],
};

const expense = {
  id: request.expenseId,
  workspaceId: "workspace_1",
  originModule: "financial_inbox",
  financialInboxMessageId: request.sourceId,
  status: "pending",
  totalValue: 1467.98,
  installments: [{ number: 1, value: 1467.98, status: "pending" }],
};

const input = {
  principalAmountCents: 146798,
  settlementAmountCents: 151200,
  lateChargeAmountCents: 4402,
  scheduledFor: "2026-10-06",
  beneficiaryDocument: "05695860000100",
  expenseId: request.expenseId,
  barcode,
  sourceAttachmentId: "attachment_1",
  sourceAttachmentSha256: "a".repeat(64),
  evidenceSource: "manual_document_review" as const,
  confirmed: true as const,
};

function plan(overrides: Partial<Parameters<typeof planOverdueBarcodeSettlementRevision>[0]> = {}) {
  return planOverdueBarcodeSettlementRevision({
    request,
    message,
    expense,
    input,
    actor: { uid: "operator_1", email: "operator@example.com" },
    now: "2026-10-07T02:10:00.000Z",
    today: "2026-10-06",
    ...overrides,
  });
}

test("reautoriza valor documental vencido sem alterar o principal", () => {
  const patch = plan();
  assert.equal(patch.status, "ready_to_submit");
  assert.equal(patch.requestedSettlementAmount, 1512);
  assert.equal(patch.requestedLateChargeAmount, 44.02);
  assert.equal(patch.settlementRevision.principalAmountCents, 146798);
  assert.equal(patch.settlementRevision.sourceAttachmentSha256, "a".repeat(64));
  assert.equal(request.amount, 1467.98);
});

test("bloqueia revisão sem segunda rejeição definitiva, documento ou soma exata", () => {
  assert.throws(() => plan({ request: { ...request, submissionAttemptCount: 1 } }));
  assert.throws(() => plan({ request: { ...request, interRequestId: "inter_1" } }));
  assert.throws(() => plan({ message: { ...message, attachments: [] } }));
  assert.throws(() => plan({ expense: { ...expense, status: "paid" } }));
  assert.throws(() => plan({ input: { ...input, sourceAttachmentSha256: "b".repeat(64) } }));
  assert.throws(() => plan({ input: { ...input, settlementAmountCents: 151201 } }));
  assert.throws(() => plan({ today: "2026-10-07" }));
  assert.throws(() => plan({ input: { ...input, scheduledFor: "2026-10-05" } }));
});
