import type { FinancialInboxMessage } from "./types";

type AnalysisSource = Pick<FinancialInboxMessage,
  "workspaceId" | "status" | "updatedAt" | "linkedExpenseId" | "paymentRequestId">;

export function canCommitFinancialInboxAnalysis(expected: AnalysisSource, current: Partial<AnalysisSource> | null) {
  return Boolean(current
    && current.workspaceId === expected.workspaceId
    && current.updatedAt === expected.updatedAt
    && current.status === expected.status
    && (current.linkedExpenseId || null) === (expected.linkedExpenseId || null)
    && (current.paymentRequestId || null) === (expected.paymentRequestId || null));
}
