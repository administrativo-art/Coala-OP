import type { FinancialInboxMessage } from "./types";

export type FinancialInboxAccountingContext = {
  accountPlanId: string | null;
  accountPlanName: string | null;
  hasAccountAllocations: boolean;
  accountAllocations: Array<{ accountPlanId: string; amount: number }>;
  referenceResultCenterId: string | null;
  referenceResultCenterName: string | null;
  isApportioned: boolean;
  apportionments: Array<{
    resultCenter: string;
    percentage: number;
    basisValue?: number;
    participationStartDate?: string;
  }>;
  rateioCriterion: string | null;
  rateioEffectiveFrom: string | null;
  rateioFirstMonthMode: string | null;
};

export type FinancialInboxExpenseContext = {
  id: string;
  source: "linked" | "identified" | "suggested" | "provision";
  state: "open" | "scheduled" | "paid";
  status: string | null;
  description: string | null;
  supplier: string | null;
  supplierTaxId: string | null;
  amountCents: number | null;
  dueDate: string | null;
  competence: string | null;
  editable: boolean;
  accounting: FinancialInboxAccountingContext;
};

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function isoDate(value: unknown) {
  if (!value) return null;
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function amountCents(expense: Record<string, unknown>) {
  const raw = Number(expense.totalValue ?? expense.amount ?? expense.value);
  return Number.isFinite(raw) ? Math.round(raw * 100) : null;
}

export function relatedExpenseIdentity(message: FinancialInboxMessage) {
  if (message.linkedExpenseId) return { id: message.linkedExpenseId, source: "linked" as const };
  if (message.resolution?.targetType === "expense" && message.resolution.targetId) {
    return { id: message.resolution.targetId, source: "identified" as const };
  }
  if (message.existingExpenseSuggestion?.expenseId) {
    return { id: message.existingExpenseSuggestion.expenseId, source: "suggested" as const };
  }
  if (message.provisionSuggestion?.provisionExpenseId) {
    return { id: message.provisionSuggestion.provisionExpenseId, source: "provision" as const };
  }
  return null;
}

export function buildFinancialInboxExpenseContext(
  id: string,
  source: FinancialInboxExpenseContext["source"],
  expense: Record<string, unknown>,
): FinancialInboxExpenseContext {
  const settlement = expense.settlementSummary as Record<string, unknown> | null | undefined;
  const normalizedStatus = text(expense.status)?.toLowerCase() ?? null;
  const paid = normalizedStatus === "paid" || settlement?.reconciliationStatus === "MATCHED";
  const scheduled = !paid && (
    Boolean(expense.paymentRequestId || expense.bankPaymentTransactionId)
    || ["scheduled", "awaiting_statement"].includes(normalizedStatus ?? "")
  );
  const allocations = Array.isArray(expense.accountAllocations) ? expense.accountAllocations : [];
  const apportionments = Array.isArray(expense.apportionments) ? expense.apportionments : [];
  const billingIdentity = expense.billingIdentity && typeof expense.billingIdentity === "object"
    ? expense.billingIdentity as Record<string, unknown>
    : null;
  const boletoAttachment = expense.boletoAttachment && typeof expense.boletoAttachment === "object"
    ? expense.boletoAttachment as Record<string, unknown>
    : null;
  return {
    id,
    source,
    state: paid ? "paid" : scheduled ? "scheduled" : "open",
    status: normalizedStatus,
    description: text(expense.description),
    supplier: text(expense.supplier),
    supplierTaxId: text(
      billingIdentity?.supplierTaxId
      ?? expense.supplierTaxId
      ?? expense.beneficiaryDocument
      ?? boletoAttachment?.beneficiaryDocument,
    )?.replace(/\D/g, "") || null,
    amountCents: amountCents(expense),
    dueDate: isoDate(expense.dueDate)?.slice(0, 10) ?? null,
    competence: isoDate(expense.competenceDate)?.slice(0, 7) ?? text(expense.competence),
    editable: !paid && !scheduled && !["cancelled", "canceled"].includes(normalizedStatus ?? ""),
    accounting: {
      accountPlanId: text(expense.accountPlan ?? expense.accountId),
      accountPlanName: text(expense.accountPlanName),
      hasAccountAllocations: expense.hasAccountAllocations === true && allocations.length > 0,
      accountAllocations: allocations.flatMap((entry) => {
        const allocation = entry as Record<string, unknown>;
        const accountPlanId = text(allocation.accountPlanId);
        const amount = Number(allocation.amount);
        return accountPlanId && Number.isFinite(amount) ? [{ accountPlanId, amount }] : [];
      }),
      referenceResultCenterId: text(expense.referenceResultCenterId ?? expense.resultCenterId),
      referenceResultCenterName: text(expense.referenceResultCenterName ?? expense.resultCenterName ?? expense.resultCenter),
      isApportioned: expense.isApportioned === true && apportionments.length > 0,
      apportionments: apportionments.flatMap((entry) => {
        const allocation = entry as Record<string, unknown>;
        const resultCenter = text(allocation.resultCenter);
        const percentage = Number(allocation.percentage);
        if (!resultCenter || !Number.isFinite(percentage)) return [];
        const basisValue = Number(allocation.basisValue);
        return [{
          resultCenter,
          percentage,
          ...(Number.isFinite(basisValue) ? { basisValue } : {}),
          ...(isoDate(allocation.participationStartDate) ? { participationStartDate: isoDate(allocation.participationStartDate)!.slice(0, 10) } : {}),
        }];
      }),
      rateioCriterion: text(expense.rateioCriterion),
      rateioEffectiveFrom: isoDate(expense.rateioEffectiveFrom)?.slice(0, 10) ?? null,
      rateioFirstMonthMode: text(expense.rateioFirstMonthMode),
    },
  };
}
