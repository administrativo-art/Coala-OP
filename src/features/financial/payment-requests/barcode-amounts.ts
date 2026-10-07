import type { InterBarcodePayment } from "@/lib/integrations/inter/barcode-payments.server";

const MONEY_TOLERANCE_CENTS = 1;

function cents(value: unknown) {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

function paymentDate(value: unknown, fallback: string) {
  const normalized = String(value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : fallback;
}

export type InterBarcodeAmountObservation = {
  nominalAmountCents: number | null;
  settlementAmountCents: number | null;
  lateChargeAmountCents: number;
  divergence: "nominal" | "settlement_below_principal" | "unexpected_surcharge" | null;
};

export function observeInterBarcodeAmounts(input: {
  requestedAmount: number;
  dueDate: string;
  paymentDate: string;
  nominalAmount?: number | null;
  paidAmount?: number | null;
}): InterBarcodeAmountObservation {
  const requestedAmountCents = cents(input.requestedAmount) ?? 0;
  const nominalAmountCents = cents(input.nominalAmount);
  const settlementAmountCents = cents(input.paidAmount);

  if (
    nominalAmountCents != null
    && Math.abs(nominalAmountCents - requestedAmountCents) > MONEY_TOLERANCE_CENTS
  ) {
    return { nominalAmountCents, settlementAmountCents, lateChargeAmountCents: 0, divergence: "nominal" };
  }
  if (
    settlementAmountCents != null
    && settlementAmountCents < requestedAmountCents - MONEY_TOLERANCE_CENTS
  ) {
    return {
      nominalAmountCents,
      settlementAmountCents,
      lateChargeAmountCents: 0,
      divergence: "settlement_below_principal",
    };
  }
  const lateChargeAmountCents = settlementAmountCents == null
    ? 0
    : Math.max(0, settlementAmountCents - requestedAmountCents);
  if (lateChargeAmountCents > MONEY_TOLERANCE_CENTS && input.paymentDate <= input.dueDate) {
    return {
      nominalAmountCents,
      settlementAmountCents,
      lateChargeAmountCents,
      divergence: "unexpected_surcharge",
    };
  }
  return {
    nominalAmountCents,
    settlementAmountCents,
    lateChargeAmountCents,
    divergence: null,
  };
}

export function interBarcodePaymentMatchesRequest(input: {
  payment: InterBarcodePayment;
  requestedAmount: number;
  dueDate: string;
  scheduledFor: string;
}) {
  return observeInterBarcodeAmounts({
    requestedAmount: input.requestedAmount,
    dueDate: input.dueDate,
    paymentDate: paymentDate(input.payment.dataPagamento, input.scheduledFor),
    nominalAmount: input.payment.valorNominal,
    paidAmount: input.payment.valorPago,
  }).divergence == null;
}

export function interBarcodePaymentDate(payment: InterBarcodePayment, scheduledFor: string) {
  return paymentDate(payment.dataPagamento, scheduledFor);
}

export type BarcodeStatementSettlementObservation = {
  differenceCents: number;
  divergence: "below_principal" | "expected_amount" | "bank_settlement" | "surcharge_before_due" | null;
};

export function observeBarcodeStatementSettlement(input: {
  principalAmount: number;
  cashAmount: number;
  expectedAmount: number;
  bankSettlementAmount?: number | null;
  dueDate: string;
  paidOn: string;
}): BarcodeStatementSettlementObservation {
  const principalAmountCents = cents(input.principalAmount) ?? 0;
  const cashAmountCents = cents(input.cashAmount) ?? 0;
  const expectedAmountCents = cents(input.expectedAmount) ?? 0;
  const bankSettlementAmountCents = cents(input.bankSettlementAmount);
  const differenceCents = cashAmountCents - principalAmountCents;

  if (differenceCents < -MONEY_TOLERANCE_CENTS) {
    return { differenceCents, divergence: "below_principal" };
  }
  if (
    bankSettlementAmountCents != null
    && Math.abs(bankSettlementAmountCents - cashAmountCents) > MONEY_TOLERANCE_CENTS
  ) {
    return { differenceCents, divergence: "bank_settlement" };
  }
  if (Math.abs(expectedAmountCents - cashAmountCents) > MONEY_TOLERANCE_CENTS) {
    return { differenceCents, divergence: "expected_amount" };
  }
  if (differenceCents > MONEY_TOLERANCE_CENTS) {
    if (input.paidOn <= input.dueDate) {
      return { differenceCents, divergence: "surcharge_before_due" };
    }
    if (bankSettlementAmountCents == null) {
      return { differenceCents, divergence: "bank_settlement" };
    }
  }
  return { differenceCents: Math.max(0, differenceCents), divergence: null };
}

export function expectedBarcodeDebitAmountCents(input: {
  requestedAmount: number;
  requestedSettlementAmount?: number | null;
  currentSettlementAmount?: number | null;
  observedSettlementAmountCents?: number | null;
}) {
  return input.observedSettlementAmountCents
    ?? cents(input.currentSettlementAmount)
    ?? cents(input.requestedSettlementAmount)
    ?? cents(input.requestedAmount)
    ?? 0;
}

export function planLateChargeBreakdown(input: {
  difference: number;
  bankInterest: number;
  bankFine: number;
}) {
  const difference = Math.max(0, Number(input.difference.toFixed(2)));
  const bankInterest = Math.max(0, Number(input.bankInterest.toFixed(2)));
  const bankFine = Math.max(0, Number(input.bankFine.toFixed(2)));
  if (difference > 0 && Math.abs(bankInterest + bankFine - difference) <= 0.05) {
    return { interest: bankInterest, fine: bankFine, otherCharge: 0 };
  }
  return { interest: 0, fine: 0, otherCharge: difference };
}
