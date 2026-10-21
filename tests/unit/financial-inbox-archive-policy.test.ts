import assert from "node:assert/strict";
import test from "node:test";

import { financialInboxArchiveEligibility } from "../../src/features/financial/inbox/archive-policy";
import type { FinancialInboxMessage } from "../../src/features/financial/inbox/types";

const base = {
  id: "message-1",
  workspaceId: "workspace-1",
  status: "ignored", linkedExpenseId: null, obligationId: null, paymentRequestId: null,
  bankState: "not_prepared", resolution: { status: "discarded" },
} as FinancialInboxMessage;
const noEvidence = { paymentRequestStatus: null, paymentStatementStatus: null, obligationStatus: null };
const settledExpense = {
  expenseId: "expense-1", expenseWorkspaceId: "workspace-1", expenseStatus: "paid",
  expenseInboxMessageId: "message-1", expenseObligationId: "obligation-1",
  expenseReconciliationStatus: "MATCHED",
};

test("ruído automático arquiva uma vez; arquivo já criado é idempotente", () => {
  assert.equal(financialInboxArchiveEligibility(base, noEvidence).eligible, true);
  assert.equal(financialInboxArchiveEligibility({ ...base, status: "archived" }, noEvidence).reasonCode, "ALREADY_ARCHIVED");
  assert.equal(financialInboxArchiveEligibility({ ...base, linkedExpenseId: "expense-1" }, noEvidence).reasonCode, "IGNORED_WITH_FINANCIAL_LINK");
  assert.equal(financialInboxArchiveEligibility({ ...base, bankState: "submitted" }, noEvidence).reasonCode, "IGNORED_WITH_FINANCIAL_LINK");
});

test("cobrança válida exige estado terminal e evidência financeira concluída", () => {
  const treated = {
    ...base, status: "reconciled", bankState: "reconciled", linkedExpenseId: "expense-1",
    obligationId: "obligation-1", paymentRequestId: "request-1",
  } as FinancialInboxMessage;
  assert.equal(financialInboxArchiveEligibility(treated, {
    ...settledExpense,
    paymentRequestStatus: "paid", paymentStatementStatus: "matched", obligationStatus: "PAID",
    paymentSourceType: "financial_inbox", paymentSourceId: treated.id, paymentExpenseId: "expense-1",
    obligationSourceId: "expense-1",
  }).eligible, true);
  assert.equal(financialInboxArchiveEligibility(treated, { ...noEvidence, ...settledExpense, paymentRequestStatus: "scheduled" }).reasonCode, "PAYMENT_IN_PROGRESS");
  assert.equal(financialInboxArchiveEligibility({ ...treated, status: "scheduled" }, noEvidence).reasonCode, "NOT_TERMINAL");
  assert.equal(financialInboxArchiveEligibility({ ...treated, status: "linked" }, noEvidence).reasonCode, "NOT_TERMINAL");
  assert.equal(financialInboxArchiveEligibility({ ...treated, bankState: "awaiting_statement" }, noEvidence).reasonCode, "BANK_IN_PROGRESS");
  assert.equal(financialInboxArchiveEligibility(treated, {
    ...settledExpense,
    paymentRequestStatus: "paid", paymentStatementStatus: "matched", obligationStatus: "OPEN",
    paymentSourceType: "financial_inbox", paymentSourceId: treated.id, paymentExpenseId: "expense-1",
    obligationSourceId: "expense-1",
  }).reasonCode, "OBLIGATION_IN_PROGRESS");
  assert.equal(financialInboxArchiveEligibility(treated, {
    ...settledExpense, ...noEvidence, expenseStatus: "pending",
  }).reasonCode, "EXPENSE_NOT_SETTLED");
  assert.equal(financialInboxArchiveEligibility(treated, {
    ...settledExpense, ...noEvidence, expenseReconciliationStatus: "DIVERGENT",
  }).reasonCode, "EXPENSE_NOT_SETTLED");
  assert.equal(financialInboxArchiveEligibility(treated, {
    ...settledExpense, ...noEvidence, expenseInboxMessageId: "other-message",
  }).reasonCode, "EXPENSE_LINK_CONFLICT");
  assert.equal(financialInboxArchiveEligibility(treated, {
    ...settledExpense, ...noEvidence, expenseWorkspaceId: "other-workspace",
  }).reasonCode, "EXPENSE_LINK_CONFLICT");
});

test("identificada só é terminal se a resolução registrar reconciliação", () => {
  assert.equal(financialInboxArchiveEligibility({ ...base, status: "identified" }, noEvidence).reasonCode, "NOT_TERMINAL");
  const resolved = { ...base, status: "identified", bankState: null, resolution: {
    status: "identified", financialState: "reconciled", targetType: "expense", targetId: "expense-1", kind: "reminder",
  } } as FinancialInboxMessage;
  assert.equal(financialInboxArchiveEligibility(resolved, { ...noEvidence, ...settledExpense, expenseObligationId: null }).eligible, true);
  assert.equal(financialInboxArchiveEligibility(resolved, noEvidence).reasonCode, "EXPENSE_LINK_CONFLICT");
});

test("handoff agendado permite arquivar o e-mail sem confundir agendamento com liquidação", () => {
  const scheduled = {
    ...base,
    status: "scheduled",
    bankState: "scheduled",
    linkedExpenseId: "expense-1",
    paymentRequestId: "request-1",
    resolution: {
      status: "identified",
      financialState: "scheduled",
      targetType: "expense",
      targetId: "expense-1",
      kind: "new_charge",
    },
  } as FinancialInboxMessage;
  const evidence = {
    ...noEvidence,
    ...settledExpense,
    expenseStatus: "pending",
    expenseReconciliationStatus: "PENDING",
    expensePaymentRequestId: "request-1",
    paymentRequestId: "request-1",
    paymentRequestStatus: "scheduled",
    paymentWorkspaceId: "workspace-1",
    paymentInterRequestId: "inter-1",
    paymentSourceType: "financial_inbox",
    paymentSourceId: "message-1",
    paymentExpenseId: "expense-1",
  };
  assert.equal(financialInboxArchiveEligibility(scheduled, evidence).reasonCode, "FINANCIAL_HANDOFF_CONFIRMED");
  assert.equal(financialInboxArchiveEligibility(scheduled, { ...evidence, paymentInterRequestId: null }).eligible, false);
  assert.equal(financialInboxArchiveEligibility({ ...scheduled, status: "payment_failed", bankState: "failed" }, evidence).reasonCode, "PAYMENT_FAILED");
});

test("lembrete usa o pedido da despesa sem exigir que seja a mensagem principal", () => {
  const reminder = {
    ...base,
    status: "identified",
    bankState: "scheduled",
    resolution: {
      status: "identified",
      financialState: "scheduled",
      targetType: "expense",
      targetId: "expense-1",
      kind: "reminder",
    },
  } as FinancialInboxMessage;
  assert.equal(financialInboxArchiveEligibility(reminder, {
    ...noEvidence,
    ...settledExpense,
    expenseInboxMessageId: "primary-message",
    expenseStatus: "pending",
    expenseReconciliationStatus: "PENDING",
    expensePaymentRequestId: "request-1",
    paymentRequestId: "request-1",
    paymentRequestStatus: "scheduled",
    paymentWorkspaceId: "workspace-1",
    paymentInterRequestId: "inter-1",
    paymentSourceType: "financial_inbox",
    paymentSourceId: "primary-message",
    paymentExpenseId: "expense-1",
  }).eligible, true);
});
