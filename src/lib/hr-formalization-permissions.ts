import type { PermissionSet } from "@/types";

export type FormalizationAction =
  | "view"
  | "onboarding.manage"
  | "aso.view"
  | "aso.manage"
  | "accountant.view"
  | "accountant.manage"
  | "documents.view"
  | "documents.generate"
  | "documents.review"
  | "companyDocuments.view"
  | "companyDocuments.manage"
  | "templates.view"
  | "templates.manage"
  | "templates.publish"
  | "signatures.view"
  | "signatures.send"
  | "consents.view"
  | "consents.manage"
  | "sensitiveData.view";

type PartialPermissions = Partial<PermissionSet> & {
  hr?: Partial<PermissionSet["hr"]> & {
    formalization?: Partial<PermissionSet["hr"]["formalization"]>;
  };
};

function legacyCanView(permissions: PermissionSet) {
  return Boolean(
    permissions.recruitment?.view ||
    permissions.recruitment?.pipeline?.view ||
    permissions.dp?.view ||
    permissions.dp?.collaborators?.view ||
    permissions.dp?.collaborators?.edit ||
    permissions.settings?.manageUsers
  );
}

function legacyCanManage(permissions: PermissionSet) {
  return Boolean(
    permissions.recruitment?.manage ||
    permissions.recruitment?.pipeline?.manage ||
    permissions.dp?.collaborators?.edit ||
    permissions.settings?.manageUsers
  );
}

/**
 * Compatibilidade temporária: somente perfis que ainda não possuem o bloco
 * formalization herdam o acesso antigo. Assim que o perfil for salvo pelo
 * editor, as novas permissões explícitas passam a ser a única fonte de verdade.
 */
export function applyLegacyFormalizationFallbacks(
  permissions: PermissionSet,
  storedPermissions?: PartialPermissions | null,
) {
  if (storedPermissions?.hr?.formalization !== undefined) return permissions;
  const canView = legacyCanView(permissions);
  const canManage = legacyCanManage(permissions);
  const formalization = permissions.hr.formalization;
  // O acesso à integração é operacional: quem entra no fluxo precisa conseguir
  // concluir suas etapas. No legado, só perfis que já podiam gerenciar recebem
  // esse acesso completo, evitando elevar um perfil antigo somente de leitura.
  formalization.view = canManage;
  formalization.onboarding.manage = canManage;
  formalization.aso.view = canManage;
  formalization.aso.manage = canManage;
  formalization.accountant.view = canManage;
  formalization.accountant.manage = canManage;
  formalization.documents.view = canManage;
  formalization.documents.generate = canManage;
  formalization.documents.review = canManage;
  formalization.companyDocuments.view = canView;
  formalization.companyDocuments.manage = canManage;
  formalization.templates.view = canView;
  formalization.templates.manage = canManage;
  formalization.templates.publish = canManage;
  formalization.signatures.view = canManage;
  formalization.signatures.send = canManage;
  formalization.consents.view = canManage;
  formalization.consents.manage = canManage;
  formalization.sensitiveData.view = permissions.settings?.manageUsers === true;
  return permissions;
}

export function hasFormalizationPermission(
  permissions: PermissionSet,
  action: FormalizationAction,
  isDefaultAdmin = false,
) {
  if (isDefaultAdmin) return true;
  const formalization = permissions.hr?.formalization;
  if (!formalization) return false;
  const fullWorkflowAccess = formalization.view === true;
  switch (action) {
    case "view": return formalization.view;
    case "onboarding.manage": return fullWorkflowAccess || formalization.onboarding.manage;
    case "aso.view": return fullWorkflowAccess || formalization.aso.view || formalization.aso.manage;
    case "aso.manage": return fullWorkflowAccess || formalization.aso.manage;
    case "accountant.view": return fullWorkflowAccess || formalization.accountant.view || formalization.accountant.manage;
    case "accountant.manage": return fullWorkflowAccess || formalization.accountant.manage;
    case "documents.view": return fullWorkflowAccess || formalization.documents.view || formalization.documents.generate || formalization.documents.review;
    case "documents.generate": return fullWorkflowAccess || formalization.documents.generate;
    case "documents.review": return fullWorkflowAccess || formalization.documents.review;
    case "companyDocuments.view": return formalization.companyDocuments.view || formalization.companyDocuments.manage;
    case "companyDocuments.manage": return formalization.companyDocuments.manage;
    case "templates.view": return formalization.templates.view || formalization.templates.manage || formalization.templates.publish;
    case "templates.manage": return formalization.templates.manage || formalization.templates.publish;
    case "templates.publish": return formalization.templates.publish;
    case "signatures.view": return fullWorkflowAccess || formalization.signatures.view || formalization.signatures.send;
    case "signatures.send": return fullWorkflowAccess || formalization.signatures.send;
    case "consents.view": return fullWorkflowAccess || formalization.consents.view || formalization.consents.manage;
    case "consents.manage": return formalization.consents.manage;
    case "sensitiveData.view": return fullWorkflowAccess || formalization.sensitiveData.view;
  }
}
