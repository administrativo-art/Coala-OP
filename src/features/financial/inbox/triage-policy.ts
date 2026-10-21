import { CnpjValidator } from "@/lib/company/cnpj-validator";
import type { FinancialInboxAttachment, FinancialInboxClassification } from "./types";

export type TrustedInboxSupplier = { senderDomain: string; supplierTaxId: string };
export type FinancialInboxSenderAuthentication = {
  status: "pass" | "fail" | "unknown";
  method: "dmarc" | null;
  authenticatedDomain: string | null;
};
export type FinancialInboxTriage = {
  kind: "noise" | "candidate" | "review";
  reasonCode: "MARKETING_WITHOUT_DOCUMENT" | "FINANCIAL_EVIDENCE" | "KNOWN_SUPPLIER" | "INSUFFICIENT_EVIDENCE";
  knownSupplier: boolean;
  policyVersion: 1;
};

const SUPPORTED_DOCUMENT = /\.(?:pdf|xml|csv|txt|png|jpe?g|webp|gif)$/i;

export function validatedTrustedInboxSuppliers(value: unknown): TrustedInboxSupplier[] {
  if (!Array.isArray(value) || value.length > 100) return [];
  const result: TrustedInboxSupplier[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const raw = entry as Record<string, unknown>;
    const senderDomain = typeof raw.senderDomain === "string" ? raw.senderDomain.trim().toLowerCase() : "";
    const taxId = typeof raw.supplierTaxId === "string" ? CnpjValidator.validate(raw.supplierTaxId) : null;
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(senderDomain)
      || !taxId?.valid) return [];
    if (result.some((supplier) => supplier.senderDomain === senderDomain && supplier.supplierTaxId === taxId.clean)) return [];
    result.push({ senderDomain, supplierTaxId: taxId.clean });
  }
  return result;
}

export function hasSupportedInboxDocument(attachments: FinancialInboxAttachment[]) {
  return attachments.some((attachment) => attachment.archiveStatus === "stored"
    && SUPPORTED_DOCUMENT.test(attachment.filename));
}

export function financialInboxSenderAuthentication(
  headers: Record<string, string> | null | undefined,
  senderDomain: string | null,
): FinancialInboxSenderAuthentication {
  const authenticationHeaders = Object.entries(headers ?? {})
    .filter(([name]) => name.toLowerCase() === "authentication-results")
    .map(([, value]) => value);
  if (authenticationHeaders.length === 0 || !senderDomain) {
    return { status: "unknown", method: null, authenticatedDomain: null };
  }
  if (authenticationHeaders.length !== 1) {
    return { status: "fail", method: "dmarc", authenticatedDomain: null };
  }
  const authenticationResults = authenticationHeaders[0] ?? "";
  const dmarcEvaluations = authenticationResults.split(";").filter((segment) => /\bdmarc=/i.test(segment));
  if (dmarcEvaluations.length !== 1 || (dmarcEvaluations[0]?.match(/\bdmarc=/gi)?.length ?? 0) !== 1) {
    return { status: "fail", method: "dmarc", authenticatedDomain: null };
  }
  const evaluation = dmarcEvaluations[0] ?? "";
  const headerFromMatches = [...evaluation.matchAll(/\bheader\.from=([^\s,;]+)/gi)];
  if (headerFromMatches.length !== 1) {
    return { status: "fail", method: "dmarc", authenticatedDomain: null };
  }
  const headerFrom = headerFromMatches[0]?.[1]?.replace(/[<>]/g, "").toLowerCase() ?? null;
  if (/\bdmarc=pass\b/i.test(evaluation) && headerFrom === senderDomain.toLowerCase()) {
    return { status: "pass", method: "dmarc", authenticatedDomain: headerFrom };
  }
  return { status: "fail", method: "dmarc", authenticatedDomain: headerFrom };
}

export function shouldAttemptFinancialInboxDocumentAi(params: {
  initial: FinancialInboxTriage;
  afterDeterministicExtraction: FinancialInboxTriage;
  attachments: FinancialInboxAttachment[];
  authenticatedTrustedDomain?: boolean;
}) {
  return params.initial.kind !== "noise" && params.afterDeterministicExtraction.kind !== "noise"
    && (params.initial.kind === "candidate" || params.afterDeterministicExtraction.kind === "candidate"
      || params.authenticatedTrustedDomain === true)
    && hasSupportedInboxDocument(params.attachments)
    && params.attachments.some((attachment) => attachment.archiveStatus === "stored"
      && attachment.extractionStatus !== "unsupported" && attachment.extractionStatus !== "failed");
}

export function triageFinancialInboxMessage(params: {
  classification: FinancialInboxClassification;
  senderDomain: string | null;
  attachments: FinancialInboxAttachment[];
  trustedSuppliers?: TrustedInboxSupplier[];
  senderAuthenticated?: boolean;
}): FinancialInboxTriage {
  const taxId = params.classification.billingIdentity?.supplierTaxId;
  const knownSupplier = Boolean(params.senderAuthenticated === true && taxId && params.senderDomain && params.trustedSuppliers?.some((supplier) =>
    supplier.senderDomain === params.senderDomain?.toLowerCase() && supplier.supplierTaxId === taxId));
  const document = hasSupportedInboxDocument(params.attachments);
  if (params.classification.marketingLikely && !document) {
    return { kind: "noise", reasonCode: "MARKETING_WITHOUT_DOCUMENT", knownSupplier: false, policyVersion: 1 };
  }
  if (knownSupplier) return { kind: "candidate", reasonCode: "KNOWN_SUPPLIER", knownSupplier, policyVersion: 1 };
  if (params.classification.financeLikely || params.classification.barcode) {
    return { kind: "candidate", reasonCode: "FINANCIAL_EVIDENCE", knownSupplier: false, policyVersion: 1 };
  }
  return { kind: "review", reasonCode: "INSUFFICIENT_EVIDENCE", knownSupplier: false, policyVersion: 1 };
}
