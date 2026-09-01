import assert from "node:assert/strict";
import test from "node:test";

import {
  createCashCountingSessionSchema,
  saveCashCountingSessionDraftPositionSchema,
} from "../../src/features/financial/cash-counting-sessions/schemas";

test("sessão de contagem é criada somente com unidades", () => {
  assert.equal(createCashCountingSessionSchema.safeParse({ kioskIds: ["unit-1"] }).success, true);
  assert.equal(createCashCountingSessionSchema.safeParse({
    kioskIds: ["unit-1"],
    periods: [{ year: 2035, month: 9 }],
  }).success, false);
});

test("posição do rascunho exige unidade e data civil válida", () => {
  assert.equal(saveCashCountingSessionDraftPositionSchema.safeParse({
    kioskId: "unit-1",
    date: "2035-09-12",
  }).success, true);
  assert.equal(saveCashCountingSessionDraftPositionSchema.safeParse({
    kioskId: "unit-1",
    date: "2035-02-30",
  }).success, false);
});
