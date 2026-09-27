import assert from "node:assert/strict";
import test from "node:test";
import { budgetComparisonTotals, budgetExpenseHref, canViewBudgetComparison } from "../../src/features/financial/budgets/comparison";
import { defaultGuestPermissions } from "../../src/types";
import type { FinancialBudgetSummary } from "../../src/features/financial/budgets/types";

const budget = (planned: number, committed: number): FinancialBudgetSummary => ({ id: "budget", name: "VT", competenceMonth: "2026-10", accountPlanIds: ["vt"], budgetedAmountCents: planned,
  active: true, source: "manual", ruleId: null, calculationMode: "manual", calculationSnapshot: null, createdBy: "test", createdAt: "", updatedAt: "",
  consumedAmountCents: committed, forecastCoverageAmountCents: 0, balanceAmountCents: planned - committed, usageRatio: committed / planned, residualAmountCents: 0,
  expenses: [{ id: "single-bill", description: "Boleto VT", amountCents: committed, impactDate: "2026-10-01" }], curve: [], issues: [] });

test("um boleto rateado é contado uma vez; diferença não vira compra se cobertura está encerrada", () => {
  assert.deepEqual(budgetComparisonTotals([budget(48160, 50400), budget(47320, 7560), budget(46480, 48720), { ...budget(1, 1), active: false }]),
    { planned: 141960, committed: 106680, difference: 35280, expected: 0, documentCount: 1 });
  assert.equal(budgetComparisonTotals([{ ...budget(100, 0), residualAmountCents: undefined }]).expected, null);
});

test("acesso mantém a permissão de orçamento e não é concedido apenas por despesas", () => {
  const permissions = structuredClone(defaultGuestPermissions);
  assert.equal(canViewBudgetComparison(permissions), false);
  assert.equal(canViewBudgetComparison(permissions, true), true);
  permissions.financial.view = true;
  permissions.financial.expenses.view = true;
  assert.equal(canViewBudgetComparison(permissions), false);
  permissions.financial.cashFlow.view = true;
  assert.equal(canViewBudgetComparison(permissions), true);
  permissions.financial.view = false;
  assert.equal(canViewBudgetComparison(permissions), false);
});

test("link de despesa abre consulta na competência original sem entrar em edição", () => {
  const link = new URL(budgetExpenseHref("bill&scope=all", "2026-10"), "https://example.test");
  assert.equal(link.pathname, "/dashboard/financial/expenses");
  assert.equal(link.searchParams.get("expense"), "bill&scope=all");
  assert.equal(link.searchParams.get("competence"), "2026-10");
  assert.equal(link.searchParams.has("edit"), false);
});
