import assert from "node:assert/strict";
import test from "node:test";

import {
  cashDepositBatchReference,
  cashDepositBatchReferenceFromId,
  cashDepositKioskCode,
  groupCashDepositItemsByDay,
} from "../../src/features/financial/cash-deposits/references";
import type { CashDepositBatchItem } from "../../src/features/financial/cash-deposits/types";

test("referências internas usam códigos únicos e sequência legível", () => {
  assert.equal(cashDepositKioskCode("tirirical"), "TRI");
  assert.equal(cashDepositKioskCode("joao-paulo"), "JPA");
  assert.equal(cashDepositBatchReference({ kioskId: "tirirical", sequence: 12 }), "DEP-TRI-000012");
  assert.equal(
    cashDepositBatchReferenceFromId("joao-paulo", "coala_joao-paulo_000007"),
    "DEP-JPA-000007",
  );
});

test("itens do depósito são consolidados por dia preservando ajustes e origens", () => {
  const base: Omit<CashDepositBatchItem, "id" | "amountCents" | "source"> = {
    workspaceId: "coala",
    batchId: "batch-1",
    closureId: "tirirical_2026-08-03",
    closureDate: "2026-08-03",
    kioskId: "tirirical",
    operatorBreakdown: [],
    createdAt: "2026-08-04T10:00:00.000Z",
  };
  const result = groupCashDepositItemsByDay([
    { ...base, id: "cash", amountCents: 35_650, source: "cash_counted" },
    { ...base, id: "adjustment", amountCents: -1_000, source: "cash_adjustment" },
    {
      ...base,
      id: "next-day",
      closureId: "tirirical_2026-08-04",
      closureDate: "2026-08-04",
      amountCents: 48_000,
      source: "cash_counted",
    },
  ]);

  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    date: "2026-08-03",
    amountCents: 34_650,
    closureIds: ["tirirical_2026-08-03"],
    sources: ["cash_counted", "cash_adjustment"],
    itemCount: 2,
  });
  assert.equal(result[1].amountCents, 48_000);
});
