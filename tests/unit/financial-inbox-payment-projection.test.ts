import assert from "node:assert/strict";
import test from "node:test";

import {
  planFinancialInboxPaymentProjection,
  projectFinancialInboxPaymentRequest,
} from "../../src/features/financial/inbox/payment-projection";
import type { FinancialInboxMessage } from "../../src/features/financial/inbox/types";
import type { BankPaymentRequest } from "../../src/features/financial/payment-requests/types";

function message(overrides: Partial<FinancialInboxMessage> = {}): FinancialInboxMessage {
  return {
    id: "message-1",
    workspaceId: "workspace-1",
    provider: "resend",
    providerEmailId: "provider-email-1",
    providerEventId: "provider-event-1",
    messageId: null,
    status: "awaiting_authorization",
    from: "financeiro@example.com",
    fromAddress: "financeiro@example.com",
    senderDomain: "example.com",
    to: ["cobrancas@example.com"],
    originalRecipients: ["cobrancas@example.com"],
    subject: "Cobrança",
    receivedAt: "2026-10-01T12:00:00.000Z",
    textPreview: "Cobrança",
    textContent: "Cobrança",
    classification: {
      documentType: "charge",
      financeLikely: true,
      confidence: "high",
      supplierName: "Fornecedor",
      competence: "2026-10",
      dueDate: "2026-10-25",
      amountCents: 28560,
      barcode: null,
      barcodeMasked: null,
      links: [],
    },
    attachments: [],
    rawStoragePath: null,
    rawSha256: null,
    archiveWarnings: [],
    linkedExpenseId: "expense-1",
    paymentRequestId: "request-1",
    bankState: "awaiting_authorization",
    resolution: {
      status: "identified",
      kind: "new_charge",
      targetType: "expense",
      targetId: "expense-1",
      installmentNumber: null,
      financialState: "payment_prepared",
      mode: "manual",
      confidence: "high",
      reasons: [],
      resolvedAt: "2026-10-01T12:00:00.000Z",
      resolvedBy: "user-1",
    },
    reviewedAt: null,
    reviewedBy: null,
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

function request(overrides: Partial<BankPaymentRequest> = {}): BankPaymentRequest {
  return {
    id: "request-1",
    workspaceId: "workspace-1",
    sourceType: "financial_inbox",
    sourceId: "message-1",
    expenseId: "expense-1",
    amount: 285.6,
    description: "Cobrança",
    status: "awaiting_financial_authorization",
    idempotencyKey: "request-1",
    paymentRail: "barcode",
    barcodeSnapshot: {
      type: "barcode",
      code: "00190000090285760000600000000123456780000028560",
      maskedCode: "00190...28560",
      dueDate: "2026-10-25",
      scheduledFor: "2026-10-25",
    },
    createdAt: "2026-10-01T12:00:00.000Z",
    createdBy: "user-1",
    updatedAt: "2026-10-01T12:00:00.000Z",
    ...overrides,
  } as BankPaymentRequest;
}

test("falha bancária vira ação necessária em vez de continuar aguardando autorização", () => {
  const failed = request({ status: "failed" });
  assert.deepEqual(projectFinancialInboxPaymentRequest(failed), {
    status: "payment_failed",
    bankState: "failed",
    financialState: "payment_prepared",
    handoffConfirmed: false,
    requiresAction: true,
  });
  const plan = planFinancialInboxPaymentProjection({
    message: message(),
    request: failed,
    observedAt: "2026-10-21T18:00:00.000Z",
  });
  assert.equal(plan.transition, "action_required");
  assert.equal(plan.patch.status, "payment_failed");
  assert.equal((plan.patch.resolution as { status: string }).status, "identified");
});

test("agendamento confirmado arquiva a mensagem principal e preserva a trilha", () => {
  const plan = planFinancialInboxPaymentProjection({
    message: message({ status: "scheduled", bankState: "scheduled" }),
    request: request({ status: "scheduled", interRequestId: "inter-1" }),
    observedAt: "2026-10-21T18:00:00.000Z",
  });
  assert.equal(plan.transition, "archive");
  assert.equal(plan.patch.status, "archived");
  assert.equal(plan.patch.bankTransactionId, "inter-1");
  assert.equal(plan.patch.archivedFromStatus, "identified");
  assert.equal((plan.patch.resolution as { status: string; financialState: string }).status, "archived");
  assert.equal((plan.patch.resolution as { status: string; financialState: string }).financialState, "scheduled");
});

test("lembrete da mesma despesa pode usar o agendamento confirmado da mensagem principal", () => {
  const reminder = message({
    id: "reminder-1",
    paymentRequestId: null,
    status: "identified",
    resolution: {
      ...message().resolution!,
      kind: "reminder",
      financialState: "scheduled",
    },
  });
  const plan = planFinancialInboxPaymentProjection({
    message: reminder,
    request: request({ status: "scheduled", interRequestId: "inter-1" }),
    observedAt: "2026-10-21T18:00:00.000Z",
  });
  assert.equal(plan.transition, "archive");
  assert.equal(plan.patch.status, "archived");

  const expenseBoletoPlan = planFinancialInboxPaymentProjection({
    message: reminder,
    request: request({
      sourceType: "expense_boleto",
      sourceId: "expense-1",
      status: "scheduled",
      interRequestId: "inter-2",
    } as Partial<BankPaymentRequest>),
    observedAt: "2026-10-21T18:00:00.000Z",
  });
  assert.equal(expenseBoletoPlan.transition, "archive");
});

test("aprovação pendente no Inter continua operacional e arquivo existente não reabre na conciliação", () => {
  const approval = planFinancialInboxPaymentProjection({
    message: message(),
    request: request({ status: "awaiting_bank_approval", interRequestId: "inter-1" }),
    observedAt: "2026-10-21T18:00:00.000Z",
  });
  assert.equal(approval.transition, "update");
  assert.equal(approval.patch.status, "awaiting_authorization");

  const paid = planFinancialInboxPaymentProjection({
    message: message({ status: "archived", archivedFromStatus: "identified" }),
    request: request({
      status: "paid",
      interRequestId: "inter-1",
      statementReconciliationStatus: "matched",
    }),
    observedAt: "2026-10-22T18:00:00.000Z",
  });
  assert.equal(paid.transition, "update");
  assert.equal(paid.patch.status, "archived");
  assert.equal(Object.hasOwn(paid.patch, "thread"), false);
  assert.equal((paid.patch.resolution as { financialState: string }).financialState, "reconciled");
});
