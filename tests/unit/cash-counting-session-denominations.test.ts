import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCashCountingBags,
  normalizeCashCountingDenominations,
} from "../../src/features/financial/cash-counting-sessions/denominations";

test("separa todas as moedas, inclusive R$ 1, das cédulas", () => {
  const result = normalizeCashCountingDenominations([
    { valueCents: 10_000, quantity: 2 },
    { valueCents: 200, quantity: 3 },
    { valueCents: 100, quantity: 4 },
    { valueCents: 25, quantity: 2 },
  ]);

  assert.equal(result.noteTotalCents, 20_600);
  assert.equal(result.coinTotalCents, 450);
  assert.equal(result.totalCents, 21_050);
  assert.equal(result.denominations.find((entry) => entry.valueCents === 100)?.kind, "coin");
});

test("monta malotes determinísticos, balanceados e limitados a R$ 5.000", () => {
  const physical = normalizeCashCountingDenominations([
    { valueCents: 20_000, quantity: 30 },
    { valueCents: 10_000, quantity: 20 },
    { valueCents: 5_000, quantity: 10 },
  ]);
  const bags = buildCashCountingBags({
    sessionId: "session-1",
    denominations: physical.denominations,
    maxCents: 500_000,
    source: "initial_notes",
  });

  assert.equal(bags.length, 2);
  assert.equal(bags.reduce((total, bag) => total + bag.totalCents, 0), physical.noteTotalCents);
  assert.equal(bags.every((bag) => bag.totalCents <= 500_000), true);
  assert.equal(Math.abs(bags[0].totalCents - bags[1].totalCents) <= 20_000, true);
  assert.deepEqual(bags.map((bag) => bag.id), ["session-1_bag_001", "session-1_bag_002"]);
});

test("rejeita denominação duplicada para não inflar o total físico", () => {
  assert.throws(
    () => normalizeCashCountingDenominations([
      { valueCents: 5_000, quantity: 1 },
      { valueCents: 5_000, quantity: 2 },
    ]),
    /mais de uma vez/,
  );
});
