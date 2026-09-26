import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { allowedBudgetCenters, purchaseDatePreview, compositionTotal, coveragePayload } from "../../src/features/financial/components/settings/budget-ui-model";
import { expensePersonCenterTotals } from "../../src/features/financial/components/expenses/expense-person-center-totals";
import { cashForecastTotals, budgetScenarioAmount } from "../../src/features/financial/budgets/projection-view";
import type { BudgetPersonSummary } from "../../src/features/financial/budgets/types";

test("UI separa competência, compra, saldo e dívida; soma centavos por centro", () => {
  assert.equal(purchaseDatePreview("2026-03", 31, -1), "2026-02-28");
  assert.equal(purchaseDatePreview("2026-10", 30, -1), "2026-09-30");
  assert.equal(compositionTotal([{ amountCents: 3333 }, { amountCents: 6667 }]), 10000);
  assert.deepEqual(cashForecastTotals([{ amount: 10, source: "expense" }, { amount: 20, source: "expense_forecast" }, { amount: 30, source: "budget_residual" }, { amount: 40, source: "budget_scenario" }]), { payable: 10, planning: 50, scenario: 40 });
  assert.equal(budgetScenarioAmount({ hasComposition: true, balanceAmountCents: 840, forecastCoverageAmountCents: 0 }), 0);
  assert.equal(budgetScenarioAmount({ balanceAmountCents: 2000, forecastCoverageAmountCents: 500 }), 1500);
  const base = { employeeId: "a", employeeName: "Sintética", accountPlanId: "vt", analysisType: "employer_cost" as const };
  assert.deepEqual(expensePersonCenterTotals([{ ...base, resultCenter: "A", amount: 0.1 }, { ...base, resultCenter: "A", amount: 0.2 }, { ...base, resultCenter: "B", amount: 1 }]), [{ resultCenter: "A", amountCents: 30 }, { resultCenter: "B", amountCents: 100 }]);
});
test("opções respeitam todas as unidades do centro, sem inventar rateio", () => {
  const centers = [{ id: "a", name: "A", unitIds: ["a"] }, { id: "shared", name: "Compartilhado", unitIds: ["a", "b"] }];
  assert.deepEqual(allowedBudgetCenters(centers, { unitIds: ["a"] }, false).map((center) => center.id), ["a"]);
  assert.equal(allowedBudgetCenters(centers, {}, true).length, 2);
});
test("conferência exige confirmação, motivo e reenviará fingerprints observados", () => {
  const line: BudgetPersonSummary = { id: "line", employeeId: "person", employeeName: "Sintética", accountPlanId: "vt", amountCents: 200,
    expectedPurchaseDate: "2026-09-30", estimateSource: "manual", balanceAmountCents: 100, residualAmountCents: 100, coverageState: "partial",
    committedAmountCents: 100, documentIds: ["bill"], documentFingerprints: { bill: "a".repeat(64) } };
  assert.throws(() => coveragePayload(line, "final", "Conferido", false));
  assert.throws(() => coveragePayload(line, "not_required", "Conferido", true));
  assert.deepEqual(coveragePayload(line, "final", "Conferido", true).documentFingerprints, line.documentFingerprints);
});
test("centro por pessoa visível mesmo para uma única pessoa; sem execução de navegador", () => {
  const source = readFileSync(new URL("../../src/features/financial/components/expenses/expense-expanded-details.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("Centro de custo"));
  assert.ok(!source.includes("peopleCount > 1"));
  const picker = readFileSync(new URL("../../src/features/financial/components/settings/budget-composition-editor.tsx", import.meta.url), "utf8");
  assert.ok(picker.includes("Carregar mais colaboradores"));
  assert.ok(!picker.includes("setInterval"));
});
