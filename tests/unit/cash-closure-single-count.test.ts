import assert from "node:assert/strict";
import test from "node:test";

import { resolveCashClosureSingleCount } from "../../src/features/financial/cash-closures/single-count";
import type { CashClosureLine } from "../../src/features/financial/cash-closures/types";

function cashLine(overrides: Partial<CashClosureLine> = {}): CashClosureLine {
  return {
    id: "operator-1_cash",
    closureId: "kiosk-1_2026-08-28",
    workspaceId: "workspace-1",
    kioskId: "kiosk-1",
    date: "2026-08-28",
    operatorId: "operator-1",
    operatorName: "Operadora 1",
    channel: "cash",
    channelLabel: "Dinheiro",
    expectedCents: 10_000,
    reportedCents: 9_800,
    reportedDifferenceCents: -200,
    countedCents: null,
    conferenceDifferenceCents: null,
    differenceCents: null,
    status: "pending",
    rawPaymentNames: ["DINHEIRO"],
    metadata: {},
    reportedNote: "Contagem do caixa",
    note: null,
    reportedBy: "cashier-1",
    reportedAt: "2026-08-28T18:00:00.000Z",
    countedBy: null,
    countedAt: null,
    updatedAt: "2026-08-28T18:00:00.000Z",
    ...overrides,
  };
}

test("usa a contagem do Caixa nos fechamentos do fluxo atual", () => {
  assert.deepEqual(resolveCashClosureSingleCount(cashLine(), "draft"), {
    cents: 9_800,
    note: "Contagem do caixa",
    source: "manual",
  });
});

test("preserva a contagem do Financeiro já preenchida em uma revisão legada", () => {
  const line = cashLine({
    countedCents: 9_900,
    note: "Conferido antes da mudança de fluxo",
    countedBy: "finance-1",
    countedAt: "2026-08-28T19:00:00.000Z",
  });
  assert.deepEqual(resolveCashClosureSingleCount(line, "pending_review"), {
    cents: 9_900,
    note: "Conferido antes da mudança de fluxo",
    source: "legacy_finance",
  });
});

test("documenta automaticamente divergência legada sem observação", () => {
  const line = cashLine({
    countedCents: 9_900,
    note: null,
    reportedNote: null,
    countedAt: "2026-08-28T19:00:00.000Z",
  });
  assert.equal(
    resolveCashClosureSingleCount(line, "pending_review").note,
    "Valor herdado da conferência financeira anterior.",
  );
});

test("edição posterior na contagem única prevalece sobre a conferência legada", () => {
  const line = cashLine({
    reportedCents: 9_700,
    reportedAt: "2026-08-28T20:00:00.000Z",
    countedCents: 9_900,
    countedAt: "2026-08-28T19:00:00.000Z",
  });
  assert.equal(resolveCashClosureSingleCount(line, "pending_review").cents, 9_700);
});

test("Pix continua usando exclusivamente o valor apurado pelo PDV", () => {
  const line = cashLine({ channel: "pix", expectedCents: 5_000, reportedCents: null, countedCents: null });
  assert.deepEqual(resolveCashClosureSingleCount(line, "pending_review"), {
    cents: 5_000,
    note: null,
    source: "pdv",
  });
});
