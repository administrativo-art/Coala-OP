import type {
  FinancialInboxClassification,
  FinancialInboxExpenseSuggestion,
  FinancialInboxExistingBankPayment,
  FinancialInboxExistingSettlement,
} from "./types";

export type InboxExpenseCandidate = {
  id: string;
  description?: string | null;
  supplier?: string | null;
  totalValue?: number | null;
  dueDate?: unknown;
  status?: unknown;
  installments?: Array<Record<string, unknown>> | null;
  settlementEvidence?: FinancialInboxExistingSettlement[] | null;
};

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function supplierTokens(value: unknown) {
  const ignored = new Set(["ltda", "eireli", "sa", "brasil", "comercio", "industria"]);
  return normalize(value).split(" ").filter((token) => token.length >= 3 && !ignored.has(token));
}

export function equivalentSupplier(left: unknown, right: unknown) {
  const leftTokens = supplierTokens(left);
  const rightTokens = supplierTokens(right);
  if (!leftTokens.length || !rightTokens.length) return false;
  const smaller = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
  const larger = new Set(leftTokens.length <= rightTokens.length ? rightTokens : leftTokens);
  return smaller.every((token) => larger.has(token));
}

function dateKey(value: unknown) {
  const date = value && typeof (value as { toDate?: unknown }).toDate === "function"
    ? (value as { toDate: () => Date }).toDate()
    : value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

export function existingPayment(installment: Record<string, unknown>): FinancialInboxExistingBankPayment | null {
  const transactionId = String(installment.bankPaymentTransactionId ?? "").trim();
  if (!transactionId) return null;
  const combinedStatus = `${installment.bankPaymentStatus ?? ""} ${installment.paymentSchedulingStatus ?? ""}`.toLowerCase();
  if (/cancel|rejeit|recus|failed|falh/.test(combinedStatus)) return null;
  return {
    transactionId,
    bankStatus: String(installment.bankPaymentStatus ?? "").trim() || null,
    schedulingStatus: String(installment.paymentSchedulingStatus ?? "").trim() || null,
    scheduledFor: dateKey(installment.bankPaymentScheduledFor),
  };
}

function existingSettlement(
  installment: Record<string, unknown>,
  candidate: InboxExpenseCandidate,
): FinancialInboxExistingSettlement | null {
  const directTransactionId = String(installment.linkedBankTransactionId ?? "").trim();
  if (directTransactionId) {
    return { transactionId: directTransactionId, paidAt: dateKey(installment.paidAt) };
  }
  return candidate.settlementEvidence?.length === 1 ? candidate.settlementEvidence[0] : null;
}

function emptySuggestion(
  status: "not_found" | "ambiguous" = "not_found",
): FinancialInboxExpenseSuggestion {
  return {
    status,
    expenseId: null,
    installmentNumber: null,
    installmentTotal: null,
    description: null,
    supplier: null,
    amountCents: null,
    dueDate: null,
    reasons: [],
    paymentState: null,
    existingBankPayment: null,
    existingSettlement: null,
  };
}

export function chooseExistingExpenseSuggestion(
  classification: FinancialInboxClassification,
  candidates: InboxExpenseCandidate[],
): FinancialInboxExpenseSuggestion {
  if (!classification.amountCents || !classification.dueDate || !classification.supplierName) {
    return emptySuggestion();
  }
  const matches = candidates.flatMap((candidate) => {
    if (!["pending", "partially_paid", "paid"].includes(String(candidate.status ?? ""))) return [];
    if (!equivalentSupplier(classification.supplierName, candidate.supplier)) return [];
    const candidateRecord = candidate as InboxExpenseCandidate & Record<string, unknown>;
    const installments: Array<Record<string, unknown>> = Array.isArray(candidate.installments) && candidate.installments.length
      ? candidate.installments.map((installment) => ({ ...candidateRecord, ...installment }))
      : [{ ...candidateRecord, number: null, value: candidate.totalValue, dueDate: candidate.dueDate }];
    return installments.flatMap((installment, index) => {
      if (String(installment.status ?? "") === "cancelled") return [];
      const amountCents = Math.round(Number(installment.value ?? 0) * 100);
      const dueDate = dateKey(installment.dueDate ?? candidate.dueDate);
      if (Math.abs(amountCents - classification.amountCents!) > 1 || dueDate !== classification.dueDate) return [];
      const settlement = existingSettlement(installment, candidate);
      const bankPayment = settlement ? null : existingPayment(installment);
      return [{
        status: "suggested" as const,
        expenseId: candidate.id,
        installmentNumber: installment.number == null ? null : Number(installment.number) || index + 1,
        installmentTotal: installments.length,
        description: String(candidate.description ?? "Despesa").trim(),
        supplier: String(candidate.supplier ?? "").trim(),
        amountCents,
        dueDate,
        reasons: ["mesmo valor", "mesmo vencimento", "mesmo favorecido"],
        paymentState: settlement ? "paid" as const : bankPayment ? "scheduled" as const : "needs_scheduling" as const,
        existingBankPayment: bankPayment,
        existingSettlement: settlement,
      }];
    });
  });
  if (matches.length !== 1) return emptySuggestion(matches.length > 1 ? "ambiguous" : "not_found");
  return matches[0];
}
