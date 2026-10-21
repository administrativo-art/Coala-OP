import type {
  FinancialInboxMessage,
  FinancialInboxStage,
  FinancialInboxStatus,
} from "./types";
import { financialInboxSearchValues, normalizeFinancialInboxSearch } from "./search-index";

export const FINANCIAL_INBOX_STAGE_STATUSES: Record<FinancialInboxStage, FinancialInboxStatus[]> = {
  classify: ["pending_review", "document_pending", "under_review", "error"],
  link: ["suggestion_available", "divergent"],
  pay: ["linked"],
  bank: ["awaiting_authorization", "scheduled", "awaiting_statement"],
  done: ["identified", "reconciled"],
  off: ["ignored"],
  archive: ["archived"],
};

export const FINANCIAL_INBOX_WORK_STAGES: FinancialInboxStage[] = ["classify", "link", "pay", "bank"];
export const FINANCIAL_INBOX_IDENTIFIED_STAGES: FinancialInboxStage[] = ["pay", "bank", "done"];

export const FINANCIAL_INBOX_WORK_STATUSES = FINANCIAL_INBOX_WORK_STAGES
  .flatMap((stage) => FINANCIAL_INBOX_STAGE_STATUSES[stage]);
export const FINANCIAL_INBOX_IDENTIFIED_STATUSES = FINANCIAL_INBOX_IDENTIFIED_STAGES
  .flatMap((stage) => FINANCIAL_INBOX_STAGE_STATUSES[stage]);

export const FINANCIAL_INBOX_STAGES = Object.keys(FINANCIAL_INBOX_STAGE_STATUSES) as FinancialInboxStage[];

export function financialInboxStageForStatus(status: FinancialInboxStatus): FinancialInboxStage {
  return FINANCIAL_INBOX_STAGES.find((stage) => FINANCIAL_INBOX_STAGE_STATUSES[stage].includes(status)) ?? "classify";
}

export function isFinancialInboxBulkDiscardEligible(message: Pick<FinancialInboxMessage, "status" | "linkedExpenseId" | "paymentRequestId">) {
  if (message.linkedExpenseId || message.paymentRequestId) return false;
  return ["pending_review", "document_pending", "suggestion_available", "divergent", "error"].includes(message.status);
}

/** Sinal local conservador; o servidor relê pedido e obrigação antes de arquivar. */
export function isFinancialInboxArchiveCandidate(message: FinancialInboxMessage) {
  if (message.status === "ignored") {
    return !message.linkedExpenseId && !message.linkedProvisionId && !message.obligationId
      && !message.paymentRequestId && !message.existingBankPayment && !message.statementTransactionId
      && (!message.bankState || ["not_prepared", "cancelled"].includes(message.bankState));
  }
  return (message.status === "reconciled" || (message.status === "identified"
    && message.resolution?.status === "identified"
    && message.resolution.financialState === "reconciled"))
    && (!message.bankState || message.bankState === "reconciled")
    && (!message.existingBankPayment || Boolean(message.existingSettlement));
}

export function matchesFinancialInboxSearch(message: FinancialInboxMessage, search: string) {
  const terms = normalizeFinancialInboxSearch(search).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalizeFinancialInboxSearch(financialInboxSearchValues(message).join(" "));
  return terms.every((term) => haystack.includes(term));
}
