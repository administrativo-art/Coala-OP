import assert from "node:assert/strict";
import test from "node:test";

import { closureDateFromIso, formatClosureMonthLabel } from "../../src/features/financial/cash-closures/date";

test("mês é exibido com capitalização natural em português", () => {
  assert.equal(formatClosureMonthLabel(2026, 8), "Agosto de 2026");
});

test("timestamp local do PDV (sem offset) vira o dia correto sem conversão de fuso", () => {
  assert.equal(closureDateFromIso("2026-07-07 23:50:00"), "2026-07-07");
  assert.equal(closureDateFromIso("2026-07-07 00:10:00"), "2026-07-07");
  assert.equal(closureDateFromIso("2026-07-08 00:10:00"), "2026-07-08");
});

test("timestamp com offset explícito é convertido para America/Belem antes de extrair o dia", () => {
  // 2026-07-08T02:50:00Z = 2026-07-07 23:50 em America/Belem (UTC-3)
  assert.equal(closureDateFromIso("2026-07-08T02:50:00.000Z"), "2026-07-07");
  assert.equal(closureDateFromIso("2026-07-08T00:10:00-03:00"), "2026-07-08");
});

test("data vazia ou em formato não reconhecido lança erro em vez de mascarar o dia", () => {
  assert.throws(() => closureDateFromIso(""));
  assert.throws(() => closureDateFromIso("data-invalida"));
});
