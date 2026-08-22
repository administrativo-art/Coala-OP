import assert from "node:assert/strict";
import test from "node:test";

import {
  compareExpensesByDueDate,
  compareExpensesByDueDateDirection,
  compareExpensesByValue,
} from "../../src/features/financial/lib/expense-order";

test("orders expenses chronologically by due date", () => {
  const expenses = [
    { id: "sep", description: "Parcela setembro", dueDate: new Date("2026-09-15T12:00:00") },
    { id: "aug-23", description: "Compra Natucopos", dueDate: new Date("2026-08-23T12:00:00") },
    { id: "aug-05", description: "Compra Amazon", dueDate: new Date("2026-08-05T12:00:00") },
    { id: "aug-15", description: "Parcela agosto", dueDate: new Date("2026-08-15T12:00:00") },
  ];

  assert.deepEqual(expenses.sort(compareExpensesByDueDate).map((expense) => expense.id), [
    "aug-05",
    "aug-15",
    "aug-23",
    "sep",
  ]);
});

test("puts invalid dates last and uses description as a same-day tie-breaker", () => {
  const expenses = [
    { id: "missing", description: "Sem vencimento" },
    { id: "zulu", description: "Zulu", dueDate: "2026-08-15T12:00:00" },
    { id: "alpha", description: "Água", dueDate: { toDate: () => new Date("2026-08-15T12:00:00") } },
    { id: "invalid", description: "Data inválida", dueDate: "não é uma data" },
  ];

  assert.deepEqual(expenses.sort(compareExpensesByDueDate).map((expense) => expense.id), [
    "alpha",
    "zulu",
    "invalid",
    "missing",
  ]);
});

test("alternates due-date direction while keeping missing dates last", () => {
  const expenses = [
    { id: "missing", description: "Sem vencimento" },
    { id: "aug", description: "Agosto", dueDate: "2026-08-10T12:00:00" },
    { id: "sep", description: "Setembro", dueDate: "2026-09-10T12:00:00" },
  ];

  assert.deepEqual(
    [...expenses].sort((left, right) => compareExpensesByDueDateDirection(left, right, "desc")).map((expense) => expense.id),
    ["sep", "aug", "missing"],
  );
});

test("orders expenses by value in both directions", () => {
  const expenses = [
    { id: "medium", description: "Médio", totalValue: 100 },
    { id: "high", description: "Alto", totalValue: 300 },
    { id: "low", description: "Baixo", totalValue: 25 },
  ];

  assert.deepEqual(
    [...expenses].sort((left, right) => compareExpensesByValue(left, right, "asc")).map((expense) => expense.id),
    ["low", "medium", "high"],
  );
  assert.deepEqual(
    [...expenses].sort((left, right) => compareExpensesByValue(left, right, "desc")).map((expense) => expense.id),
    ["high", "medium", "low"],
  );
});
