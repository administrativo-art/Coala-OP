import type {
  FinancialInboxMessage,
  FinancialInboxStage,
  FinancialInboxStatus,
} from "./types";

export const FINANCIAL_INBOX_STAGE_STATUSES: Record<FinancialInboxStage, FinancialInboxStatus[]> = {
  classify: ["pending_review", "document_pending", "under_review", "error"],
  link: ["suggestion_available", "divergent"],
  pay: ["linked"],
  bank: ["awaiting_authorization", "scheduled", "awaiting_statement"],
  done: ["reconciled"],
  off: ["ignored"],
};

export const FINANCIAL_INBOX_STAGES = Object.keys(FINANCIAL_INBOX_STAGE_STATUSES) as FinancialInboxStage[];

export function financialInboxStageForStatus(status: FinancialInboxStatus): FinancialInboxStage {
  return FINANCIAL_INBOX_STAGES.find((stage) => FINANCIAL_INBOX_STAGE_STATUSES[stage].includes(status)) ?? "classify";
}

export function isFinancialInboxBulkDiscardEligible(message: Pick<FinancialInboxMessage, "status" | "linkedExpenseId" | "paymentRequestId">) {
  if (message.linkedExpenseId || message.paymentRequestId) return false;
  return ["pending_review", "document_pending", "suggestion_available", "divergent", "error"].includes(message.status);
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function amountSearchValues(amountCents: number | null | undefined) {
  if (amountCents == null) return [];
  const value = (amountCents / 100).toFixed(2);
  return [value, value.replace(".", ","), String(amountCents)];
}

export function matchesFinancialInboxSearch(message: FinancialInboxMessage, search: string) {
  const terms = normalize(search).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalize([
    message.from,
    message.fromAddress,
    message.senderDomain,
    message.subject,
    message.classification.supplierName,
    ...amountSearchValues(message.classification.amountCents),
    message.classification.billingIdentity?.customerAccount,
    message.classification.billingIdentity?.contractNumber,
    ...(message.classification.billingIdentity?.serviceNumbers ?? []),
  ].filter(Boolean).join(" "));
  return terms.every((term) => haystack.includes(term));
}
