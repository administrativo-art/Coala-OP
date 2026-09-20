import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const expensesPageSource = readFileSync(
  "src/features/financial/pages/expenses-page.tsx",
  "utf8",
);

test("semanas de vencimento podem ser recolhidas no desktop e no mobile", () => {
  assert.match(expensesPageSource, /collapsedDueWeeks/);
  assert.match(expensesPageSource, /dueWeekKey: group\.key/);
  assert.match(expensesPageSource, /collapsedDueWeeks\.has\(row\.dueWeekKey\)/);
  assert.equal(
    [...expensesPageSource.matchAll(/aria-expanded=\{!isCollapsed\}/g)].length,
    2,
  );
  assert.equal(
    [...expensesPageSource.matchAll(/onClick=\{\(\) => toggleDueWeek\(row\.group\.key\)\}/g)].length,
    2,
  );
});
