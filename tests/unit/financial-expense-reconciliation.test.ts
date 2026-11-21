import assert from "node:assert/strict";
import test from "node:test";

import {
  expenseNeedsImportedBankEvidence,
  expenseReconciliationSummary,
  indexExpenseBankTransactions,
  resolveExpenseReconciliation,
  type ExpenseBankTransaction,
  type ExpenseReconciliationSource,
} from "../../src/features/financial/obligations/expense-reconciliation";

const paid: ExpenseReconciliationSource = {
  id: "title", status: "paid", totalValue: 100, workspaceId: "coala",
  settlementSummary: { paymentEvidenceStatus: "NONE", reconciliationStatus: "NOT_FOUND" },
};
const debit: ExpenseBankTransaction = {
  id: "debit", expenseId: paid.id, amount: 100, type: "expense", workspaceId: "coala",
  importSource: "inter_api", importedFrom: "bank_statement", auditStatus: "resolved", direction: "out",
};

test("um vínculo de extrato existente confirma a baixa mesmo com resumo antigo", () => {
  const index = indexExpenseBankTransactions([debit]);
  const reconciliation = resolveExpenseReconciliation(paid, index);
  assert.equal(reconciliation, "bank");
  const summary = expenseReconciliationSummary(paid, reconciliation);
  assert.equal(summary.reconciliationStatus, "MATCHED");
  assert.equal(summary.confirmedCashAmountCents, 10000);
  assert.equal(summary.balanceAmountCents, 0);
});

test("valor idêntico e referência unilateral não confirmam vínculo ausente", () => {
  const index = indexExpenseBankTransactions([{ ...debit, expenseId: undefined }]);
  assert.equal(resolveExpenseReconciliation({ ...paid, linkedBankTransactionId: debit.id }, index), "unmatched");
  assert.equal(resolveExpenseReconciliation(paid, indexExpenseBankTransactions([{ ...debit, amount: 101 }])), "unmatched");
  assert.equal(resolveExpenseReconciliation(paid, indexExpenseBankTransactions([debit, { ...debit, id: "other" }])), "unmatched");
});

test("transação apagada da conferência, estornada, crédito ou de outro workspace não confirma a despesa", () => {
  const invalidDebits: Partial<ExpenseBankTransaction>[] = [
    { auditStatus: "pending" },
    { reversed: true },
    { effectuationStatus: "reopened" },
    { effectuationStatus: "reversed" },
    { direction: "in" },
    { workspaceId: "outra-empresa" },
    { importedFrom: undefined, importSource: undefined },
  ];
  for (const invalid of invalidDebits) {
    assert.equal(resolveExpenseReconciliation(paid, indexExpenseBankTransactions([{ ...debit, ...invalid }])), "unmatched");
  }
});

test("encargo ligado ao débito do principal tem sua própria saída", () => {
  const charge: ExpenseReconciliationSource = {
    ...paid, id: "fee", type: "encargo", originExpenseId: paid.id,
    totalValue: 4.25, linkedBankTransactionId: debit.id, evidenceSource: "BANK_STATEMENT",
  };
  const index = indexExpenseBankTransactions([{ ...debit, amount: 104.25 }]);
  const reconciliation = resolveExpenseReconciliation(charge, index);
  assert.equal(reconciliation, "bank");
  assert.equal(expenseReconciliationSummary(charge, reconciliation).cashPaidAmountCents, 425);
  assert.equal(resolveExpenseReconciliation({ ...charge, originExpenseId: "wrong" }, index), "unmatched");
  assert.equal(resolveExpenseReconciliation({ ...charge, evidenceSource: undefined }, index), "unmatched");
});

test("débito que quita mais de um título exige a alocação exata da própria despesa", () => {
  const sharedDebit = { ...debit, amount: 130, expenseIds: [paid.id, "another"] };
  const allocation = [{ expenseId: paid.id, principalAmount: 100 }, { expenseId: "another", principalAmount: 30 }];
  assert.equal(resolveExpenseReconciliation(paid, indexExpenseBankTransactions([sharedDebit])), "unmatched");
  assert.equal(resolveExpenseReconciliation(paid, indexExpenseBankTransactions([{ ...sharedDebit, obligationAllocations: allocation }])), "bank");
});

test("confirmações canônicas, divergências, caixa e cartão mantêm sua regra", () => {
  const index = indexExpenseBankTransactions([debit]);
  for (const [reconciliationStatus, expected] of [
    ["MATCHED", "bank"], ["DIVERGENT", "divergent"], ["PENDING_DOCUMENT", "pending_document"],
  ] as const) {
    const expense = { ...paid, settlementSummary: { paymentEvidenceStatus: "CONFIRMED", reconciliationStatus } };
    assert.equal(resolveExpenseReconciliation(expense, index), expected);
    assert.equal(expenseNeedsImportedBankEvidence(expense), false);
  }
  const reported = { ...paid, paymentState: "reported_paid" };
  assert.equal(resolveExpenseReconciliation(reported), "reported");
  assert.equal(resolveExpenseReconciliation(reported, index), "bank");
  assert.equal(resolveExpenseReconciliation({ ...paid, plannedPaymentMethodType: "cash" }, index), "cash");
  assert.equal(resolveExpenseReconciliation({ ...paid, plannedPaymentMethodType: "credit_card" }, index), "unmatched");
});
