import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const expensesPageSource = readFileSync(
  "src/features/financial/pages/expenses-page.tsx",
  "utf8",
);

const weekHeaderSource = readFileSync(
  "src/features/financial/components/expenses/expense-list-rows.tsx",
  "utf8",
);

test("semanas de vencimento podem ser recolhidas em qualquer largura", () => {
  assert.match(expensesPageSource, /collapsedDueWeeks/);
  assert.match(expensesPageSource, /dueWeekKey: group\.key/);
  assert.match(expensesPageSource, /collapsedDueWeeks\.has\(row\.dueWeekKey\)/);
  // Um único cabeçalho responsivo atende desktop e mobile.
  assert.equal([...expensesPageSource.matchAll(/<DueWeekHeader/g)].length, 1);
  assert.match(expensesPageSource, /onToggle=\{\(\) => toggleDueWeek\(row\.group\.key\)\}/);
  assert.match(weekHeaderSource, /aria-expanded=\{!collapsed\}/);
});
