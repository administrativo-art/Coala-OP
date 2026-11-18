import { AppError } from "@/lib/observability/app-error";
import { calculateFinancialObligationSummary } from "../obligations/calculations";

/** Server-owned retention/settlement evidence; an acquirer receivable may await settlement. */
export type SourceSettlement = {
  version: 1;
  kind: "cash_withdrawal" | "acquirer_fee";
  sourceId: string;
  fingerprint: string;
  amountCents: number;
  competenceMonth: string;
  settledOn: string | null;
  phase?: "receivable" | "partial" | "settled";
  expectedOn?: string;
  estimated?: boolean;
  sourceIncomplete?: boolean;
  workspaceId: string;
  unitId: string;
};

export function assertExpenseAllowsNewPayment(expense: Record<string, unknown>) {
  // Even malformed evidence must not reopen a settled expense for payment.
  if (Object.prototype.hasOwnProperty.call(expense, "sourceSettlement")) {
    throw new AppError({ code: "EXPENSE_SETTLED_AT_SOURCE", kind: "CONFLICT",
      safeMessage: "Esta despesa está vinculada à retenção na origem/recebível. Confira a origem; não há um segundo pagamento bancário." });
  }
}

/** No MATCHED bank evidence and no payment/split/transaction is fabricated. */
export function sourceSettlementSummary(amountCents: number) {
  return calculateFinancialObligationSummary({ actualAmountCents: amountCents,
    paymentAllocations: [{ principalAmountCents: amountCents, cashAmountCents: amountCents, status: "REPORTED" }] });
}
