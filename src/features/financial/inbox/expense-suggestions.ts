import type {
  FinancialInboxBillingIdentity,
  FinancialInboxClassification,
  FinancialInboxExpenseAlternative,
  FinancialInboxExpenseSuggestion,
  FinancialInboxExistingBankPayment,
  FinancialInboxExistingSettlement,
} from "./types";
import { extractBillingIdentity } from "./parser";

export type InboxExpenseCandidate = {
  id: string;
  description?: string | null;
  supplier?: string | null;
  totalValue?: number | null;
  dueDate?: unknown;
  competenceDate?: unknown;
  provisionCompetence?: string | null;
  status?: unknown;
  installments?: Array<Record<string, unknown>> | null;
  settlementEvidence?: FinancialInboxExistingSettlement[] | null;
  notes?: string | null;
  billingIdentity?: FinancialInboxBillingIdentity | null;
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
  const telecomAliases = new Set(["vivo", "telefonica"]);
  if (leftTokens.some((token) => telecomAliases.has(token)) && rightTokens.some((token) => telecomAliases.has(token))) {
    return true;
  }
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
  alternatives: FinancialInboxExpenseAlternative[] = [],
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
    alternatives,
  };
}

function intersect(left: string[], right: string[]) {
  const values = new Set(left);
  return right.some((entry) => values.has(entry));
}

function normalizedIdentity(candidate: InboxExpenseCandidate) {
  const embedded = extractBillingIdentity(`${candidate.description ?? ""}\n${candidate.supplier ?? ""}\n${candidate.notes ?? ""}`);
  const stored = candidate.billingIdentity;
  return {
    supplierTaxId: stored?.supplierTaxId || embedded.supplierTaxId,
    customerAccount: stored?.customerAccount || embedded.customerAccount,
    contractNumber: stored?.contractNumber || embedded.contractNumber,
    serviceType: stored?.serviceType || embedded.serviceType,
    serviceNumbers: [...new Set([...(stored?.serviceNumbers ?? []), ...embedded.serviceNumbers])],
  } satisfies FinancialInboxBillingIdentity;
}

function billingIdentityMatch(
  classification: FinancialInboxClassification,
  candidate: InboxExpenseCandidate,
) {
  const source = classification.billingIdentity;
  const target = normalizedIdentity(candidate);
  const reasons: string[] = [];
  let exact = false;
  let sameServiceNumber = false;
  if (source?.supplierTaxId && target.supplierTaxId && source.supplierTaxId === target.supplierTaxId) {
    reasons.push("mesmo CNPJ do fornecedor");
    exact = true;
  }
  if (source?.customerAccount && target.customerAccount && normalize(source.customerAccount) === normalize(target.customerAccount)) {
    reasons.push("mesma conta do cliente");
    exact = true;
  }
  if (source?.contractNumber && target.contractNumber && normalize(source.contractNumber) === normalize(target.contractNumber)) {
    reasons.push("mesmo contrato");
    exact = true;
  }
  if (source?.serviceNumbers.length && target.serviceNumbers.length && intersect(source.serviceNumbers, target.serviceNumbers)) {
    reasons.push("mesma linha telefônica");
    exact = true;
    sameServiceNumber = true;
  }
  const telecom = source?.serviceType === "mobile" || source?.serviceType === "landline";
  return { exact, telecomServiceNumberRequired: telecom, sameServiceNumber, reasons };
}

type ScoredInstallment = {
  alternative: FinancialInboxExpenseAlternative;
  autoMatch: boolean;
  bankPayment: FinancialInboxExistingBankPayment | null;
  settlement: FinancialInboxExistingSettlement | null;
};

