import { AppError } from "@/lib/observability/app-error";
import { calculateFinancialObligationSummary } from "../obligations/calculations";

/** Server-owned evidence of an already executed, non-bank settlement. */
export type SourceSettlement = {
  version: 1;
  kind: "cash_withdrawal" | "acquirer_fee";
  sourceId: string;
  fingerprint: string;
  amountCents: number;
  competenceMonth: string;
  settledOn: string;
  workspaceId: string;
  unitId: string;
};

export function assertExpenseAllowsNewPayment(expense: Record<string, unknown>) {
  // Even malformed evidence must not reopen a settled expense for payment.
  if (Object.prototype.hasOwnProperty.call(expense, "sourceSettlement")) {
    throw new AppError({ code: "EXPENSE_SETTLED_AT_SOURCE", kind: "CONFLICT",
      safeMessage: "Esta despesa já foi quitada na origem. Corrija o vínculo na origem antes de registrar outro pagamento." });
  }
}

/** No MATCHED bank evidence and no payment/split/transaction is fabricated. */
export function sourceSettlementSummary(amountCents: number) {
  return calculateFinancialObligationSummary({ actualAmountCents: amountCents,
    paymentAllocations: [{ principalAmountCents: amountCents, cashAmountCents: amountCents, status: "REPORTED" }] });
}
