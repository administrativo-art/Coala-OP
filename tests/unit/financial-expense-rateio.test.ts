import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEqualRateio,
  distributeRateioPercentages,
  expenseValueForResultCenter,
  isRateioOccurrenceEligible,
  resolveRateioForCompetence,
  type ExpenseRateioPolicy,
} from "../../src/features/financial/lib/expense-rateio";
import { expenseFormSchema } from "../../src/features/financial/lib/schemas";

test("divide o rateio igualitário em 100% mesmo quando há dízima", () => {
  assert.deepEqual(distributeRateioPercentages([1, 1, 1]), [33.34, 33.33, 33.33]);
  assert.deepEqual(buildEqualRateio(["A", "B", "C", "D"]).map((item) => item.percentage), [25, 25, 25, 25]);
});

test("inclui uma nova unidade somente a partir da competência definida", () => {
  const policy: ExpenseRateioPolicy = {
    versionId: "v-setembro",
    criterion: "equal",
    effectiveFrom: "2026-08-01",
    firstMonthMode: "full",
    participants: [
      ...buildEqualRateio(["A", "B", "C"], "2026-08-01"),
      { resultCenter: "Shopping do Automóvel", percentage: 0, participationStartDate: "2026-09-01" },
    ],
  };

  assert.deepEqual(resolveRateioForCompetence(policy, "2026-08-01"), [
    { resultCenter: "A", percentage: 33.34 },
    { resultCenter: "B", percentage: 33.33 },
    { resultCenter: "C", percentage: 33.33 },
  ]);
  assert.deepEqual(resolveRateioForCompetence(policy, "2026-09-01"), [
    { resultCenter: "A", percentage: 25 },
    { resultCenter: "B", percentage: 25 },
    { resultCenter: "C", percentage: 25 },
    { resultCenter: "Shopping do Automóvel", percentage: 25 },
  ]);
});

test("calcula critérios por base de faturamento ou funcionários", () => {
  const policy: ExpenseRateioPolicy = {
    versionId: "v-base",
    criterion: "revenue",
    effectiveFrom: "2026-09-01",
    firstMonthMode: "full",
    participants: [
      { resultCenter: "A", percentage: 0, basisValue: 300 },
      { resultCenter: "B", percentage: 0, basisValue: 100 },
    ],
  };

  assert.deepEqual(resolveRateioForCompetence(policy, "2026-09-01"), [
    { resultCenter: "A", percentage: 75 },
    { resultCenter: "B", percentage: 25 },
  ]);
});

test("aplica proporcionalidade somente quando escolhida explicitamente", () => {
  const policy: ExpenseRateioPolicy = {
    versionId: "v-proporcional",
    criterion: "equal",
    effectiveFrom: "2026-09-01",
    firstMonthMode: "prorated",
    participants: [
      { resultCenter: "A", percentage: 0, participationStartDate: "2026-08-01" },
      { resultCenter: "B", percentage: 0, participationStartDate: "2026-09-16" },
    ],
  };

  assert.deepEqual(resolveRateioForCompetence(policy, "2026-09-01"), [
    { resultCenter: "A", percentage: 66.67 },
    { resultCenter: "B", percentage: 33.33 },
  ]);
});

test("uma nova versão só altera ocorrências pendentes dentro da vigência", () => {
  assert.equal(isRateioOccurrenceEligible({ status: "paid", competenceDate: new Date(2026, 8, 1) }, "2026-09-01"), false);
  assert.equal(isRateioOccurrenceEligible({ status: "pending", competenceDate: new Date(2026, 7, 1) }, "2026-09-01"), false);
  assert.equal(isRateioOccurrenceEligible({ status: "pending", competenceDate: new Date(2026, 8, 1) }, "2026-09-01"), true);
});

test("DRE usa somente a participação da unidade no valor rateado", () => {
  const expense = {
    totalValue: 1200,
    isApportioned: true,
    apportionments: [
      { resultCenter: "A", percentage: 25 },
      { resultCenter: "B", percentage: 75 },
    ],
  };

  assert.equal(expenseValueForResultCenter(expense, "A"), 300);
  assert.equal(expenseValueForResultCenter(expense), 1200);
});

test("recorrência rateada exige vigência e bases válidas para critérios variáveis", () => {
  const recurringExpense = {
    accountPlan: "ocupacao",
    description: "Despesa recorrente rateada",
    supplier: "Fornecedor",
    totalValue: 1200,
    isApportioned: true,
    paymentMethod: "recurring",
    recurrenceFirstDueDate: new Date(2026, 8, 10),
    recurrenceEndDate: new Date(2026, 11, 10),
    rateioCriterion: "revenue",
    rateioFirstMonthMode: "full",
    apportionments: [
      { resultCenter: "A", percentage: 50, basisValue: 300 },
      { resultCenter: "B", percentage: 50, basisValue: 100 },
    ],
  };

  assert.equal(expenseFormSchema.safeParse(recurringExpense).success, false);
  assert.equal(
    expenseFormSchema.safeParse({ ...recurringExpense, rateioEffectiveFrom: new Date(2026, 8, 1) }).success,
    true
  );
  assert.equal(
    expenseFormSchema.safeParse({
      ...recurringExpense,
      rateioEffectiveFrom: new Date(2026, 8, 1),
      apportionments: [
        { resultCenter: "A", percentage: 50, basisValue: 0 },
        { resultCenter: "B", percentage: 50, basisValue: 100 },
      ],
    }).success,
    false
  );
});
