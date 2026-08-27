import assert from "node:assert/strict";
import test from "node:test";

import {
  compareExpenseCompetenceMonths,
  consolidateExpenseObligations,
  groupExpensesByDueWeek,
} from "../../src/features/financial/lib/expense-list";

test("ordena competências em uma única sequência cronológica, sem retornar ao ano inicial", () => {
  const months = [
    "2026-08",
    "2027-01",
    "2028-04",
    "2026-07",
    "2027-12",
    "2026-06",
  ];

  assert.deepEqual(months.sort(compareExpenseCompetenceMonths), [
    "2028-04",
    "2027-12",
    "2027-01",
    "2026-08",
    "2026-07",
    "2026-06",
  ]);
});

test("exibe previsão conciliada e realizado como uma única obrigação", () => {
  const actual = {
    id: "actual-1",
    status: "paid",
    provisionType: "actual",
    totalValue: 1268.6,
  };
  const forecast = {
    id: "forecast-1",
    status: "reconciled",
    provisionType: "forecast",
    replacedByExpenseId: "actual-1",
    totalValue: 1787.3,
  };

  assert.deepEqual(consolidateExpenseObligations([actual, forecast]), [actual]);
});

test("mantém previsão conciliada órfã visível para não ocultar inconsistência", () => {
  const forecast = {
    id: "forecast-1",
    status: "reconciled",
    provisionType: "forecast",
    replacedByExpenseId: "missing-actual",
  };

  assert.deepEqual(consolidateExpenseObligations([forecast]), [forecast]);
});

test("agrupa despesas por semanas de vencimento iniciadas na segunda-feira", () => {
  const expenses = [
    { id: "a", dueDate: new Date("2026-08-03T12:00:00-03:00"), totalValue: 100 },
    { id: "b", dueDate: new Date("2026-08-09T12:00:00-03:00"), totalValue: 250 },
    { id: "c", dueDate: new Date("2026-08-10T12:00:00-03:00"), totalValue: 50 },
    { id: "d", dueDate: null, totalValue: 20 },
  ];

  const groups = groupExpensesByDueWeek(
    expenses,
    (expense) => expense.dueDate,
    (expense) => expense.totalValue,
  );

  assert.deepEqual(groups.map((group) => ({
    key: group.key,
    label: group.label,
    ids: group.expenses.map((expense) => expense.id),
    totalValue: group.totalValue,
  })), [
    { key: "2026-08-03", label: "03 a 09/08/2026", ids: ["a", "b"], totalValue: 350 },
    { key: "2026-08-10", label: "10 a 16/08/2026", ids: ["c"], totalValue: 50 },
    { key: "without-due-date", label: "Sem vencimento definido", ids: ["d"], totalValue: 20 },
  ]);
});
