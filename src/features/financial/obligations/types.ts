export type FinancialObligationStatus = "OPEN" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";

export type FinancialReconciliationStatus =
  | "NOT_FOUND"
  | "PENDING_DOCUMENT"
  | "MATCHED"
  | "DIVERGENT";

export type ObligationPaymentLinkStatus = "REPORTED" | "SUGGESTED" | "MATCHED" | "VOIDED";

export type PaymentAdjustmentType = "INTEREST" | "FINE" | "DISCOUNT" | "ABATEMENT" | "OTHER";

export type PaymentAdjustmentEffect =
  | "CASH_CHARGE"
  | "SETTLEMENT_CREDIT"
  | "CASH_REDUCTION"
  | "INFORMATIONAL";

export type PaymentAdjustmentStatus = "PENDING" | "CLASSIFIED" | "VOIDED";

export type ObligationPaymentAllocation = {
  id?: string;
  paymentId?: string | null;
  bankTransactionId?: string | null;
  expenseId?: string | null;
  installmentId?: string | null;
  principalAmountCents: number;
  cashAmountCents: number;
  status: ObligationPaymentLinkStatus;
};

export type ObligationPaymentAdjustment = {
  id?: string;
  linkId?: string | null;
  bankTransactionId?: string | null;
  type: PaymentAdjustmentType;
  effect: PaymentAdjustmentEffect;
  amountCents: number;
  status: PaymentAdjustmentStatus;
};

export type FinancialObligationCalculationInput = {
  forecastAmountCents?: number | null;
  actualAmountCents?: number | null;
  settlementAmountCents?: number | null;
  cancelled?: boolean;
  paymentAllocations?: ObligationPaymentAllocation[];
  adjustments?: ObligationPaymentAdjustment[];
};

export type FinancialObligationSummary = {
  forecastAmountCents: number | null;
  actualAmountCents: number | null;
  settlementAmountCents: number | null;
  reportedCashAmountCents: number;
  confirmedCashAmountCents: number;
  cashPaidAmountCents: number;
  principalSettledAmountCents: number;
  confirmedPrincipalAmountCents: number;
  settlementCreditsAmountCents: number;
  cashChargesAmountCents: number;
  cashReductionsAmountCents: number;
  unclassifiedDifferenceAmountCents: number;
  balanceAmountCents: number | null;
  obligationStatus: FinancialObligationStatus;
  reconciliationStatus: FinancialReconciliationStatus;
  paymentEvidenceStatus: "NONE" | "REPORTED" | "CONFIRMED" | "MIXED";
};

export type FinancialObligationRecord = {
  id: string;
  seriesKey?: string | null;
  competenceKey?: string | null;
  deduplicationKey?: string | null;
  obligationType?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  status: FinancialObligationStatus;
  reconciliationStatus: FinancialReconciliationStatus;
  summary: FinancialObligationSummary;
};
