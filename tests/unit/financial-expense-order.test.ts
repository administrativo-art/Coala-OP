import assert from "node:assert/strict";
import test from "node:test";

import { compareExpensesByDueDate } from "../../src/features/financial/lib/expense-order";

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
