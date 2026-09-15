import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizePdvSaleStatus,
  normalizeReconciliationChannel,
  normalizeStoneSaleStatus,
  reconciliationBusinessDate,
} from "../../src/features/financial/sales-reconciliation/normalization";
import { suggestSalesReconciliationCases } from "../../src/features/financial/sales-reconciliation/matching";
import type { SalesMatchFact } from "../../src/features/financial/sales-reconciliation/types";

function fact(overrides: Partial<SalesMatchFact> & Pick<SalesMatchFact, "id" | "source">): SalesMatchFact {
  return {
    workspaceId: "coala",
    kioskId: "tirirical",
    businessDate: "2026-09-15",
    soldAt: "2026-09-15T10:00:00-03:00",
    channel: "credit_card",
    grossAmountCents: 1_000,
    status: "approved",
    identifiers: {},
    ...overrides,
  };
}

describe("normalização das vendas PDV e Stone", () => {
  it("reutiliza os canais canônicos do fechamento", () => {
    assert.equal(normalizeReconciliationChannel("PIX STONE"), "pix");
    assert.equal(normalizeReconciliationChannel("Cartão Débito Stone Visa"), "debit_card");
    assert.equal(normalizeReconciliationChannel("credit_card"), "credit_card");
    assert.equal(normalizeReconciliationChannel("DINHEIRO"), null);
  });

  it("normaliza estados sem transformar pendência desconhecida em venda aprovada", () => {
    assert.equal(normalizePdvSaleStatus("CANCELADO"), "cancelled");
    assert.equal(normalizeStoneSaleStatus("CAPTURED"), "approved");
    assert.equal(normalizeStoneSaleStatus("novo_estado_do_provedor"), "pending");
  });

  it("converte instantes com offset para o dia operacional de Belém", () => {
    assert.equal(reconciliationBusinessDate("2026-09-16T02:30:00Z"), "2026-09-15");
  });
});

describe("motor conservador de conciliação de vendas", () => {
  it("prioriza o identificador do provedor e explica divergência de valor", () => {
    const cases = suggestSalesReconciliationCases({
      pdvFacts: [fact({ id: "p1", source: "pdv", identifiers: { providerTransactionId: "tx-1" }, grossAmountCents: 1_000 })],
      stoneSales: [fact({ id: "s1", source: "stone", identifiers: { providerTransactionId: "tx-1" }, grossAmountCents: 900 })],
    });
    assert.equal(cases.length, 1);
    assert.equal(cases[0].kind, "amount_mismatch");
    assert.equal(cases[0].matchBasis, "provider_transaction_id");
    assert.equal(cases[0].differenceAmountCents, -100);
    assert.equal(cases[0].reviewStatus, "pending_review");
  });

  it("concilia automaticamente uma correspondência única por valor e horário", () => {
    const cases = suggestSalesReconciliationCases({
      pdvFacts: [fact({ id: "p1", source: "pdv", soldAt: "2026-09-15T10:02:00-03:00" })],
      stoneSales: [fact({ id: "s1", source: "stone", soldAt: "2026-09-15T13:04:00Z" })],
    });
    assert.equal(cases.length, 1);
    assert.equal(cases[0].kind, "matched");
    assert.equal(cases[0].matchBasis, "unique_amount_time");
    assert.equal(cases[0].reviewStatus, "matched_auto");
  });

  it("suporta pagamento dividido 1:N pela referência do pedido", () => {
    const cases = suggestSalesReconciliationCases({
      pdvFacts: [fact({ id: "p1", source: "pdv", couponId: "cupom-1", grossAmountCents: 1_000 })],
      stoneSales: [
        fact({ id: "s1", source: "stone", identifiers: { merchantOrderId: "cupom-1" }, grossAmountCents: 600 }),
        fact({ id: "s2", source: "stone", identifiers: { merchantOrderId: "cupom-1" }, grossAmountCents: 400 }),
      ],
    });
    assert.equal(cases.length, 1);
    assert.deepEqual(cases[0].stoneSaleIds, ["s1", "s2"]);
    assert.equal(cases[0].kind, "matched");
    assert.equal(cases[0].reviewStatus, "matched_auto");
  });

  it("não escolhe arbitrariamente entre vendas equivalentes", () => {
    const cases = suggestSalesReconciliationCases({
      pdvFacts: [fact({ id: "p1", source: "pdv" })],
      stoneSales: [fact({ id: "s1", source: "stone" }), fact({ id: "s2", source: "stone" })],
    });
    assert.equal(cases.length, 1);
    assert.equal(cases[0].kind, "ambiguous");
    assert.equal(cases[0].reviewStatus, "pending_review");
    assert.deepEqual(cases[0].stoneSaleIds, ["s1", "s2"]);
  });

  it("mantém venda Stone sem unidade como pendência explícita", () => {
    const cases = suggestSalesReconciliationCases({
      pdvFacts: [],
      stoneSales: [fact({ id: "s1", source: "stone", kioskId: null })],
    });
    assert.equal(cases[0].kind, "unit_unmapped");
    assert.equal(cases[0].reviewStatus, "pending_review");
  });

  it("não concilia automaticamente uma chave forte atribuída a unidades diferentes", () => {
    const cases = suggestSalesReconciliationCases({
      pdvFacts: [fact({ id: "p1", source: "pdv", identifiers: { providerTransactionId: "tx-1" } })],
      stoneSales: [fact({ id: "s1", source: "stone", kioskId: "joao-paulo", identifiers: { providerTransactionId: "tx-1" } })],
    });
    assert.equal(cases[0].kind, "unit_mismatch");
    assert.deepEqual(cases[0].kioskIds, ["joao-paulo", "tirirical"]);
    assert.equal(cases[0].reviewStatus, "pending_review");
  });

  it("nunca cruza fatos de workspaces diferentes", () => {
    const cases = suggestSalesReconciliationCases({
      pdvFacts: [fact({ id: "p1", source: "pdv", identifiers: { providerTransactionId: "tx-1" } })],
      stoneSales: [fact({ id: "s1", source: "stone", workspaceId: "outro", identifiers: { providerTransactionId: "tx-1" } })],
    });
    assert.deepEqual(cases.map((entry) => entry.kind).sort(), ["pdv_only", "stone_only"]);
  });
});
