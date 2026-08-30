import assert from "node:assert/strict";
import test from "node:test";

import {
  cashCountingPeriodKey,
  cashCountingPeriodLimit,
  toggleCashCountingPeriod,
} from "../../src/features/financial/cash-counting-sessions/period-selection";

test("seletor adiciona, ordena e remove competências sem duplicar", () => {
  const withThreeMonths = toggleCashCountingPeriod(["2026-08", "2026-06"], "2026-07");
  assert.deepEqual(withThreeMonths, ["2026-06", "2026-07", "2026-08"]);

  const withoutJuly = toggleCashCountingPeriod(withThreeMonths, "2026-07");
  assert.deepEqual(withoutJuly, ["2026-06", "2026-08"]);
});

test("seletor respeita o limite de competências e ainda permite desmarcar", () => {
  const selected = ["2026-01", "2026-02", "2026-03"];
  assert.deepEqual(toggleCashCountingPeriod(selected, "2026-04", 3), selected);
  assert.deepEqual(toggleCashCountingPeriod(selected, "2026-02", 3), ["2026-01", "2026-03"]);
});

test("limite de meses acompanha o teto de 36 combinações da sessão", () => {
  assert.equal(cashCountingPeriodLimit(0), 6);
  assert.equal(cashCountingPeriodLimit(6), 6);
  assert.equal(cashCountingPeriodLimit(9), 4);
  assert.equal(cashCountingPeriodLimit(12), 3);
});

test("chave da competência valida ano e mês", () => {
  assert.equal(cashCountingPeriodKey(2026, 8), "2026-08");
  assert.throws(() => cashCountingPeriodKey(2019, 12));
  assert.throws(() => cashCountingPeriodKey(2026, 13));
  assert.throws(() => toggleCashCountingPeriod([], "agosto-2026"));
});
