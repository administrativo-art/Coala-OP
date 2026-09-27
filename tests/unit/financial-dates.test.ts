import assert from "node:assert/strict";
import test from "node:test";

import {
  financialDateFromIso,
  financialDateKey,
  financialMonthKey,
  isValidFinancialDateIso,
} from "../../src/features/financial/lib/financial-dates";

test("grava e lê datas financeiras no calendário de Belém sem recuar um dia", () => {
  const dueDate = financialDateFromIso("2026-09-05");
  assert.equal(dueDate.toISOString(), "2026-09-05T15:00:00.000Z");
  assert.equal(financialDateKey(dueDate), "2026-09-05");
  assert.equal(financialMonthKey(dueDate), "2026-09");
});

test("rejeita dias civis inexistentes antes de normalizar a data", () => {
  assert.equal(isValidFinancialDateIso("2026-02-28"), true);
  assert.equal(isValidFinancialDateIso("2028-02-29"), true);
  assert.equal(isValidFinancialDateIso("2026-02-29"), false);
  assert.equal(isValidFinancialDateIso("2026-02-31"), false);
  assert.equal(isValidFinancialDateIso("2026-99-99"), false);
  assert.throws(() => financialDateFromIso("2026-02-31"), /Data financeira inválida/);
});
