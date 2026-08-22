import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateFinancialObligationSummary,
  centsToMoney,
  moneyToCents,
  obligationVarianceAmountCents,
} from "../../src/features/financial/obligations/calculations";

test("calcula previsão, real e pagamento confirmado sem diferença", () => {
  const summary = calculateFinancialObligationSummary({
    forecastAmountCents: 10_000,
    actualAmountCents: 10_293,
    paymentAllocations: [{
      principalAmountCents: 10_293,
      cashAmountCents: 10_293,
      status: "MATCHED",
    }],
  });

  assert.equal(summary.obligationStatus, "PAID");
  assert.equal(summary.reconciliationStatus, "MATCHED");
  assert.equal(summary.balanceAmountCents, 0);
  assert.equal(obligationVarianceAmountCents(summary), 293);
});

test("compara a folha pelo bruto e liquida a obrigação pelo valor líquido", () => {
  const summary = calculateFinancialObligationSummary({
    forecastAmountCents: 178_730,
    actualAmountCents: 225_188,
    settlementAmountCents: 161_433,
    paymentAllocations: [{
      principalAmountCents: 161_433,
      cashAmountCents: 161_433,
      status: "MATCHED",
    }],
  });

  assert.equal(summary.obligationStatus, "PAID");
  assert.equal(summary.reconciliationStatus, "MATCHED");
  assert.equal(summary.balanceAmountCents, 0);
  assert.equal(obligationVarianceAmountCents(summary), 46_458);
});

test("separa principal, juros e multa sem reduzir o saldo duas vezes", () => {
  const summary = calculateFinancialObligationSummary({
    actualAmountCents: 10_293,
    paymentAllocations: [{
      principalAmountCents: 10_293,
      cashAmountCents: 10_793,
      status: "MATCHED",
    }],
    adjustments: [
      { type: "INTEREST", effect: "CASH_CHARGE", amountCents: 300, status: "CLASSIFIED" },
      { type: "FINE", effect: "CASH_CHARGE", amountCents: 200, status: "CLASSIFIED" },
    ],
  });

  assert.equal(summary.principalSettledAmountCents, 10_293);
  assert.equal(summary.cashChargesAmountCents, 500);
  assert.equal(summary.cashPaidAmountCents, 10_793);
  assert.equal(summary.balanceAmountCents, 0);
  assert.equal(summary.unclassifiedDifferenceAmountCents, 0);
  assert.equal(summary.reconciliationStatus, "MATCHED");
});

test("mantém diferença sem classificação como divergência", () => {
  const summary = calculateFinancialObligationSummary({
    actualAmountCents: 10_293,
    paymentAllocations: [{
      principalAmountCents: 10_293,
      cashAmountCents: 10_793,
      status: "MATCHED",
    }],
  });

  assert.equal(summary.obligationStatus, "PAID");
  assert.equal(summary.reconciliationStatus, "DIVERGENT");
  assert.equal(summary.unclassifiedDifferenceAmountCents, 500);
});

test("calcula pagamento parcial usando apenas o principal", () => {
  const summary = calculateFinancialObligationSummary({
    actualAmountCents: 100_000,
    paymentAllocations: [{
      principalAmountCents: 60_000,
      cashAmountCents: 62_000,
      status: "MATCHED",
    }],
    adjustments: [
      { type: "INTEREST", effect: "CASH_CHARGE", amountCents: 2_000, status: "CLASSIFIED" },
    ],
  });

  assert.equal(summary.obligationStatus, "PARTIALLY_PAID");
  assert.equal(summary.balanceAmountCents, 40_000);
  assert.equal(summary.cashPaidAmountCents, 62_000);
});

test("desconto liquida o saldo sem criar saída bancária", () => {
  const summary = calculateFinancialObligationSummary({
    actualAmountCents: 100_000,
    paymentAllocations: [{
      principalAmountCents: 95_000,
      cashAmountCents: 95_000,
      status: "MATCHED",
    }],
    adjustments: [
      { type: "DISCOUNT", effect: "SETTLEMENT_CREDIT", amountCents: 5_000, status: "CLASSIFIED" },
    ],
  });

  assert.equal(summary.obligationStatus, "PAID");
  assert.equal(summary.balanceAmountCents, 0);
  assert.equal(summary.cashPaidAmountCents, 95_000);
  assert.equal(summary.settlementCreditsAmountCents, 5_000);
});

test("pagamento manual liquida operacionalmente mas continua sem confirmação bancária", () => {
  const summary = calculateFinancialObligationSummary({
    actualAmountCents: 10_293,
    paymentAllocations: [{
      principalAmountCents: 10_293,
      cashAmountCents: 10_293,
      status: "REPORTED",
    }],
  });

  assert.equal(summary.obligationStatus, "PAID");
  assert.equal(summary.paymentEvidenceStatus, "REPORTED");
  assert.equal(summary.reconciliationStatus, "NOT_FOUND");
});

test("pagamento bancário antes do documento fica aguardando documento real", () => {
  const summary = calculateFinancialObligationSummary({
    forecastAmountCents: 10_000,
    paymentAllocations: [{
      principalAmountCents: 10_000,
      cashAmountCents: 10_793,
      status: "MATCHED",
    }],
  });

  assert.equal(summary.obligationStatus, "OPEN");
  assert.equal(summary.balanceAmountCents, null);
  assert.equal(summary.reconciliationStatus, "PENDING_DOCUMENT");
});

test("ignora sugestões e vínculos anulados nos cálculos", () => {
  const summary = calculateFinancialObligationSummary({
    actualAmountCents: 10_000,
    paymentAllocations: [
      { principalAmountCents: 10_000, cashAmountCents: 10_000, status: "SUGGESTED" },
      { principalAmountCents: 10_000, cashAmountCents: 10_000, status: "VOIDED" },
    ],
  });

  assert.equal(summary.principalSettledAmountCents, 0);
  assert.equal(summary.cashPaidAmountCents, 0);
  assert.equal(summary.obligationStatus, "OPEN");
});

test("converte valores monetários para centavos de forma determinística", () => {
  assert.equal(moneyToCents(102.93), 10_293);
  assert.equal(moneyToCents("0.1"), 10);
  assert.equal(centsToMoney(10_293), 102.93);
});
