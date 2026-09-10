import assert from "node:assert/strict";
import test from "node:test";

import { planPaymentRequestStatementSettlement } from "../../src/features/financial/payment-requests/statement-settlement";
import type { PixBankPaymentRequest } from "../../src/features/financial/payment-requests/types";

const request: PixBankPaymentRequest = {
  id: "payment-request-1",
  sourceType: "generated_receipt",
  sourceId: "receipt-1",
  expenseId: "expense-1",
  paymentRail: "pix",
  beneficiaryReference: { sourceType: "employee", sourceId: "employee-1" },
  beneficiarySnapshot: {
    sourceType: "employee",
    sourceId: "employee-1",
    name: "Heucilene Oliveira Ribeiro",
    document: "***.***.***-10",
    documentHash: "hash",
    paymentMethod: "pix_key",
    pixKeyType: "cpf",
    maskedPaymentDestination: "•••••••••10",
    sourceUpdatedAt: "2026-09-08T12:00:00.000Z",
    resolvedAt: "2026-09-08T12:00:00.000Z",
  },
  amount: 15.95,
  description: "Complemento salário 08/2026 - Heucilene",
  status: "failed",
  bankStatus: "PAGO",
  statementReconciliationStatus: "divergent",
  bankReconciliationDivergenceField: "receiver",
  lastError: {
    code: "BANK_RECONCILIATION_DIVERGENCE",
    safeMessage: "O favorecido confirmado pelo banco diverge da solicitação.",
    occurredAt: "2026-09-08T17:00:00.000Z",
  },
  idempotencyKey: "key-1",
  createdAt: "2026-09-08T16:30:00.000Z",
  createdBy: "user-1",
  updatedAt: "2026-09-08T17:00:00.000Z",
};

test("extrato conciliado transforma falha residual em pago sem apagar a revisão do favorecido", () => {
  const plan = planPaymentRequestStatementSettlement({
    request,
    expenseId: "expense-1",
    bankTransactionId: "statement-1",
    cashAmount: 15.95,
    paidAt: "2026-09-08T15:00:00.000Z",
    observedAt: "2026-09-10T00:38:56.000Z",
  });

  assert.equal(plan?.patch.status, "paid");
  assert.equal(plan?.patch.statementReconciliationStatus, "matched");
  assert.equal(plan?.patch.statementTransactionId, "statement-1");
  assert.equal(plan?.patch.beneficiaryVerificationStatus, "divergent");
  assert.equal(plan?.patch.lastError, null);
  assert.equal(plan?.event.beneficiaryReviewPreserved, true);
  assert.equal("bankApprovalObservedAt" in (plan?.patch ?? {}), false);
});

test("divergência de valor não vira alerta cadastral depois de um match exato no extrato", () => {
  const plan = planPaymentRequestStatementSettlement({
    request: { ...request, bankReconciliationDivergenceField: "amount" },
    expenseId: "expense-1",
    bankTransactionId: "statement-1",
    cashAmount: 15.95,
    paidAt: "2026-09-08T15:00:00.000Z",
    observedAt: "2026-09-10T00:38:56.000Z",
  });

  assert.equal(plan?.patch.status, "paid");
  assert.equal(plan?.patch.beneficiaryVerificationStatus, undefined);
  assert.equal(plan?.event.beneficiaryReviewPreserved, false);
});

test("não baixa solicitação com valor ou movimentação incompatível", () => {
  assert.throws(() => planPaymentRequestStatementSettlement({
    request,
    expenseId: "expense-1",
    bankTransactionId: "statement-1",
    cashAmount: 16,
    paidAt: "2026-09-08T15:00:00.000Z",
    observedAt: "2026-09-10T00:38:56.000Z",
  }), /valor da solicitação bancária diverge/);

  assert.throws(() => planPaymentRequestStatementSettlement({
    request: { ...request, statementTransactionId: "statement-other" },
    expenseId: "expense-1",
    bankTransactionId: "statement-1",
    cashAmount: 15.95,
    paidAt: "2026-09-08T15:00:00.000Z",
    observedAt: "2026-09-10T00:38:56.000Z",
  }), /outra movimentação/);
});
