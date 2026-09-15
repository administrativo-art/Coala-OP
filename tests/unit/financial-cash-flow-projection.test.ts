import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addCashFlowCivilDays,
  buildCashFlowProjection,
  type CashFlowObligationInput,
  type CashFlowProjectionScope,
} from "../../src/features/financial/cash-flow/projection";
import type { StoneReceivable } from "../../src/features/financial/stone-receivables/types";

function receivable(overrides: Partial<StoneReceivable> = {}): StoneReceivable {
  return {
    id: "receivable-1",
    workspaceId: "coala",
    receivableKey: "sale-1:1",
    externalSaleId: "sale-1",
    installmentNumber: 1,
    installmentCount: 1,
    stoneCode: "stone-tirirical",
    kioskId: "tirirical",
    accountId: "stone",
    grossAmountCents: 10_000,
    mdrAmountCents: 200,
    anticipationFeeAmountCents: 0,
    adjustmentAmountCents: 0,
    netAmountCents: 9_800,
    settledAmountCents: 0,
    originalExpectedDate: "2026-09-16",
    currentExpectedDate: "2026-09-17",
    status: "scheduled",
    sourceRevision: "1",
    sourceHash: "a".repeat(64),
    ...overrides,
  };
}

function obligation(overrides: Partial<CashFlowObligationInput> = {}): CashFlowObligationInput {
  return {
    id: "obligation-1",
    expenseId: "expense-1",
    accountId: "inter",
    kioskIds: ["tirirical"],
    description: "Aluguel",
    dueDate: "2026-09-18",
    forecastAmountCents: 50_000,
    balanceAmountCents: 30_000,
    status: "PARTIALLY_PAID",
    ...overrides,
  };
}

function projection(scope: CashFlowProjectionScope = { type: "consolidated" }, overrides: Record<string, unknown> = {}) {
  return buildCashFlowProjection({
    asOf: "2026-09-15",
    days: 91,
    scope,
    openingBalances: [
      { accountId: "stone", accountName: "Stone", balanceCents: 100_000, confirmedAt: "2026-09-15T08:00:00-03:00", source: "stone_api" },
      { accountId: "inter", accountName: "Inter", balanceCents: 200_000, confirmedAt: "2026-09-15T08:00:00-03:00", source: "inter_api" },
    ],
    receivables: [receivable()],
    obligations: [obligation()],
    paymentRequests: [],
    transactions: [],
    generatedAt: "2026-09-15T12:00:00Z",
    ...overrides,
  });
}

describe("projeção contratada de caixa por 13 semanas", () => {
  it("gera exatamente 91 dias incluindo a data de corte", () => {
    const result = projection();
    assert.equal(result.daily.length, 91);
    assert.equal(result.daily[0].date, "2026-09-15");
    assert.equal(result.endDate, "2026-12-14");
    assert.equal(addCashFlowCivilDays("2028-02-28", 1), "2028-02-29");
  });

  it("usa o líquido atual do recebível e preserva a previsão original", () => {
    const item = projection().items.find((entry) => entry.sourceType === "stone_receivable");
    assert.equal(item?.amountCents, 9_800);
    assert.equal(item?.originalExpectedDate, "2026-09-16");
    assert.equal(item?.currentExpectedDate, "2026-09-17");
    assert.equal(item?.projectionDate, "2026-09-17");
    assert.equal(item?.sourceRevision, "1");
    assert.equal(item?.sourceHash, "a".repeat(64));
  });

  it("mantém somente o saldo pendente da obrigação", () => {
    const item = projection().items.find((entry) => entry.sourceType === "financial_obligation");
    assert.equal(item?.amountCents, 30_000);
  });

  it("agendamento bancário confirmado substitui data e valor da despesa", () => {
    const result = projection({ type: "consolidated" }, {
      paymentRequests: [{
        id: "request-1",
        obligationId: "obligation-1",
        accountId: "inter",
        amountCents: 25_000,
        scheduledFor: "2026-09-22",
        status: "scheduled",
      }],
    });
    const item = result.items.find((entry) => entry.sourceType === "financial_obligation");
    assert.equal(item?.paymentRequestId, "request-1");
    assert.equal(item?.projectionDate, "2026-09-22");
    assert.equal(item?.amountCents, 25_000);
  });

  it("item vencido entra no primeiro dia sem perder sua data original", () => {
    const result = projection({ type: "consolidated" }, {
      receivables: [receivable({ currentExpectedDate: "2026-09-10", status: "overdue" })],
    });
    const item = result.items.find((entry) => entry.sourceType === "stone_receivable");
    assert.equal(item?.status, "overdue");
    assert.equal(item?.currentExpectedDate, "2026-09-10");
    assert.equal(item?.projectionDate, "2026-09-15");
  });

  it("saldo inicial ausente torna todos os saldos projetados incompletos", () => {
    const result = projection({ type: "consolidated" }, {
      openingBalances: [{ accountId: "stone", accountName: "Stone", balanceCents: null, confirmedAt: null, source: null }],
    });
    assert.equal(result.balanceComplete, false);
    assert.equal(result.openingBalanceCents, null);
    assert.ok(result.daily.every((entry) => entry.closingBalanceCents === null));
  });

  it("transferência entre contas aparece por conta e zera no consolidado", () => {
    const transfers = [
      { id: "out", accountId: "stone", kioskIds: [], description: "Stone para Inter", date: "2026-09-16", direction: "out" as const, amountCents: 40_000, type: "transfer_out", transferGroupId: "transfer-1" },
      { id: "in", accountId: "inter", kioskIds: [], description: "Stone para Inter", date: "2026-09-16", direction: "in" as const, amountCents: 40_000, type: "transfer_in", transferGroupId: "transfer-1" },
    ];
    assert.equal(projection({ type: "consolidated" }, { transactions: transfers }).items.filter((entry) => entry.sourceType === "bank_transaction").length, 0);
    const stone = projection({ type: "account", id: "stone" }, { transactions: transfers });
    assert.equal(stone.items.find((entry) => entry.sourceType === "bank_transaction")?.direction, "out");
  });

  it("visão por unidade não inventa divisão do saldo bancário", () => {
    const result = projection({ type: "unit", id: "tirirical" });
    assert.equal(result.openingBalanceCents, null);
    assert.equal(result.balanceComplete, false);
    assert.match(result.balanceIncompleteReason ?? "", /gerencial/);
  });

  it("não inventa vendas futuras além dos recebíveis contratados", () => {
    assert.equal(projection().futureSalesIncluded, false);
  });

  it("expõe menor saldo e primeiro dia negativo somente a partir de saldo confirmado", () => {
    const result = projection({ type: "account", id: "inter" }, {
      days: 3,
      openingBalances: [{
        accountId: "inter",
        accountName: "Inter",
        balanceCents: 1_000,
        confirmedAt: "2026-09-15T08:00:00-03:00",
        source: "inter_api",
      }],
      receivables: [],
      obligations: [obligation({ dueDate: "2026-09-16", balanceAmountCents: 1_500 })],
    });
    assert.equal(result.minimumBalanceDay?.date, "2026-09-16");
    assert.equal(result.minimumBalanceDay?.closingBalanceCents, -500);
    assert.equal(result.firstNegativeDay?.date, "2026-09-16");
  });
});
