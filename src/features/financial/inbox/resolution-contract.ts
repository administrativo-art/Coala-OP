import type {
  FinancialInboxBankState,
  FinancialInboxExpenseSuggestion,
  FinancialInboxFinancialState,
  FinancialInboxMessage,
  FinancialInboxResolution,
} from "./types";

export const FINANCIAL_INBOX_RESOLUTION_VERSION = 2;
export const FINANCIAL_INBOX_RESOLUTION_STATE_ID = `inbox-resolution-v${FINANCIAL_INBOX_RESOLUTION_VERSION}`;

export function financialInboxResolutionMigrationComplete(state: {
  complete?: unknown; version?: unknown;
} | null | undefined) {
  return state?.complete === true && state.version === FINANCIAL_INBOX_RESOLUTION_VERSION;
}

export function pendingFinancialInboxResolution(): FinancialInboxResolution {
  return {
    status: "pending",
    kind: null,
    targetType: null,
    targetId: null,
    installmentNumber: null,
    financialState: null,
    mode: null,
    confidence: null,
    reasons: [],
    resolvedAt: null,
    resolvedBy: null,
  };
}

export function discardedFinancialInboxResolution(params: {
  kind?: "non_financial";
  mode: "automatic" | "manual";
  at: string;
  by: string;
  reasons?: string[];
}): FinancialInboxResolution {
  return {
    ...pendingFinancialInboxResolution(),
    status: "discarded",
    kind: params.kind ?? "non_financial",
    mode: params.mode,
    confidence: params.mode === "automatic" ? "high" : null,
    reasons: params.reasons ?? [],
    resolvedAt: params.at,
    resolvedBy: params.by,
  };
}

export function isStrongAutomaticExpenseMatch(
  suggestion: FinancialInboxExpenseSuggestion | null | undefined,
) {
  return suggestion?.status === "suggested"
    && Boolean(suggestion.expenseId)
    && suggestion.automaticLinkEligible === true
    && suggestion.automaticLinkPolicyVersion === 1;
}

function bankStateForSuggestion(
  suggestion: FinancialInboxExpenseSuggestion,
): FinancialInboxBankState {
  if (suggestion.existingSettlement) return "reconciled";
  if (!suggestion.existingBankPayment) return "not_prepared";
  const state = `${suggestion.existingBankPayment.schedulingStatus ?? ""} ${suggestion.existingBankPayment.bankStatus ?? ""}`.toLowerCase();
  if (/aguardando[_\s-]*(?:aprova|autoriza)|awaiting[_\s-]*(?:approval|authorization)/.test(state)) {
    return "awaiting_bank_approval";
  }
  if (/ready[_\s-]*to[_\s-]*submit|pront[oa][ _-]*(?:para|pra)[ _-]*enviar/.test(state)) {
    return "ready_to_submit";
  }
  if (/submitting|enviando|submitted|enviado/.test(state)) return "submitted";
  if (/agendad|scheduled/.test(state)) return "scheduled";
  if (/process|execut|paid|pago|conclu/.test(state)) return "awaiting_statement";
  return "not_prepared";
}

export function financialStateForExpenseSuggestion(
  suggestion: FinancialInboxExpenseSuggestion,
): FinancialInboxFinancialState {
  if (suggestion.existingSettlement || suggestion.paymentState === "paid") return "reconciled";
  if (suggestion.existingBankPayment) {
    const bankState = bankStateForSuggestion(suggestion);
    return bankState === "scheduled" || bankState === "awaiting_statement"
      ? "scheduled"
      : "payment_prepared";
  }
  if (suggestion.paymentState === "scheduled") return "scheduled";
  return "open";
}

export function identifiedFinancialInboxResolution(params: {
  kind: "new_charge" | "reminder" | "duplicate";
  targetType: "expense" | "inbox_message";
  targetId: string;
  installmentNumber?: number | null;
  financialState: FinancialInboxFinancialState;
  mode: "automatic" | "manual";
  confidence?: "high" | "medium" | "low" | null;
  reasons?: string[];
  at: string;
  by: string;
}): FinancialInboxResolution {
  return {
    status: "identified",
    kind: params.kind,
    targetType: params.targetType,
    targetId: params.targetId,
    installmentNumber: params.installmentNumber ?? null,
    financialState: params.financialState,
    mode: params.mode,
    confidence: params.confidence ?? null,
    reasons: params.reasons ?? [],
    resolvedAt: params.at,
    resolvedBy: params.by,
  };
}

