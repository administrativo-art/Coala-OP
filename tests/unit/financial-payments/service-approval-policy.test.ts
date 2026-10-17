import assert from "node:assert/strict";
import test from "node:test";

import {
  FINANCIAL_SERVICE_APPROVAL_MAX_AMOUNT_CENTS,
  FINANCIAL_SERVICE_APPROVER_ID,
  financialServiceApprovalRejection,
} from "../../../src/features/financial/payment-requests/service-approval-policy";
import type { BankPaymentRequest } from "../../../src/features/financial/payment-requests/types";

const request: BankPaymentRequest = {
  id: "inbox_vivo_123",
  sourceType: "financial_inbox",
  sourceId: "vivo_123",
  expenseId: "expense_vivo_123",
  paymentRail: "barcode",
  amount: 5000,
  description: "Vivo",
  status: "awaiting_financial_authorization",
  idempotencyKey: "idem_vivo_123",
  barcodeSnapshot: {
    type: "barcode",
    code: "8".repeat(48),
    maskedCode: "********",
    dueDate: "2026-10-25",
    scheduledFor: "2026-10-25",
    beneficiaryDocument: "02.558.157/0004-05",
  },
  createdAt: "2026-10-16T00:00:00.000Z",
  createdBy: "operator_123",
  updatedAt: "2026-10-16T00:00:00.000Z",
};

const message = {
  workspaceId: "coala",
  linkedExpenseId: request.expenseId,
  paymentRequestId: request.id,
  status: "awaiting_authorization",
  existingBankPayment: null,
  existingSettlement: null,
  classification: {
    amountCents: FINANCIAL_SERVICE_APPROVAL_MAX_AMOUNT_CENTS,
    barcode: request.barcodeSnapshot.code,
    dueDate: request.barcodeSnapshot.dueDate,
    billingIdentity: { supplierTaxId: "02558157000405" },
  },
};

function rejection(candidate: BankPaymentRequest = request, inbox: Record<string, unknown> = message) {
  return financialServiceApprovalRejection({
    request: candidate,
    inboxMessageId: candidate.sourceId,
    inboxMessage: inbox,
    allowedSourceIds: new Set(["vivo_123"]),
    workspaceId: "coala",
    today: "2026-10-16",
  });
}

function assertRejected(value: string | null, pattern: RegExp) {
  assert.equal(typeof value, "string");
  assert.match(value as string, pattern);
}

test("backend aprova somente cobrança Vivo íntegra até R$ 5.000", () => {
  assert.equal(rejection(), null);
  assertRejected(rejection({ ...request, amount: 5000.01 }), /limite/);
  assertRejected(rejection({ ...request, barcodeSnapshot: { ...request.barcodeSnapshot, beneficiaryDocument: "11222333000181" } }), /beneficiário/);
  assertRejected(rejection(request, { ...message, classification: { ...(message.classification as Record<string, unknown>), billingIdentity: null } }), /CNPJ extraído/);
  assertRejected(rejection(request, { ...message, linkedExpenseId: "expense_other" }), /despesa/);
  assertRejected(rejection(request, { ...message, existingBankPayment: { transactionId: "inter_existing" } }), /pagamento bancário/);
  assertRejected(financialServiceApprovalRejection({
    request,
    inboxMessageId: request.sourceId,
    inboxMessage: message,
    allowedSourceIds: new Set(["vivo_other"]),
    workspaceId: "coala",
    today: "2026-10-16",
  }), /autorização explícita/);
});

test("backend só retoma ordem que ele próprio autorizou", () => {
  assert.equal(rejection({ ...request, status: "ready_to_submit", authorizedBy: FINANCIAL_SERVICE_APPROVER_ID }), null);
  assertRejected(rejection({ ...request, status: "ready_to_submit", authorizedBy: "user_other" }), /executor financeiro/);
});

