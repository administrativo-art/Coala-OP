import assert from "node:assert/strict";
import test from "node:test";
import { cardStatementDisplayAmounts, cardStatementHasOverdueBalance, expenseCashForecastAmount, expenseDisplayAmounts, expenseDisplayStatus, expenseHasOverdueBalance, showExpenseInOperationalList } from "../../src/features/financial/lib/expense-display-state";
import { buildExpenseLifecycleData } from "../../src/features/financial/lib/cash-flow-analysis";

const now = new Date("2026-09-27T12:00:00-03:00");
const forecast = { status: "pending", provisionType: "forecast", dueDate: "2026-09-10", competenceDate: "2026-09-01T12:00:00-03:00", totalValue: 510,
  paymentState: "payment_found_pending_document", settlementSummary: { reconciliationStatus: "PENDING_DOCUMENT", balanceAmountCents: null, principalSettledAmountCents: 51000 } };

test("previsão com pagamento bancário integral não aparece vencida nem gera nova saída", () => {
  assert.equal(expenseDisplayStatus(forecast, now), "payment_found_pending_document");
  assert.deepEqual(expenseDisplayAmounts(forecast), { open: 0, paid: 510 });
  assert.equal(expenseCashForecastAmount(forecast), 0);
  assert.equal(buildExpenseLifecycleData([forecast], 1, now)[0].paid, 510);
});

test("pagamento parcial reduz só o valor liquidado; cancelamento prevalece sobre projeção antiga", () => {
  const partial = { ...forecast, settlementSummary: { ...forecast.settlementSummary, principalSettledAmountCents: 10000, settlementCreditsAmountCents: 1000 } };
  assert.deepEqual(expenseDisplayAmounts(partial), { open: 400, paid: 100 });
  assert.equal(expenseCashForecastAmount(partial), 400);
  assert.equal(expenseCashForecastAmount({ ...partial, settlementSummary: { ...partial.settlementSummary, balanceAmountCents: 12000 } }), 120);
  for (const status of ["cancelled", "reconciled"]) {
    assert.equal(expenseDisplayStatus({ ...forecast, status }, now), status);
    assert.deepEqual(expenseDisplayAmounts({ ...forecast, status }), { open: 0, paid: 0 });
    assert.equal(expenseCashForecastAmount({ ...forecast, status }), 0);
  }
});

test("vencimento é data de Belém e mantém auditoria e pagamento reportado separados", () => {
  const pending = { status: "pending", totalValue: 39.99, dueDate: "2026-09-27" };
  assert.equal(expenseDisplayStatus(pending, now), "due_soon");
  assert.equal(expenseDisplayStatus({ ...pending, dueDate: "2026-09-26" }, now), "overdue");
  assert.equal(expenseDisplayStatus({ ...pending, dueDate: "2026-09-28" }, now), "pending");
  assert.equal(expenseDisplayStatus({ ...pending, paymentState: "reported_paid" }, now), "reported_paid");
  assert.equal(expenseDisplayStatus({ ...pending, originModule: "purchasing", originStatus: "pending_audit" }, now), "pending_audit");
});

test("saldo vencido independe do rótulo principal usado na linha", () => {
  const partial = {
    status: "partially_paid",
    totalValue: 500,
    dueDate: "2026-09-26",
    settlementSummary: { balanceAmountCents: 40000, principalSettledAmountCents: 10000 },
  };
  const pendingAudit = {
    status: "pending",
    originModule: "purchasing",
    originStatus: "pending_audit",
    totalValue: 250,
    dueDate: "2026-09-26",
  };

  assert.equal(expenseDisplayStatus(partial, now), "partially_paid");
  assert.equal(expenseHasOverdueBalance(partial, now), true);
  assert.equal(expenseDisplayStatus(pendingAudit, now), "pending_audit");
  assert.equal(expenseHasOverdueBalance(pendingAudit, now), true);
  assert.equal(expenseHasOverdueBalance({ ...partial, dueDate: "2026-09-27" }, now), false);
  assert.equal(expenseHasOverdueBalance({ ...partial, settlementSummary: { balanceAmountCents: 0 } }, now), false);
});

test("fatura paga não transforma o saldo futuro da compra parcelada em vencido", () => {
  const paidStatement = {
    status: "paid",
    dueDate: "2026-09-12",
    totalValue: 195.10,
  };
  const futureStatement = {
    status: "open",
    dueDate: "2026-10-12",
    totalValue: 195.10,
  };

  assert.deepEqual(cardStatementDisplayAmounts(paidStatement), { open: 0, paid: 195.10 });
  assert.equal(cardStatementHasOverdueBalance(paidStatement, now), false);
  assert.deepEqual(cardStatementDisplayAmounts(futureStatement), { open: 195.10, paid: 0 });
  assert.equal(cardStatementHasOverdueBalance(futureStatement, now), false);
});

test("provisão convertida sai da lista operacional, continua consultável em canceladas", () => {
  const migrated = { status: "cancelled", budgetMigration: { conversionId: "conversion" } };
  assert.equal(showExpenseInOperationalList(migrated, "all"), false);
  assert.equal(showExpenseInOperationalList(migrated, "cancelled"), true);
  assert.equal(showExpenseInOperationalList({ status: "pending" }, "all"), true);
});
