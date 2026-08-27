/**
 * Política de acesso determinística de documentos de RH.
 *
 * Regra central: o nível de sigilo NÃO é escolhido no upload nem confiável a
 * partir do cliente. Ele é derivado do TIPO documental (fonte oficial) e, para
 * documentos legados sem código, do `accessLevel` armazenado. A autorização é
 * calculada no backend a partir do perfil/permissões do usuário autenticado.
 *
 * Este módulo é puro (sem Firestore/Next) para ser testável isoladamente.
 */

export type AccessPolicyId =
  | "HR_OPERATIONAL"
  | "HR_RESTRICTED"
  | "HR_FINANCE"
  | "OCCUPATIONAL_HEALTH"
  | "EMPLOYEE_VISIBLE"
  | "ADMIN_ONLY";

import {
  DEFAULT_PROFILE_ACCESS_MATRIX,
  resolveFieldAccessPermission,
  type DocumentVisibilityConfig,
  type FieldVisibilityContext,
  type NormalizedFieldVisibility,
  type ProfileAccessMatrix,
  type RhRole,
} from "@/types/rh";

/** Política oficial por código de tipo documental (autoritativa). */
export const DOCUMENT_TYPE_ACCESS_POLICY: Record<string, AccessPolicyId> = {
  PERSONAL_ID: "HR_RESTRICTED",
  ADDRESS_PROOF: "HR_OPERATIONAL",
  EMPLOYEE_REGISTRATION: "HR_RESTRICTED",
  EMPLOYMENT_CONTRACT: "HR_RESTRICTED",
  PROBATION_CONTRACT: "HR_RESTRICTED",
  PROBATION_EXTENSION: "HR_RESTRICTED",
  PAYSLIP: "HR_FINANCE",
  TRANSPORT_REQUEST: "HR_OPERATIONAL",
  ASO_ADMISSION: "OCCUPATIONAL_HEALTH",
  ASO_PERIODIC: "OCCUPATIONAL_HEALTH",
  VACATION_NOTICE: "HR_OPERATIONAL",
  VACATION_RECEIPT: "HR_FINANCE",
  VACATION_PAYMENT: "HR_FINANCE",
  MEDICAL_CERTIFICATE: "OCCUPATIONAL_HEALTH",
  UNIFORM_DELIVERY: "HR_OPERATIONAL",
  UNIFORM_EXCHANGE: "HR_OPERATIONAL",
  UNIFORM_RETURN: "HR_OPERATIONAL",
  DISCIPLINARY_WARNING: "HR_RESTRICTED",
  RESIGNATION_REQUEST: "HR_RESTRICTED",
  TERMINATION_NOTICE: "HR_RESTRICTED",
  TERMINATION_TERM: "HR_RESTRICTED",
  TERMINATION_PAYMENT: "HR_FINANCE",
  UNKNOWN_DOCUMENT: "HR_RESTRICTED",
};

export const DEFAULT_DOCUMENT_VISIBILITY_CONFIG: DocumentVisibilityConfig = {
  version: "coala-rh-documents-v1",
  categories: {
    personal: "restricted_total",
    admission: "restricted_total",
    contracts: "restricted_total",
    work_schedule: "restricted_partial",
    remuneration: "restricted_partial",
    benefits: "restricted_partial",
    occupational_health: "restricted_total",
    vacations: "restricted_partial",
    leaves: "restricted_total",
    uniforms: "restricted_partial",
    training: "restricted_partial",
    warnings: "restricted_total",
    termination: "restricted_total",
    pending_classification: "restricted_total",
  },
  document_types: {
    ADMIN_ONLY: "confidential",
  },
};

export function normalizeDocumentVisibilityConfig(value?: DocumentVisibilityConfig | null): DocumentVisibilityConfig {
  const normalize = (entries: Record<string, unknown> | undefined) => Object.fromEntries(
    Object.entries(entries ?? {}).filter(([, visibility]) =>
      visibility === "public" || visibility === "restricted_partial" || visibility === "restricted_total" || visibility === "confidential"
    ),
  ) as Record<string, NormalizedFieldVisibility>;
  return {
    version: value?.version || DEFAULT_DOCUMENT_VISIBILITY_CONFIG.version,
    categories: { ...DEFAULT_DOCUMENT_VISIBILITY_CONFIG.categories, ...normalize(value?.categories) },
    document_types: { ...DEFAULT_DOCUMENT_VISIBILITY_CONFIG.document_types, ...normalize(value?.document_types) },
  };
}

export function resolveDocumentVisibility(
  doc: { documentTypeCode?: string | null; category?: string | null },
  config?: DocumentVisibilityConfig | null,
): NormalizedFieldVisibility {
  const normalized = normalizeDocumentVisibilityConfig(config);
  if (doc.documentTypeCode && normalized.document_types?.[doc.documentTypeCode]) {
    return normalized.document_types[doc.documentTypeCode];
  }
  if (doc.category && normalized.categories?.[doc.category]) return normalized.categories[doc.category];
  return "restricted_total";
}

/** Fallback seguro para documentos legados que só têm o `accessLevel` escalar. */
const LEGACY_LEVEL_TO_POLICY: Record<string, AccessPolicyId> = {
  unrestricted: "HR_OPERATIONAL",
  partial: "HR_OPERATIONAL",
  restricted: "HR_RESTRICTED",
  confidential: "HR_RESTRICTED",
};

