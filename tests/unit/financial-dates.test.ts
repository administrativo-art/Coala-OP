import assert from "node:assert/strict";
import test from "node:test";

import {
  financialDateFromIso,
  financialDateKey,
  financialMonthKey,
} from "../../src/features/financial/lib/financial-dates";

test("grava e lê datas financeiras no calendário de Belém sem recuar um dia", () => {
  const dueDate = financialDateFromIso("2026-09-05");
  assert.equal(dueDate.toISOString(), "2026-09-05T15:00:00.000Z");
  assert.equal(financialDateKey(dueDate), "2026-09-05");
  assert.equal(financialMonthKey(dueDate), "2026-09");
});
