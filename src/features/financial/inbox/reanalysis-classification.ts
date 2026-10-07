import type { FinancialInboxClassification, FinancialInboxStatus } from "./types";

const MUTABLE_ANALYSIS_STATUSES = new Set<FinancialInboxStatus>([
  "pending_review",
  "document_pending",
  "suggestion_available",
]);

export function classificationForFinancialInboxReanalysis(input: {
  status: FinancialInboxStatus;
  current: FinancialInboxClassification;
  reparsed: FinancialInboxClassification;
}) {
  const base = MUTABLE_ANALYSIS_STATUSES.has(input.status) ? input.reparsed : input.current;
  return {
    ...base,
    links: input.current.links?.length ? input.current.links : input.reparsed.links,
  };
}