/**
 * Resolve a política oficial de um documento.
 * Prioriza o código do tipo; cai para o nível legado; default seguro = RESTRITO.
 */
export function resolveDocumentAccessPolicy(input: {
  documentTypeCode?: string | null;
  accessLevel?: string | null;
}): AccessPolicyId {
  const byType = input.documentTypeCode ? DOCUMENT_TYPE_ACCESS_POLICY[input.documentTypeCode] : undefined;
  if (byType) return byType;
  const byLevel = input.accessLevel ? LEGACY_LEVEL_TO_POLICY[input.accessLevel] : undefined;
  return byLevel ?? "HR_RESTRICTED";
}

/** Perfil de autorização do usuário autenticado (derivado de PermissionSet). */
export interface DocumentAccessSubject {
  isDefaultAdmin: boolean;
  canManageUsers: boolean;
  rhRole?: "employee" | "manager" | "admin";
  canViewSalary: boolean;
  collaboratorsView: boolean;
  collaboratorsEdit: boolean;
  ownProfileOnly?: boolean;
  /** O usuário autenticado é o próprio titular do documento. */
  isOwner: boolean;
  profileRole?: RhRole;
  visibilityContext?: FieldVisibilityContext;
  accessMatrix?: ProfileAccessMatrix;
}

function isElevatedHr(s: DocumentAccessSubject) {
  if (s.ownProfileOnly && !s.isOwner && !s.isDefaultAdmin && !s.canManageUsers) return false;
  return s.isDefaultAdmin || s.canManageUsers || s.rhRole === "admin" || s.rhRole === "manager" || s.collaboratorsEdit;
}

function isBasicHr(s: DocumentAccessSubject) {
  if (s.ownProfileOnly && !s.isOwner && !s.isDefaultAdmin && !s.canManageUsers) return false;
  return isElevatedHr(s) || s.collaboratorsView;
}

/** Decide se o sujeito pode acessar um documento sob a política informada. */
export function canAccessUnderPolicy(policy: AccessPolicyId, s: DocumentAccessSubject): boolean {
  switch (policy) {
    case "ADMIN_ONLY":
      return s.isDefaultAdmin || s.canManageUsers;
    case "HR_FINANCE":
      return s.isDefaultAdmin || s.canManageUsers || s.canViewSalary || s.isOwner;
    case "OCCUPATIONAL_HEALTH":
      return isElevatedHr(s); // dados de saúde: só RH elevado (sem titular, sem view básico)
    case "HR_RESTRICTED":
      return isElevatedHr(s); // médico/disciplinar/rescisório: sem view básico e sem titular
    case "HR_OPERATIONAL":
      return isBasicHr(s) || s.isOwner;
    case "EMPLOYEE_VISIBLE":
      return isBasicHr(s) || s.isOwner;
    default:
      return false;
  }
}

/** Constrói o sujeito a partir de um PermissionSet (tipagem estrutural, sem deps). */
export function subjectFromPermissions(
  permissions: {
    settings?: { manageUsers?: boolean };
    dp?: {
      rh_role?: "employee" | "manager" | "admin";
      rh?: { can_view_salary?: boolean };
      collaborators?: { view?: boolean; edit?: boolean; ownProfileOnly?: boolean };
    };
  },
  opts: { isDefaultAdmin: boolean; isOwner: boolean },
): DocumentAccessSubject {
  return {
    isDefaultAdmin: opts.isDefaultAdmin,
    canManageUsers: permissions.settings?.manageUsers === true,
    rhRole: permissions.dp?.rh_role,
    canViewSalary: permissions.dp?.rh?.can_view_salary === true,
    collaboratorsView: permissions.dp?.collaborators?.view === true,
    collaboratorsEdit: permissions.dp?.collaborators?.edit === true,
    ownProfileOnly: permissions.dp?.collaborators?.ownProfileOnly === true,
    isOwner: opts.isOwner,
  };
}

/** Atalho: resolve política do documento e decide o acesso em um passo. */
export function canAccessDocument(
  doc: { documentTypeCode?: string | null; category?: string | null; accessLevel?: string | null },
  subject: DocumentAccessSubject,
  visibilityConfig?: DocumentVisibilityConfig | null,
): { allowed: boolean; policy: AccessPolicyId } {
  const policy = resolveDocumentAccessPolicy(doc);
  if (subject.accessMatrix) {
    const visibility = resolveDocumentVisibility(doc, visibilityConfig);
    const role = subject.profileRole ?? (subject.isDefaultAdmin || subject.canManageUsers ? "admin" : subject.collaboratorsEdit ? "manager" : "employee");
    const permission = resolveFieldAccessPermission(
      visibility,
      role,
      {
        ...subject.visibilityContext,
        isOwner: subject.isOwner,
        canViewConfidential: role === "admin",
      },
      undefined,
      subject.accessMatrix ?? DEFAULT_PROFILE_ACCESS_MATRIX,
    );
    return { allowed: permission !== "hidden", policy };
  }
  return { allowed: canAccessUnderPolicy(policy, subject), policy };
}
