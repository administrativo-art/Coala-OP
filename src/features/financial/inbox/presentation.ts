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
  bank: ["awaiting_authorization", "payment_failed", "scheduled", "awaiting_statement"],
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
  const identifiedHandoff = ["identified", "scheduled", "awaiting_statement"].includes(message.status)
    && message.resolution?.status === "identified"
    && message.resolution.targetType === "expense"
    && Boolean(message.resolution.targetId)
    && ["scheduled", "reconciled"].includes(message.resolution.financialState ?? "")
    && ["scheduled", "awaiting_statement", "reconciled"].includes(message.bankState ?? "")
    && Boolean(message.bankTransactionId || message.existingBankPayment?.transactionId);
  if (identifiedHandoff) return true;
  return (message.status === "reconciled" || (message.status === "identified"
    && message.resolution?.status === "identified"
    && message.resolution.financialState === "reconciled"))
    && (!message.bankState || message.bankState === "reconciled")
    && (!message.existingBankPayment || Boolean(message.existingSettlement));
}

export function financialInboxArchiveCandidateReason(message: FinancialInboxMessage) {
  if (isFinancialInboxArchiveCandidate(message)) return "Pronta para arquivar";
  if (message.status === "payment_failed" || message.bankState === "failed") {
    return "Não pode ser arquivada: o envio ao banco falhou e exige revisão.";
  }
  if (message.status === "awaiting_authorization") {
    return "Não pode ser arquivada: a solicitação ainda aguarda autorização ou confirmação do banco.";
  }
  if (message.status === "scheduled" && !message.bankTransactionId) {
    return "Não pode ser arquivada: falta a confirmação identificável do agendamento no banco.";
  }
  if (message.status === "linked") {
    return "Não pode ser arquivada: a cobrança ainda não foi entregue ao fluxo bancário.";
  }
  return "Não pode ser arquivada enquanto o tratamento do e-mail estiver incompleto.";
}

export function matchesFinancialInboxSearch(message: FinancialInboxMessage, search: string) {
  const terms = normalizeFinancialInboxSearch(search).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalizeFinancialInboxSearch(financialInboxSearchValues(message).join(" "));
  return terms.every((term) => haystack.includes(term));
}
