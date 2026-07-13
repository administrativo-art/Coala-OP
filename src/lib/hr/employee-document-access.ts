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
  DISCIPLINARY_WARNING: "HR_RESTRICTED",
  RESIGNATION_REQUEST: "HR_RESTRICTED",
  TERMINATION_NOTICE: "HR_RESTRICTED",
  TERMINATION_TERM: "HR_RESTRICTED",
  TERMINATION_PAYMENT: "HR_FINANCE",
  UNKNOWN_DOCUMENT: "HR_RESTRICTED",
};

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
  doc: { documentTypeCode?: string | null; accessLevel?: string | null },
  subject: DocumentAccessSubject,
): { allowed: boolean; policy: AccessPolicyId } {
  const policy = resolveDocumentAccessPolicy(doc);
  return { allowed: canAccessUnderPolicy(policy, subject), policy };
}
