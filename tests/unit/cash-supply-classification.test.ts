import assert from "node:assert/strict";
import test from "node:test";

import {
  cashSupplyClassificationSummary,
  cashSupplyMovementFingerprint,
  financeExpectedCentsForLine,
  financeReportedCentsForLine,
  preserveCashSupplyClassifications,
  requiresCashSupplyClassification,
} from "../../src/features/financial/cash-closures/supply-classification";
import { recalculateCountedLine } from "../../src/features/financial/cash-closures/persistence";
import type {
  CashClosureCashMovement,
  CashClosureLine,
  CashSupplyClassificationKind,
} from "../../src/features/financial/cash-closures/types";

const movement: CashClosureCashMovement = {
  id: "6569516",
  identitySource: "provider",
  kind: "supply",
  pdvDescription: "Supr. no.1491",
  amountCents: 4_000,
  occurredAt: "2026-11-02T16:02:07",
  date: "2026-11-02",
  operatorId: "674192",
  terminalId: "80A1E9DD9375",
  paymentMethodId: "0",
  paymentMethodName: null,
  isCash: false,
  cancelled: false,
};

function line(date: string, classification?: CashSupplyClassificationKind): CashClosureLine {
  return {
    id: "674192_cash",
    closureId: `tirirical_${date}`,
    workspaceId: "workspace",
    kioskId: "tirirical",
    date,
    operatorId: "674192",
    operatorName: "Thaise",
    channel: "cash",
    channelLabel: "Dinheiro",
    calculatedExpectedCents: 13_500,
    expectedCents: 13_500,
    expectedAdjustmentCents: 0,
    expectedAdjustmentReason: null,
    expectedAdjustedBy: null,
    expectedAdjustedAt: null,
    expectedAdjustmentNeedsReview: false,
    reportedCents: 13_500,
    reportedDifferenceCents: 0,
    countedCents: 9_500,
    conferenceDifferenceCents: -4_000,
    differenceCents: -4_000,
    status: "divergent",
    rawPaymentNames: ["DINHEIRO"],
    metadata: {
      supplyCents: 4_000,
      cashMovements: [{ ...movement, date, occurredAt: `${date}T16:02:07` }],
      ...(classification ? {
        supplyClassifications: [{
          movementId: movement.id,
          movementFingerprint: cashSupplyMovementFingerprint({ ...movement, date, occurredAt: `${date}T16:02:07` }),
          kind: classification,
          classifiedAt: "2026-11-02T18:00:00Z",
          classifiedBy: "finance-user",
          classifiedByName: "Financeiro",
        }],
      } : {}),
    },
    reportedNote: null,
    note: null,
    reportedBy: "cashier",
    reportedAt: "2026-11-02T17:00:00Z",
    countedBy: "finance-user",
    countedAt: "2026-11-02T18:00:00Z",
    updatedAt: "2026-11-02T18:00:00Z",
  };
}

test("classificação de suprimentos só é exigida a partir de novembro de 2026", () => {
  assert.equal(requiresCashSupplyClassification("2026-10-31"), false);
  assert.equal(requiresCashSupplyClassification("2026-11-01"), true);
  assert.equal(cashSupplyClassificationSummary([line("2026-10-31")]).pending, 0);
  assert.equal(cashSupplyClassificationSummary([line("2026-11-01")]).pending, 1);
});

test("fundo de caixa reduz o esperado do malote sem alterar o esperado bruto do Caixa", () => {
  assert.equal(financeExpectedCentsForLine(line("2026-11-02")), 13_500);
  const classified = line("2026-11-02", "cash_fund");
  assert.equal(classified.expectedCents, 13_500);
  assert.equal(financeExpectedCentsForLine(classified), 9_500);
  assert.equal(financeReportedCentsForLine(classified), 9_500);
  const recalculated = recalculateCountedLine(classified, 9_500, null, "finance-user", "2026-11-02T18:05:00Z");
  assert.equal(recalculated.reportedDifferenceCents, 0);
  assert.equal(recalculated.conferenceDifferenceCents, 0);
  assert.equal(recalculated.differenceCents, 0);
  assert.equal(recalculated.status, "matched");
});

test("suprimento comum continua integralmente no esperado do malote", () => {
  const classified = line("2026-11-02", "supply");
  assert.equal(financeExpectedCentsForLine(classified), 13_500);
  assert.equal(cashSupplyClassificationSummary([classified]).supplyCents, 4_000);
  assert.equal(cashSupplyClassificationSummary([classified]).cashFundCents, 0);
});

test("classificação só é preservada enquanto a identidade financeira do movimento não muda", () => {
  const classified = line("2026-11-02", "cash_fund");
  const existing = classified.metadata.supplyClassifications;
  assert.equal(preserveCashSupplyClassifications(existing, classified.metadata.cashMovements).length, 1);
  assert.equal(preserveCashSupplyClassifications(existing, [{ ...movement, amountCents: 5_000 }]).length, 0);
});
