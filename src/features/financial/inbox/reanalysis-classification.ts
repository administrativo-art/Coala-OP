import type { FinancialInboxClassification, FinancialInboxStatus } from "./types";

const MUTABLE_ANALYSIS_STATUSES = new Set<FinancialInboxStatus>([
  "pending_review",
  "document_pending",
  "suggestion_available",
  "payment_failed",
]);

export function classificationForFinancialInboxReanalysis(input: {
  status: FinancialInboxStatus;
  current: FinancialInboxClassification;
  reparsed: FinancialInboxClassification;
}) {
  const base = MUTABLE_ANALYSIS_STATUSES.has(input.status) ? input.reparsed : input.current;
  const preserveIncompleteFields = input.status === "payment_failed";
  const billingIdentity = preserveIncompleteFields
    ? mergeBillingIdentity(input.current.billingIdentity, input.reparsed.billingIdentity)
    : base.billingIdentity;
  return {
    ...base,
    ...(preserveIncompleteFields ? {
      supplierName: base.supplierName || input.current.supplierName,
      competence: base.competence || input.current.competence,
      dueDate: base.dueDate || input.current.dueDate,
      amountCents: base.amountCents ?? input.current.amountCents,
      barcode: base.barcode || input.current.barcode,
      barcodeMasked: base.barcodeMasked || input.current.barcodeMasked,
      documentReferences: base.documentReferences?.length
        ? base.documentReferences
        : input.current.documentReferences,
      installmentNumber: base.installmentNumber ?? input.current.installmentNumber,
      installmentTotal: base.installmentTotal ?? input.current.installmentTotal,
      billingIdentity,
      fiscalIdentity: base.fiscalIdentity ?? input.current.fiscalIdentity,
    } : {}),
    links: input.current.links?.length ? input.current.links : input.reparsed.links,
  };
}

function mergeBillingIdentity(
  current: FinancialInboxClassification["billingIdentity"],
  reparsed: FinancialInboxClassification["billingIdentity"],
) {
  if (!current && !reparsed) return reparsed ?? current;
  if (!current) return reparsed;
  if (!reparsed) return current;
  return {
    ...current,
    ...reparsed,
    supplierTaxId: reparsed.supplierTaxId ?? current.supplierTaxId,
    customerAccount: reparsed.customerAccount ?? current.customerAccount,
    contractNumber: reparsed.contractNumber ?? current.contractNumber,
    serviceType: reparsed.serviceType ?? current.serviceType,
    serviceNumbers: reparsed.serviceNumbers?.length ? reparsed.serviceNumbers : current.serviceNumbers,
  };
}
