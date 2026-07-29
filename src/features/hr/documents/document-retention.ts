export const RETENTION_ANCHOR_TYPES = [
  "generation_date",
  "employment_end",
  "treatment_end",
  "consent_revocation",
  "document_expiration",
  "manual",
] as const;

export type RetentionAnchorType = (typeof RETENTION_ANCHOR_TYPES)[number];

export type DocumentRetentionPolicy = {
  policyId: string;
  policyVersion: number;
  anchorType: RetentionAnchorType;
  durationYears: number | null;
  legalBasisReference: string;
  status: "pending_legal" | "approved";
};

const POLICIES: Record<string, DocumentRetentionPolicy> = {
  employment_plus_5y: {
    policyId: "employment_plus_5y",
    policyVersion: 1,
    anchorType: "employment_end",
    durationYears: 5,
    legalBasisReference: "Aguardando homologação da tabela jurídica trabalhista.",
    status: "pending_legal",
  },
  consent_until_revoked_plus_5y: {
    policyId: "consent_until_revoked_plus_5y",
    policyVersion: 1,
    anchorType: "consent_revocation",
    durationYears: 5,
    legalBasisReference: "Aguardando homologação da política de prova do consentimento.",
    status: "pending_legal",
  },
  institutional_active_version: {
    policyId: "institutional_active_version",
    policyVersion: 1,
    anchorType: "document_expiration",
    durationYears: null,
    legalBasisReference: "Vigência controlada pela versão institucional.",
    status: "pending_legal",
  },
  fiscal_generation_date_pending: {
    policyId: "fiscal_generation_date_pending",
    policyVersion: 1,
    anchorType: "generation_date",
    durationYears: null,
    legalBasisReference: "Prazo fiscal/contábil pendente de validação.",
    status: "pending_legal",
  },
};

export function documentRetentionPolicy(policyId: unknown) {
  const normalized = String(policyId ?? "employment_plus_5y");
  return POLICIES[normalized] ?? POLICIES.employment_plus_5y;
}

export function calculateRetentionUntil(params: {
  policy: DocumentRetentionPolicy;
  anchorAt: string | null;
}) {
  if (!params.anchorAt || params.policy.durationYears === null) return null;
  const anchor = new Date(params.anchorAt);
  if (Number.isNaN(anchor.getTime())) return null;
  anchor.setUTCFullYear(anchor.getUTCFullYear() + params.policy.durationYears);
  return anchor.toISOString();
}

export function retentionFields(params: {
  policyId: unknown;
  generatedAt: string;
  anchorAt?: string | null;
}) {
  const policy = documentRetentionPolicy(params.policyId);
  const anchorAt = policy.anchorType === "generation_date"
    ? params.generatedAt
    : params.anchorAt ?? null;
  return {
    retentionPolicyId: policy.policyId,
    retentionPolicyVersion: policy.policyVersion,
    retentionPolicyStatus: policy.status,
    retentionAnchorType: policy.anchorType,
    retentionAnchorAt: anchorAt,
    retentionUntil: calculateRetentionUntil({ policy, anchorAt }),
    retentionCalculatedAt: anchorAt ? params.generatedAt : null,
  };
}

export function retentionNeedsEmploymentEndReconciliation(params: {
  employmentEndedAt: string | null;
  retentionAnchorType: unknown;
  retentionUntil: unknown;
}) {
  return Boolean(
    params.employmentEndedAt
    && params.retentionAnchorType === "employment_end"
    && !params.retentionUntil,
  );
}
