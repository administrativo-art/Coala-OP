import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFinancialInboxExpenseContext,
  relatedExpenseIdentity,
} from "../../src/features/financial/inbox/charge-case";
import type { FinancialInboxMessage } from "../../src/features/financial/inbox/types";

test("a despesa paga ou agendada é preservada e não pode ser editada pela cobrança", () => {
  const paid = buildFinancialInboxExpenseContext("expense-1", "identified", {
    status: "paid",
    totalValue: 285.6,
    settlementSummary: { reconciliationStatus: "MATCHED" },
  });
  assert.equal(paid.state, "paid");
  assert.equal(paid.editable, false);
  assert.equal(paid.amountCents, 28560);

  const scheduled = buildFinancialInboxExpenseContext("expense-2", "linked", {
    status: "pending",
    paymentRequestId: "request-1",
  });
  assert.equal(scheduled.state, "scheduled");
  assert.equal(scheduled.editable, false);
});

test("leva plano de contas, centro e rateio da despesa para o contexto da nova despesa", () => {
  const context = buildFinancialInboxExpenseContext("expense-1", "suggested", {
    status: "pending",
    accountPlan: "account-1",
    accountPlanName: "Sistemas e licenças",
    referenceResultCenterId: "center-admin",
    referenceResultCenterName: "Administrativo",
    isApportioned: true,
    apportionments: [
      { resultCenter: "Loja A", percentage: 60 },
      { resultCenter: "Loja B", percentage: 40 },
    ],
    rateioCriterion: "fixed",
    rateioEffectiveFrom: "2026-10-01",
    rateioFirstMonthMode: "full",
  });
  assert.equal(context.editable, true);
  assert.equal(context.accounting.accountPlanId, "account-1");
  assert.equal(context.accounting.referenceResultCenterId, "center-admin");
  assert.deepEqual(context.accounting.apportionments.map((item) => item.percentage), [60, 40]);
});

test("prioriza vínculo real e usa identificação apenas como referência", () => {
  const base = {
    linkedExpenseId: "linked-expense",
    resolution: { targetType: "expense", targetId: "identified-expense" },
    existingExpenseSuggestion: { expenseId: "suggested-expense" },
  } as FinancialInboxMessage;
  assert.deepEqual(relatedExpenseIdentity(base), { id: "linked-expense", source: "linked" });
  assert.deepEqual(relatedExpenseIdentity({ ...base, linkedExpenseId: null }), { id: "identified-expense", source: "identified" });
});
