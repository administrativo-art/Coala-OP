import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  prepareStoneFinancialImport,
  StoneFinancialImportValidationError,
} from "../../src/features/financial/stone-receivables/ingestion.server";

const SOURCE_HASH = "a".repeat(64);

function receivable(overrides: Record<string, unknown> = {}) {
  return {
    receivableKey: "sale-1:installment-1",
    externalSaleId: "sale-1",
    installmentNumber: 1,
    installmentCount: 2,
    stoneCode: "stone-tirirical",
    kioskId: "tirirical",
    accountId: "stone-account",
    grossAmountCents: 10_000,
    mdrAmountCents: 200,
    anticipationFeeAmountCents: 100,
    adjustmentAmountCents: 0,
    netAmountCents: 9_700,
    settledAmountCents: 0,
    originalExpectedDate: "2026-09-17",
    currentExpectedDate: "2026-09-18",
    status: "scheduled",
    sourceRevision: "revision-1",
    sourceHash: SOURCE_HASH,
    ...overrides,
  };
}

describe("ingestão financeira Stone", () => {
  it("preserva previsão original e atual e gera identidade idempotente", () => {
    const input = {
      workspaceId: "coala",
      source: "stone_receivables",
      idempotencyKey: "receivables-2026-09-15",
      rows: [receivable(), receivable()],
    };
    const first = prepareStoneFinancialImport(input);
    const second = prepareStoneFinancialImport(input);
    assert.equal(first.rows.length, 1);
    assert.equal(first.duplicateCount, 1);
    assert.equal(first.rows[0].id, second.rows[0].id);
    assert.equal("originalExpectedDate" in first.rows[0] && first.rows[0].originalExpectedDate, "2026-09-17");
    assert.equal("currentExpectedDate" in first.rows[0] && first.rows[0].currentExpectedDate, "2026-09-18");
  });

  it("recusa líquido que não fecha com bruto, taxas e ajustes", () => {
    assert.throws(() => prepareStoneFinancialImport({
      workspaceId: "coala",
      source: "stone_receivables",
      idempotencyKey: "receivables-invalid-net",
      rows: [receivable({ netAmountCents: 9_701 })],
    }), StoneFinancialImportValidationError);
  });

  it("recusa liquidação acima do recebível e parcela impossível", () => {
    for (const row of [
      receivable({ settledAmountCents: 9_701 }),
      receivable({ installmentNumber: 3 }),
    ]) {
      assert.throws(() => prepareStoneFinancialImport({
        workspaceId: "coala",
        source: "stone_receivables",
        idempotencyKey: "receivables-invalid-row",
        rows: [row],
      }), StoneFinancialImportValidationError);
    }
  });

  it("valida a composição líquida da liquidação", () => {
    const prepared = prepareStoneFinancialImport({
      workspaceId: "coala",
      source: "stone_settlements",
      idempotencyKey: "settlements-2026-09-17",
      rows: [{
        externalSettlementId: "settlement-1",
        stoneCode: "stone-tirirical",
        accountId: "stone-account",
        settledAt: "2026-09-17T12:00:00-03:00",
        grossAmountCents: 10_000,
        feeAmountCents: 200,
        adjustmentAmountCents: -50,
        netAmountCents: 9_750,
        receivableKeys: ["sale-1:installment-1"],
        sourceRevision: "revision-1",
        sourceHash: SOURCE_HASH,
      }],
    });
    assert.equal(prepared.rows.length, 1);
    assert.match(prepared.rows[0].id, /^stone_settle_/);
  });
});