export function automaticReminderResolutionPatch(params: {
  suggestion: FinancialInboxExpenseSuggestion;
  at: string;
}) {
  if (!isStrongAutomaticExpenseMatch(params.suggestion) || !params.suggestion.expenseId) return null;
  const resolution = identifiedFinancialInboxResolution({
    kind: "reminder",
    targetType: "expense",
    targetId: params.suggestion.expenseId,
    installmentNumber: params.suggestion.installmentNumber,
    financialState: financialStateForExpenseSuggestion(params.suggestion),
    mode: "automatic",
    confidence: "high",
    reasons: [...(params.suggestion.automaticLinkReasons ?? params.suggestion.reasons)],
    at: params.at,
    by: "system:financial-inbox",
  });
  return {
    status: "identified" as const,
    bankState: bankStateForSuggestion(params.suggestion),
    resolution,
  };
}

export function resolutionForDisplay(
  message: Pick<
    FinancialInboxMessage,
    "status" | "resolution" | "linkedExpenseId" | "linkedProvisionId" | "existingExpenseSuggestion" | "reviewedAt" | "reviewedBy"
  > & Partial<Pick<FinancialInboxMessage, "creationSuggestion" | "archivedFromStatus">>,
): FinancialInboxResolution {
  if (message.resolution) {
    const normalized = {
      ...pendingFinancialInboxResolution(),
      ...message.resolution,
      reasons: Array.isArray(message.resolution.reasons) ? message.resolution.reasons : [],
    };
    if (["identified", "archived"].includes(normalized.status) && message.linkedExpenseId) {
      normalized.targetType ??= "expense";
      normalized.targetId ??= message.linkedExpenseId;
      normalized.installmentNumber ??= message.existingExpenseSuggestion?.installmentNumber ?? null;
      normalized.kind ??= message.linkedProvisionId || message.creationSuggestion?.status === "suggested"
        ? "new_charge"
        : "reminder";
    }
    if (normalized.status === "archived" && message.archivedFromStatus === "ignored") {
      normalized.kind ??= "non_financial";
    }
    if (normalized.status === "archived" && message.archivedFromStatus === "reconciled") {
      normalized.financialState ??= "reconciled";
    }
    if (message.status === "ignored" || (message.status === "archived" && message.archivedFromStatus === "ignored")) {
      normalized.mode ??= "manual";
      normalized.kind ??= "non_financial";
      if (!message.resolution.mode) normalized.reasons = [...normalized.reasons, "LEGACY_DISCARD_ORIGIN_UNKNOWN"];
    }
    return normalized;
  }
  const sourceStatus = message.status === "archived"
    ? message.archivedFromStatus ?? "archived"
    : message.status;
  if (sourceStatus === "ignored") {
    const resolution = discardedFinancialInboxResolution({
      mode: "manual",
      at: message.reviewedAt ?? "",
      by: message.reviewedBy ?? "legacy",
      reasons: ["LEGACY_DISCARD_ORIGIN_UNKNOWN"],
    });
    return message.status === "archived" ? { ...resolution, status: "archived" } : resolution;
  }
  if (message.linkedExpenseId || ["identified", "linked", "awaiting_authorization", "payment_failed", "scheduled", "awaiting_statement", "reconciled"].includes(sourceStatus)) {
    const suggestion = message.existingExpenseSuggestion;
    const financialState: FinancialInboxFinancialState = sourceStatus === "reconciled"
      ? "reconciled"
      : sourceStatus === "scheduled" || sourceStatus === "awaiting_statement"
        ? "scheduled"
        : sourceStatus === "awaiting_authorization" || sourceStatus === "payment_failed"
          ? "payment_prepared"
        : "open";
    return {
      status: message.status === "archived" ? "archived" : "identified",
      kind: message.linkedProvisionId || message.creationSuggestion?.status === "suggested"
        ? "new_charge"
        : "reminder",
      targetType: message.linkedExpenseId ? "expense" : null,
      targetId: message.linkedExpenseId ?? null,
      installmentNumber: suggestion?.installmentNumber ?? null,
      financialState,
      mode: "manual",
      confidence: null,
      reasons: suggestion?.reasons ?? [],
      resolvedAt: message.reviewedAt ?? null,
      resolvedBy: message.reviewedBy ?? null,
    };
  }
  if (message.status === "archived") {
    return { ...pendingFinancialInboxResolution(), status: "archived" };
  }
  return pendingFinancialInboxResolution();
}

export function restoredFinancialInboxResolution(
  message: FinancialInboxMessage,
  restoredStatus: "ignored" | "identified" | "reconciled",
): FinancialInboxResolution {
  const resolution = resolutionForDisplay(message);
  return {
    ...resolution,
    status: restoredStatus === "ignored" ? "discarded" : "identified",
    financialState: restoredStatus === "reconciled" ? "reconciled" : resolution.financialState,
  };
}
