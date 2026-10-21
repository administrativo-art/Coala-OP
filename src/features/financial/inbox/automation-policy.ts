import type {
  FinancialInboxAutomationSettings,
  FinancialInboxBankAutomationPolicy,
  FinancialInboxExpenseSuggestion,
} from "./types";
import { validatedTrustedInboxSuppliers } from "./triage-policy";

export function shouldAutomaticallyIdentifyInboxCharge(params: {
  settings: FinancialInboxAutomationSettings;
  suggestion: FinancialInboxExpenseSuggestion | null | undefined;
}) {
  return params.settings.mode === "document_identity"
    && params.settings.policyVersion === 1
    && params.suggestion?.automaticLinkEligible === true
    && params.suggestion.automaticLinkPolicyVersion === 1;
}

// Contract only: no caller may submit to Inter from this policy until a separate
// business decision supplies supplier identities, limits, period and approval.
export function disabledInboxBankAutomationPolicy(): FinancialInboxBankAutomationPolicy {
  return {
    enabled: false, suppliers: [], maxPerPaymentCents: null, maxPerPeriodCents: null,
    validFrom: null, validUntil: null, approvedBy: null,
  };
}

export type InboxBankDuplicateEvidence = {
  localRequests: "clear" | "duplicate" | "unknown";
  expenseAndObligation: "clear" | "duplicate" | "unknown";
  interSchedulesAndPayments: "clear" | "duplicate" | "unknown";
  importedStatement: "clear" | "duplicate" | "unknown";
  documentFingerprint: "clear" | "duplicate" | "unknown";
  sourceIdentity: "clear" | "duplicate" | "unknown";
  exclusiveLockHeld: boolean;
};

export function inboxBankAutomationGuard(input: {
  policy: unknown;
  senderDomain: string | null;
  supplierTaxId: string | null;
  amountCents: number | null;
  at: string;
  linkedExpenseId: string | null;
  duplicateEvidence?: InboxBankDuplicateEvidence | null;
  ambiguous: boolean;
}): { allowed: false; reasonCode: string } {
  const policy = input.policy && typeof input.policy === "object" ? input.policy as Record<string, unknown> : {};
  if (policy.enabled !== true) return { allowed: false, reasonCode: "BANK_AUTOMATION_DISABLED" };
  const suppliers = validatedTrustedInboxSuppliers(policy.suppliers);
  if (!suppliers.length || !input.senderDomain || !input.supplierTaxId || !suppliers.some((supplier) =>
    supplier.senderDomain === input.senderDomain && supplier.supplierTaxId === input.supplierTaxId)) {
    return { allowed: false, reasonCode: "SUPPLIER_NOT_AUTHORIZED" };
  }
  if (typeof policy.maxPerPaymentCents !== "number" || typeof policy.maxPerPeriodCents !== "number"
    || !Number.isSafeInteger(policy.maxPerPaymentCents) || !Number.isSafeInteger(policy.maxPerPeriodCents)
    || Number(policy.maxPerPaymentCents) <= 0 || Number(policy.maxPerPeriodCents) <= 0
    || !Number.isSafeInteger(input.amountCents) || Number(input.amountCents) <= 0
    || Number(input.amountCents) > Number(policy.maxPerPaymentCents)) {
    return { allowed: false, reasonCode: "BANK_LIMIT_INVALID" };
  }
  if (typeof policy.validFrom !== "string" || typeof policy.validUntil !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(policy.validFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(policy.validUntil)
    || input.at < policy.validFrom || input.at > policy.validUntil
    || typeof policy.approvedBy !== "string" || !policy.approvedBy.trim()) {
    return { allowed: false, reasonCode: "BANK_POLICY_NOT_EFFECTIVE" };
  }
  if (!input.linkedExpenseId || input.ambiguous) return { allowed: false, reasonCode: "CHARGE_REQUIRES_REVIEW" };
  const evidence = input.duplicateEvidence;
  if (!evidence || !evidence.exclusiveLockHeld) return { allowed: false, reasonCode: "DUPLICATE_LOCK_UNAVAILABLE" };
  const checks = [
    evidence.localRequests, evidence.expenseAndObligation, evidence.interSchedulesAndPayments,
    evidence.importedStatement, evidence.documentFingerprint, evidence.sourceIdentity,
  ];
  if (checks.includes("duplicate")) return { allowed: false, reasonCode: "DUPLICATE_FOUND" };
  if (checks.some((check) => check !== "clear")) return { allowed: false, reasonCode: "DUPLICATE_EVIDENCE_INCOMPLETE" };
  // The execution path is deliberately absent. Per-period budget reservation,
  // bank authorization and final Inter approval need separate implementation.
  return { allowed: false, reasonCode: "BANK_EXECUTION_NOT_IMPLEMENTED" };
}
