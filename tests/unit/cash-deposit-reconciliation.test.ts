import assert from "node:assert/strict";
import test from "node:test";

import { reconcileCashDepositBatch } from "../../src/features/financial/cash-deposits/reconciliation";
import type { CashDepositBatch, CashDepositBatchItem } from "../../src/features/financial/cash-deposits/types";
import type { CashClosure } from "../../src/features/financial/cash-closures/types";

const baseBatch = {
  id: "batch-1",
  workspaceId: "coala",
  kioskId: "tirirical",
  kioskName: "Tirirical",
  sequence: 1,
  status: "issued",
  maxCents: 500_000,
  grossTotalCents: 10_000,
  totalCents: 10_000,
  coinHoldCents: 0,
  coinPreparedAt: "2026-08-01T12:00:00.000Z",
  coinPreparedBy: "user-1",
  remainingCapacityCents: 490_000,
  periodStartDate: "2026-08-01",
  periodEndDate: "2026-08-01",
  closureIds: ["closure-1"],
  dates: ["2026-08-01"],
  itemCount: 1,
  lockReason: null,
  nextRejectedClosureId: null,
  nextRejectedCents: null,
  bankProvider: "inter",
  interCobrancaId: null,
  interCobrancaIds: [],
  bankWarning: null,
  lastBankSyncAt: null,
  ledgerTransactionId: null,
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z",
  issuedAt: "2026-08-01T12:00:00.000Z",
  issuedBy: "user-1",
  paidAt: null,
  cancelledAt: null,
  cancelledBy: null,
  cancellationReason: null,
} satisfies CashDepositBatch;

const baseItem = {
  id: "closure-1_cash",
  workspaceId: "coala",
  batchId: "batch-1",
  closureId: "closure-1",
  closureDate: "2026-08-01",
  kioskId: "tirirical",
  amountCents: 10_000,
  source: "cash_counted",
  operatorBreakdown: [],
  createdAt: "2026-08-01T12:00:00.000Z",
} satisfies CashDepositBatchItem;

test("reconciliador aceita bloco cuja soma dos itens confere", () => {
  const result = reconcileCashDepositBatch({
    batch: baseBatch,
    items: [baseItem],
    closures: [{
      id: "closure-1",
      cashDeposit: { eligibleCents: 10_000, manualSplitRequired: false },
    } as CashClosure],
  });
  assert.equal(result.itemTotalCents, 10_000);
  assert.deepEqual(result.issues, []);
});

test("reconciliador inclui a retenção de moedas no total do bloco sem atribuí-la ao fechamento", () => {
  const coinHold = {
    ...baseItem,
    id: "batch-1_coin_hold",
    closureId: "coin-hold:batch-1",
    amountCents: -150,
    source: "coin_hold" as const,
  };
  const result = reconcileCashDepositBatch({
    batch: {
      ...baseBatch,
      grossTotalCents: 10_000,
      totalCents: 9_850,
      coinHoldCents: 150,
      itemCount: 2,
      remainingCapacityCents: 490_150,
    },
    items: [baseItem, coinHold],
    closures: [{
      id: "closure-1",
      cashDeposit: { eligibleCents: 10_000, manualSplitRequired: false },
    } as CashClosure],
  });
  assert.equal(result.itemTotalCents, 9_850);
  assert.deepEqual(result.issues, []);
});

test("reconciliador detecta soma divergente e bloco acima do limite", () => {
  const result = reconcileCashDepositBatch({
    batch: { ...baseBatch, totalCents: 500_001, remainingCapacityCents: -1 },
    items: [{ ...baseItem, amountCents: 499_999 }],
  });
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set(["batch_items_total_mismatch", "batch_over_limit", "batch_negative", "orphan_closure"]),
  );
});

test("reconciliador detecta valor da cobrança diferente do bloco", () => {
  const result = reconcileCashDepositBatch({
    batch: baseBatch,
    items: [baseItem],
    cobranca: { valorNominalCents: 9_999 } as never,
  });
  assert.ok(result.issues.some((issue) => issue.code === "cobranca_amount_mismatch"));
});

test("bloco Inter pago exige lançamento financeiro idempotente", () => {
  const missing = reconcileCashDepositBatch({
    batch: { ...baseBatch, status: "paid", paidAt: "2026-08-02T12:00:00.000Z" },
    items: [baseItem],
    closures: [],
  });
  assert.ok(missing.issues.some((issue) => issue.code === "paid_without_ledger_entry"));

  const posted = reconcileCashDepositBatch({
    batch: {
      ...baseBatch,
      status: "paid",
      paidAt: "2026-08-02T12:00:00.000Z",
      ledgerTransactionId: "cash_deposit_inter_charge-1",
    },
    items: [baseItem],
    closures: [],
  });
  assert.equal(posted.issues.some((issue) => issue.code === "paid_without_ledger_entry"), false);
});
