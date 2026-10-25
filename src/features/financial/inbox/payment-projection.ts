import type { BankPaymentRequest } from "../payment-requests/types";
import { financialInboxManualArchivePlan, FINANCIAL_INBOX_RETENTION_POLICY_VERSION } from "./retention-policy";
import { resolutionForDisplay } from "./resolution-contract";
import type {
  FinancialInboxBankState,
  FinancialInboxFinancialState,
  FinancialInboxMessage,
  FinancialInboxStatus,
} from "./types";

export const FINANCIAL_INBOX_PAYMENT_PROJECTION_VERSION = 1;
export const FINANCIAL_INBOX_PAYMENT_PROJECTION_STATE_ID =
  `inbox-payment-projection-v${FINANCIAL_INBOX_PAYMENT_PROJECTION_VERSION}`;

export type FinancialInboxPaymentProjection = {
  status: FinancialInboxStatus;
  bankState: FinancialInboxBankState;
  financialState: FinancialInboxFinancialState;
  handoffConfirmed: boolean;
  requiresAction: boolean;
};

export function projectFinancialInboxPaymentRequest(
  request: Pick<
    BankPaymentRequest,
    "status" | "interRequestId" | "statementReconciliationStatus"
  >,
): FinancialInboxPaymentProjection {
  if (["failed", "rejected", "approval_expired", "cancelled"].includes(request.status)) {
    return {
      status: "payment_failed",
      bankState: request.status === "cancelled" ? "cancelled" : "failed",
      financialState: "payment_prepared",
      handoffConfirmed: false,
      requiresAction: true,
    };
  }
  if (request.status === "scheduled") {
    return {
      status: "scheduled",
      bankState: "scheduled",
      financialState: "scheduled",
      handoffConfirmed: Boolean(request.interRequestId),
      requiresAction: false,
    };
  }
  if (request.status === "processing") {
    return {
      status: "awaiting_statement",
      bankState: "processing",
      financialState: "scheduled",
      handoffConfirmed: Boolean(request.interRequestId),
      requiresAction: false,
    };
  }
  if (request.status === "awaiting_statement" || request.status === "paid") {
    const reconciled = request.status === "paid" && request.statementReconciliationStatus === "matched";
    return {
      status: reconciled ? "reconciled" : "awaiting_statement",
      bankState: reconciled ? "reconciled" : "awaiting_statement",
      financialState: reconciled ? "reconciled" : "scheduled",
      handoffConfirmed: Boolean(request.interRequestId),
      requiresAction: false,
    };
  }
  if (request.status === "awaiting_bank_approval") {
    return {
      status: "awaiting_authorization",
      bankState: "awaiting_bank_approval",
      financialState: "payment_prepared",
      handoffConfirmed: false,
      requiresAction: false,
    };
  }
  if (request.status === "ready_to_submit") {
    return {
      status: "awaiting_authorization",
      bankState: "ready_to_submit",
      financialState: "payment_prepared",
      handoffConfirmed: false,
      requiresAction: false,
    };
  }
  if (request.status === "submitting") {
    return {
      status: "awaiting_authorization",
      bankState: "submitted",
      financialState: "payment_prepared",
      handoffConfirmed: false,
      requiresAction: false,
    };
  }
  return {
    status: request.status === "draft" ? "linked" : "awaiting_authorization",
    bankState: request.status === "draft" ? "not_prepared" : "awaiting_authorization",
    financialState: request.status === "draft" ? "open" : "payment_prepared",
    handoffConfirmed: false,
    requiresAction: false,
  };
}

function threadWithStatus(message: FinancialInboxMessage, status: FinancialInboxStatus) {
  if (!message.thread?.messages?.length) return undefined;
  return {
    ...message.thread,
    messages: message.thread.messages.map((entry) => (
      entry.id === message.id ? { ...entry, status } : entry
    )),
  };
}

function matchesMessageExpense(
  message: FinancialInboxMessage,
  request: Pick<BankPaymentRequest, "sourceType" | "sourceId" | "expenseId" | "workspaceId">,
) {
  const resolution = resolutionForDisplay(message);
  const expenseId = message.linkedExpenseId
    || (resolution.targetType === "expense" ? resolution.targetId : null);
  if (!expenseId || request.expenseId !== expenseId) return false;
  if (request.workspaceId && request.workspaceId !== message.workspaceId) return false;
  const secondary = resolution.kind === "reminder" || resolution.kind === "duplicate";
  if (request.sourceType === "financial_inbox") return request.sourceId === message.id || secondary;
  return request.sourceType === "expense_boleto" && secondary && request.sourceId === expenseId;
}

export type FinancialInboxPaymentProjectionPlan = {
  patch: Record<string, unknown>;
  transition: "archive" | "action_required" | "update";
};

export function planFinancialInboxPaymentProjection(params: {
  message: FinancialInboxMessage;
  request: Pick<
    BankPaymentRequest,
    | "status"
    | "interRequestId"
    | "statementReconciliationStatus"
    | "sourceType"
    | "sourceId"
    | "expenseId"
    | "workspaceId"
  >;
  observedAt: string;
}): FinancialInboxPaymentProjectionPlan {
  const projection = projectFinancialInboxPaymentRequest(params.request);
  const resolution = resolutionForDisplay(params.message);
  const basePatch: Record<string, unknown> = {
    bankState: projection.bankState,
    bankTransactionId: params.request.interRequestId ?? null,
    paymentProjectionVersion: FINANCIAL_INBOX_PAYMENT_PROJECTION_VERSION,
    updatedAt: params.observedAt,
  };
  const nextThread = threadWithStatus(params.message, projection.status);
  if (nextThread) basePatch.thread = nextThread;

  if (projection.requiresAction && matchesMessageExpense(params.message, params.request)) {
    return {
      transition: "action_required",
      patch: {
        ...basePatch,
        status: "payment_failed",
        resolution: {
          ...resolution,
          status: "identified",
          financialState: "payment_prepared",
        },
        archivedAt: null,
        archivedBy: null,
        archivedFromStatus: null,
        retentionClass: null,
        purgeEligibleAt: null,
        retentionPolicyVersion: null,
      },
    };
  }

  if (projection.handoffConfirmed
    && params.message.status !== "archived"
    && matchesMessageExpense(params.message, params.request)) {
    const retention = financialInboxManualArchivePlan(params.message, new Date(params.observedAt));
    const archivedThread = threadWithStatus(params.message, "archived");
    return {
      transition: "archive",
      patch: {
        ...basePatch,
        status: "archived",
        resolution: {
          ...resolution,
          status: "archived",
          financialState: projection.financialState,
        },
        ...(archivedThread ? { thread: archivedThread } : {}),
        archivedAt: params.observedAt,
        archivedBy: "system:financial-inbox-handoff",
        archivedFromStatus: "identified",
        retentionClass: retention.retentionClass,
        purgeEligibleAt: retention.purgeEligibleAt,
        retentionPolicyVersion: FINANCIAL_INBOX_RETENTION_POLICY_VERSION,
      },
    };
  }

  const keepArchived = params.message.status === "archived" && !projection.requiresAction;
  const keptArchivedThread = keepArchived
    ? threadWithStatus(params.message, "archived")
    : undefined;
  return {
    transition: "update",
    patch: {
      ...basePatch,
      status: keepArchived ? "archived" : projection.status,
      resolution: {
        ...resolution,
        status: keepArchived ? "archived" : "identified",
        financialState: projection.financialState,
      },
      ...(keptArchivedThread ? { thread: keptArchivedThread } : {}),
    },
  };
}
