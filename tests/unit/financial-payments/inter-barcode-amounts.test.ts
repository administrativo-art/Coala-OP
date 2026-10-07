import assert from "node:assert/strict";
import test from "node:test";

import {
  expectedBarcodeDebitAmountCents,
  interBarcodePaymentMatchesRequest,
  observeBarcodeStatementSettlement,
  observeInterBarcodeAmounts,
  planLateChargeBreakdown,
} from "../../../src/features/financial/payment-requests/barcode-amounts";

test("separa principal e encargos quando o Inter atualiza boleto vencido", () => {
  assert.deepEqual(observeInterBarcodeAmounts({
    requestedAmount: 1467.98,
    nominalAmount: 1467.98,
    paidAmount: 1512,
    dueDate: "2026-10-05",
    paymentDate: "2026-10-06",
  }), {
    nominalAmountCents: 146798,
    settlementAmountCents: 151200,
    lateChargeAmountCents: 4402,
    divergence: null,
  });
});

test("preserva a composição bancária e classifica diferença sem composição como encargo conjunto", () => {
  assert.deepEqual(planLateChargeBreakdown({
    difference: 44.02,
    bankInterest: 14.67,
    bankFine: 29.35,
  }), { interest: 14.67, fine: 29.35, otherCharge: 0 });
  assert.deepEqual(planLateChargeBreakdown({
    difference: 44.02,
    bankInterest: 0,
    bankFine: 0,
  }), { interest: 0, fine: 0, otherCharge: 44.02 });
});

test("mantém bloqueio para principal divergente, débito menor e acréscimo antes do atraso", () => {
  assert.equal(observeInterBarcodeAmounts({
    requestedAmount: 1467.98,
    nominalAmount: 1500,
    paidAmount: 1512,
    dueDate: "2026-10-05",
    paymentDate: "2026-10-06",
  }).divergence, "nominal");
  assert.equal(observeInterBarcodeAmounts({
    requestedAmount: 1467.98,
    paidAmount: 1400,
    dueDate: "2026-10-05",
    paymentDate: "2026-10-06",
  }).divergence, "settlement_below_principal");
  assert.equal(observeInterBarcodeAmounts({
    requestedAmount: 1467.98,
    paidAmount: 1512,
    dueDate: "2026-10-06",
    paymentDate: "2026-10-06",
  }).divergence, "unexpected_surcharge");
});

test("recupera pagamento anterior pelo principal nominal mesmo com encargos de atraso", () => {
  assert.equal(interBarcodePaymentMatchesRequest({
    payment: { valorNominal: 1467.98, valorPago: 1512, statusPagamento: "AGUARDANDO_APROVACAO" },
    requestedAmount: 1467.98,
    dueDate: "2026-10-05",
    scheduledFor: "2026-10-06",
  }), true);
});

test("trata valores nulos do Inter como ausentes", () => {
  assert.deepEqual(observeInterBarcodeAmounts({
    requestedAmount: 1467.98,
    nominalAmount: null,
    paidAmount: null,
    dueDate: "2026-10-05",
    paymentDate: "2026-10-06",
  }), {
    nominalAmountCents: null,
    settlementAmountCents: null,
    lateChargeAmountCents: 0,
    divergence: null,
  });
});

test("usa a data do pagamento do Inter e recusa acréscimo pago no vencimento", () => {
  assert.equal(interBarcodePaymentMatchesRequest({
    payment: {
      valorNominal: 1467.98,
      valorPago: 1512,
      dataPagamento: "2026-10-05",
      statusPagamento: "PAGO",
    },
    requestedAmount: 1467.98,
    dueDate: "2026-10-05",
    scheduledFor: "2026-10-06",
  }), false);
});

test("só aceita encargos do extrato após o vencimento e confirmados pelo Inter", () => {
  const valid = observeBarcodeStatementSettlement({
    principalAmount: 1467.98,
    cashAmount: 1512,
    expectedAmount: 1512,
    bankSettlementAmount: 1512,
    dueDate: "2026-10-05",
    paidOn: "2026-10-06",
  });
  assert.deepEqual(valid, { differenceCents: 4402, divergence: null });
  assert.equal(observeBarcodeStatementSettlement({
    principalAmount: 1467.98,
    cashAmount: 2000,
    expectedAmount: 1512,
    bankSettlementAmount: 1512,
    dueDate: "2026-10-05",
    paidOn: "2026-10-06",
  }).divergence, "bank_settlement");
  assert.equal(observeBarcodeStatementSettlement({
    principalAmount: 1467.98,
    cashAmount: 1512,
    expectedAmount: 1512,
    bankSettlementAmount: 1512,
    dueDate: "2026-10-05",
    paidOn: "2026-10-05",
  }).divergence, "surcharge_before_due");
  assert.equal(observeBarcodeStatementSettlement({
    principalAmount: 1467.98,
    cashAmount: 1512,
    expectedAmount: 1512,
    bankSettlementAmount: null,
    dueDate: "2026-10-05",
    paidOn: "2026-10-06",
  }).divergence, "bank_settlement");
  assert.equal(observeBarcodeStatementSettlement({
    principalAmount: 1467.98,
    cashAmount: 1467.98,
    expectedAmount: 1467.98,
    dueDate: "2026-10-05",
    paidOn: "2026-10-06",
  }).divergence, null);
});

test("prioriza a liquidação do Inter e usa o valor documental confirmado antes do principal", () => {
  assert.equal(expectedBarcodeDebitAmountCents({
    requestedAmount: 1467.98,
    currentSettlementAmount: null,
    observedSettlementAmountCents: null,
  }), 146798);
  assert.equal(expectedBarcodeDebitAmountCents({
    requestedAmount: 1467.98,
    requestedSettlementAmount: 1512,
    currentSettlementAmount: null,
    observedSettlementAmountCents: null,
  }), 151200);
  assert.equal(expectedBarcodeDebitAmountCents({
    requestedAmount: 1467.98,
    requestedSettlementAmount: 1512,
    currentSettlementAmount: null,
    observedSettlementAmountCents: 151200,
  }), 151200);
  assert.equal(expectedBarcodeDebitAmountCents({
    requestedAmount: 1467.98,
    currentSettlementAmount: 1512,
    observedSettlementAmountCents: null,
  }), 151200);
});
