import { z } from "zod";

/** Shape the web purchasing screens read; money in cents, dates as stored. */
export type LocalPurchaseSummary = {
  id: string;
  unitId: string;
  unitName: string;
  supplierName: string;
  supplierTaxId: string | null;
  purchaseDate: string;
  createdAt: string;
  totalCents: number;
  fundingSource: "cash_withdrawal" | "company_payment";
  companyPaymentMethod: string | null;
  status: string;
  accountPlanName: string;
  resultCenterName: string;
  note: string;
  stockEntryStatus: "done" | "pending" | "not_needed" | "reversed";
  items: Array<{ description: string; quantity: number; unit: string; totalCents: number }>;
  stockLines: Array<{ itemIndex: number; productName: string; quantity: number; expiryDate: string | null; lotCode: string }>;
  withdrawal: null | { amountCents: number; date: string; changeCents: number };
  cancellation: null | { reason: string; at: string; by: string };
};

export const reverseLocalPurchaseSchema = z.object({
  purchaseId: z.string().trim().min(1).max(200).regex(/^[^/]+$/),
  reason: z.string().trim().min(5, "Informe o motivo do estorno.").max(500),
}).strict();

/** Why a local purchase cannot be reversed right now, or null when it can. */
export function localPurchaseReversalBlock(input: {
  purchaseStatus: string;
  expense: Record<string, unknown> | null;
}) {
  if (input.purchaseStatus === "cancelled") return null;
  if (input.purchaseStatus === "reconciled" || input.expense?.sourceSettlement) {
    return "A compra já está vinculada a uma sangria. Desfaça o vínculo no fechamento de caixa antes de estornar.";
  }
  const expense = input.expense;
  if (expense && (expense.status === "paid" || expense.status === "partially_paid" || expense.paidAt
    || expense.linkedBankTransactionId || expense.paymentRequestId || expense.paymentId)) {
    return "A despesa desta compra já tem pagamento registrado. Estorne o pagamento antes de estornar a compra.";
  }
  return null;
}

/** Stock that would go negative: the goods were already consumed, transferred or written down. */
export function localPurchaseStockShortfalls(lines: Array<{ productName: string; quantity: number }>, available: number[]) {
  return lines.flatMap((line, index) => (available[index] ?? 0) + 1e-9 < line.quantity
    ? [`${line.productName} (entrou ${line.quantity}, restam ${Math.max(0, available[index] ?? 0)})`]
    : []);
}
