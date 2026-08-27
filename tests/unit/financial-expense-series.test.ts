import assert from "node:assert/strict";
import test from "node:test";

import {
  selectExpenseSeriesEntries,
  type ExpenseSeriesEntry,
} from "../../src/features/financial/lib/expense-series";

const agreement = Array.from({ length: 21 }, (_, index) => ({
  id: `parcela-${index + 5}`,
  recurrenceIndex: index + 5,
  installmentNumber: index + 5,
  dueDate: new Date(2026, 7 + index, 15),
}));

test("esta e as próximas começa na parcela atualmente editada", () => {
  const current = agreement.find((entry) => entry.recurrenceIndex === 10)!;
  const selected = selectExpenseSeriesEntries(agreement, current, "current-and-future");

  assert.equal(selected.length, 16);
  assert.equal(selected[0]?.recurrenceIndex, 10);
  assert.equal(selected.at(-1)?.recurrenceIndex, 25);
});

test("todas inclui também as parcelas existentes anteriores", () => {
  const current = agreement.find((entry) => entry.recurrenceIndex === 10)!;

  assert.equal(selectExpenseSeriesEntries(agreement, current, "all").length, 21);
  assert.equal(selectExpenseSeriesEntries(agreement, current, "single").length, 1);
});

test("usa o vencimento quando a série legada não possui numeração", () => {
  const entries: ExpenseSeriesEntry[] = [
    { id: "agosto", dueDate: "2026-08-15T12:00:00-03:00" },
    { id: "setembro", dueDate: "2026-09-15T12:00:00-03:00" },
    { id: "outubro", dueDate: "2026-10-15T12:00:00-03:00" },
  ];

  assert.deepEqual(
    selectExpenseSeriesEntries(entries, entries[1], "current-and-future").map((entry) => entry.id),
    ["setembro", "outubro"]
  );
});
