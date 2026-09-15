import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  prepareCanonicalSalesImportBatch,
  SalesImportValidationError,
} from "../../src/features/financial/sales-reconciliation/ingestion.server";

const SOURCE_HASH = "a".repeat(64);

function pdvRow(overrides: Record<string, unknown> = {}) {
  return {
    kioskId: "tirirical",
    couponId: "cupom-1",
    paymentIndex: 0,
    soldAt: "2026-09-15T10:00:00",
    channel: "PIX STONE",
    grossAmountCents: 1_000,
    status: "APROVADO",
    identifiers: { nsu: "123", authorizationCode: "abc", terminalId: "pos-1" },
    sourceHash: SOURCE_HASH,
    sourceRevision: "export-1",
    ...overrides,
  };
}

function batch(source: "pdv" | "stone_sales", rows: unknown[]) {
  return {
    workspaceId: "coala",
    source,
    period: "2026-09",
    businessDate: "2026-09-15",
    rows,
    idempotencyKey: `${source}-2026-09-15-export-1`,
  };
}

describe("contrato de ingestão canônica de vendas", () => {
  it("gera a mesma identidade e remove duplicata idêntica dentro do lote", () => {
    const first = prepareCanonicalSalesImportBatch(batch("pdv", [pdvRow(), pdvRow()]));
    const second = prepareCanonicalSalesImportBatch(batch("pdv", [pdvRow()]));
    assert.equal(first.rows.length, 1);
    assert.equal(first.duplicateCount, 1);
    assert.equal(first.rows[0].id, second.rows[0].id);
    assert.equal(first.rows[0].sourceHash, second.rows[0].sourceHash);
  });

  it("recusa duas revisões da mesma venda dentro do mesmo lote", () => {
    assert.throws(
      () => prepareCanonicalSalesImportBatch(batch("pdv", [
        pdvRow(),
        pdvRow({ grossAmountCents: 2_000, sourceHash: "b".repeat(64) }),
      ])),
      (error: unknown) => error instanceof SalesImportValidationError
        && error.message.includes("duas revisões diferentes"),
    );
  });

  it("recusa canal fora do escopo e data fora do dia declarado", () => {
    assert.throws(
      () => prepareCanonicalSalesImportBatch(batch("pdv", [pdvRow({ channel: "DINHEIRO" })])),
      SalesImportValidationError,
    );
    assert.throws(
      () => prepareCanonicalSalesImportBatch(batch("pdv", [pdvRow({ soldAt: "2026-09-16T10:00:00" })])),
      SalesImportValidationError,
    );
  });

  it("mantém status Stone desconhecido pendente e converte o dia para Belém", () => {
    const prepared = prepareCanonicalSalesImportBatch(batch("stone_sales", [{
      externalTransactionId: "stone-1",
      stoneCode: "stonecode-1",
      kioskId: "tirirical",
      soldAt: "2026-09-16T02:30:00Z",
      channel: "credit_card",
      grossAmountCents: 1_000,
      installmentCount: 1,
      status: "NEW_PROVIDER_STATUS",
      identifiers: {},
      sourceHash: SOURCE_HASH,
      sourceRevision: "api-1",
    }]));
    assert.equal(prepared.rows[0].businessDate, "2026-09-15");
    assert.equal(prepared.rows[0].status, "pending");
    assert.equal(prepared.businessDates[0], "2026-09-15");
  });

  it("permite carregar fragmentos sem ativar uma projeção incompleta", () => {
    const prepared = prepareCanonicalSalesImportBatch({
      ...batch("pdv", [pdvRow()]),
      finalize: false,
    });
    assert.equal(prepared.finalize, false);
    assert.equal(prepareCanonicalSalesImportBatch(batch("pdv", [pdvRow()])).finalize, true);
  });
});
