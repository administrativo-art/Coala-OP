import assert from "node:assert/strict";
import test from "node:test";
import { calculateProjectBudgetConsumption } from "../../src/features/financial/lib/budget-project-consumption";

const project = { accountPlanIds: ["reforma", "material"], startMonth: "2026-10", endMonth: "2027-01", budgetedAmountCents: 500000 };

test("projeto soma despesas vinculadas de competências diferentes e parcelas elegíveis", () => {
  const result = calculateProjectBudgetConsumption(project, [
    { id: "mão-de-obra", status: "paid", competenceMonth: "2026-10", accountId: "reforma", totalValue: 1000 },
    { id: "material", status: "pending", competenceMonth: "2026-12", totalValue: 2000,
      hasAccountAllocations: true, accountAllocations: [
        { accountPlanId: "material", amount: 600 }, { accountPlanId: "fora", amount: 1400 },
      ] },
    { id: "fora-do-periodo", status: "pending", competenceMonth: "2027-02", accountId: "reforma", totalValue: 700 },
    { id: "previsao", status: "provisioned", provisionType: "forecast", competenceMonth: "2026-11", accountId: "reforma", totalValue: 900 },
  ]);
  assert.equal(result.consumedAmountCents, 160000);
  assert.equal(result.balanceAmountCents, 340000);
  assert.deepEqual(result.expenses.map((item) => item.id), ["mão-de-obra", "material"]);
  assert.deepEqual(result.issues, ["Despesa fora-do-periodo fora do período do projeto."]);
});