function scoredInstallments(
  classification: FinancialInboxClassification,
  candidates: InboxExpenseCandidate[],
): ScoredInstallment[] {
  return candidates.flatMap((candidate) => {
    if (!["pending", "partially_paid", "paid"].includes(String(candidate.status ?? ""))) return [];
    const supplierMatches = equivalentSupplier(classification.supplierName, candidate.supplier);
    const identity = billingIdentityMatch(classification, candidate);
    const candidateRecord = candidate as InboxExpenseCandidate & Record<string, unknown>;
    const installments: Array<Record<string, unknown>> = Array.isArray(candidate.installments) && candidate.installments.length
      ? candidate.installments.map((installment) => ({ ...candidateRecord, ...installment }))
      : [{ ...candidateRecord, number: null, value: candidate.totalValue, dueDate: candidate.dueDate }];
    return installments.flatMap((installment, index): ScoredInstallment[] => {
      if (String(installment.status ?? "") === "cancelled") return [];
      const amountCents = Math.round(Number(installment.value ?? 0) * 100);
      const dueDate = dateKey(installment.dueDate ?? candidate.dueDate);
      const competence = candidate.provisionCompetence
        || dateKey(candidate.competenceDate)?.slice(0, 7)
        || null;
      const amountMatches = classification.amountCents != null && Math.abs(amountCents - classification.amountCents) <= 1;
      const dueDateMatches = Boolean(classification.dueDate && dueDate === classification.dueDate);
      const reasons = [
        ...(amountMatches ? ["mesmo valor"] : []),
        ...(dueDateMatches ? ["mesmo vencimento"] : []),
        ...(supplierMatches ? ["mesmo favorecido"] : []),
        ...identity.reasons,
      ];
      const score = (amountMatches ? 35 : 0)
        + (dueDateMatches ? 30 : 0)
        + (supplierMatches ? 20 : 0)
        + (identity.exact ? 35 : 0);
      if (score < 50) return [];
      const settlement = existingSettlement(installment, candidate);
      const bankPayment = settlement ? null : existingPayment(installment);
      return [{
        alternative: {
          expenseId: candidate.id,
          installmentNumber: installment.number == null ? null : Number(installment.number) || index + 1,
          installmentTotal: installments.length,
          description: String(candidate.description ?? "Despesa").trim(),
          supplier: String(candidate.supplier ?? "").trim(),
          amountCents,
          dueDate,
          competence,
          billingIdentity: normalizedIdentity(candidate),
          score,
          reasons,
        },
        autoMatch: amountMatches
          && dueDateMatches
          && supplierMatches
          && (!identity.telecomServiceNumberRequired || identity.sameServiceNumber),
        bankPayment,
        settlement,
      }];
    });
  }).sort((left, right) => right.alternative.score - left.alternative.score
    || left.alternative.expenseId.localeCompare(right.alternative.expenseId));
}

export function chooseExistingExpenseSuggestion(
  classification: FinancialInboxClassification,
  candidates: InboxExpenseCandidate[],
): FinancialInboxExpenseSuggestion {
  if (!classification.amountCents || !classification.dueDate || !classification.supplierName) {
    return emptySuggestion();
  }
  const scored = scoredInstallments(classification, candidates);
  const matches = scored.filter((entry) => entry.autoMatch);
  const alternatives = scored.slice(0, 5).map((entry) => entry.alternative);
  if (matches.length !== 1) return emptySuggestion(matches.length > 1 ? "ambiguous" : "not_found", alternatives);
  const match = matches[0];
  return {
    status: "suggested",
    expenseId: match.alternative.expenseId,
    installmentNumber: match.alternative.installmentNumber,
    installmentTotal: match.alternative.installmentTotal,
    description: match.alternative.description,
    supplier: match.alternative.supplier,
    amountCents: match.alternative.amountCents,
    dueDate: match.alternative.dueDate,
    competence: match.alternative.competence,
    billingIdentity: match.alternative.billingIdentity,
    reasons: match.alternative.reasons,
    paymentState: match.settlement ? "paid" : match.bankPayment ? "scheduled" : "needs_scheduling",
    existingBankPayment: match.bankPayment,
    existingSettlement: match.settlement,
    alternatives,
  };
}
