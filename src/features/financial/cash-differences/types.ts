export type CashDifferenceClassification =
  | "operational_loss"
  | "unrecorded_sale"
  | "incorrect_cash_movement"
  | "employee_receivable"
  | "unexplained_surplus"
  | "counting_error"
  | "integration_error";

export type CashDifferenceDecision = {
  id: string;
  workspaceId: string;
  closureId: string;
  kioskId: string;
  kioskName: string;
  period: string;
  closureDate: string;
  sourceHash: string;
  differenceAmountCents: number;
  classification: CashDifferenceClassification;
  reason: string;
  accountPlanId?: string | null;
  accountPlanName?: string | null;
  revenueAdjustmentCents: number;
  expenseAmountCents: number;
  expenseId?: string | null;
  actor: { id: string; name: string | null; email: string | null };
  decidedAt: unknown;
};

export function cashDifferenceEffects(input: {
  differenceAmountCents: number;
  classification: CashDifferenceClassification;
}) {
  if (!Number.isSafeInteger(input.differenceAmountCents) || input.differenceAmountCents === 0) {
    throw new Error("O fechamento não possui diferença financeira classificável.");
  }
  if (input.classification === "operational_loss") {
    if (input.differenceAmountCents >= 0) throw new Error("Perda operacional exige falta de caixa.");
    return { revenueAdjustmentCents: 0, expenseAmountCents: Math.abs(input.differenceAmountCents) };
  }
  if (input.classification === "unrecorded_sale") {
    if (input.differenceAmountCents <= 0) throw new Error("Venda não registrada exige sobra de caixa.");
    return { revenueAdjustmentCents: input.differenceAmountCents, expenseAmountCents: 0 };
  }
  return { revenueAdjustmentCents: 0, expenseAmountCents: 0 };
}
