import { validBrazilianTaxId, normalizeBrazilianDocument } from "@/features/financial/beneficiaries/normalization";

export type SupplierPixExpense = {
  id: string;
  status?: string;
  provisionType?: string | null;
  paymentMethod?: string;
  supplierId?: string | null;
  originModule?: string | null;
  purchaseOrderId?: string | null;
  purchaseExpenseRole?: string | null;
  unitId?: string | null;
  workspaceId?: string | null;
  billingIdentity?: { supplierTaxId?: string | null };
  financialInboxMessageId?: string | null;
  generatedReceiptId?: string | null;
  paymentRequestId?: string | null;
  accountPlan?: string | null;
  accountId?: string | null;
  referenceResultCenterId?: string | null;
  resultCenterId?: string | null;
  competenceDate?: unknown;
  provisionCompetence?: string | null;
  dueDate?: unknown;
  installments?: Array<{ status?: string; value?: number; paidAt?: unknown }>;
  totalValue: number;
  netPayableValue?: number | null;
};

export function supplierPixPrepareInput(expense: SupplierPixExpense): { supplierEntityId: string; amountCents: number } | null {
  const amountCents = Math.round(expense.totalValue * 100);
  const document = normalizeBrazilianDocument(expense.billingIdentity?.supplierTaxId);
  const purchaseGoods = expense.originModule === "purchasing" && Boolean(expense.purchaseOrderId)
    && (expense.purchaseExpenseRole === "goods" || expense.purchaseExpenseRole === "combined");
  if (expense.status !== "pending" || expense.paymentMethod !== "single"
    || expense.provisionType === "forecast" || expense.financialInboxMessageId || expense.generatedReceiptId || expense.paymentRequestId != null
    || (expense.netPayableValue != null && Math.round(expense.netPayableValue * 100) !== amountCents)
    || !expense.supplierId || !validBrazilianTaxId(document) || !expense.unitId
    || !(expense.accountPlan || expense.accountId) || !(expense.referenceResultCenterId || expense.resultCenterId)
    || !(expense.competenceDate || expense.provisionCompetence) || !expense.dueDate
    || !Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 100_000_000
    || (!purchaseGoods && (!Array.isArray(expense.installments) || expense.installments.length !== 1))
    || (Array.isArray(expense.installments) && (expense.installments.length > 1
      || expense.installments.some(item => item.status !== "pending" || item.paidAt
        || Math.round(Number(item.value) * 100) !== amountCents)))) return null;
  return { supplierEntityId: expense.supplierId, amountCents };
}

export function purchasePixNeedsSync(expense: SupplierPixExpense): boolean {
  return expense.originModule === "purchasing" && Boolean(expense.purchaseOrderId)
    && (expense.purchaseExpenseRole === "goods" || expense.purchaseExpenseRole === "combined")
    && expense.status === "pending" && expense.paymentMethod === "single"
    && !expense.paymentRequestId && !expense.financialInboxMessageId
    && (!expense.supplierId || !expense.unitId
      || !validBrazilianTaxId(expense.billingIdentity?.supplierTaxId)
      || !(expense.accountPlan || expense.accountId)
      || !(expense.referenceResultCenterId || expense.resultCenterId)
      || !(expense.competenceDate || expense.provisionCompetence) || !expense.dueDate);
}
