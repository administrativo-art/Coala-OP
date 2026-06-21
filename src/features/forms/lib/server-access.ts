import { type PermissionSet } from "@/types";
import { type FormExecution, type FormProject } from "@/types/forms";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { getFeatureFlags } from "@/lib/feature-flags";

type ProjectPermissionLevel = "view" | "operate" | "manage";

export const FORM_UNIT_POOL_ASSIGNEE_ID = "__unit_pool__";

function legacyCanUseForms(permissions: PermissionSet) {
  return (
    permissions.dp.checklists.view ||
    permissions.dp.checklists.operate ||
    permissions.dp.checklists.manageTemplates
  );
}

function projectMemberPermission(params: {
  project?: Pick<FormProject, "members"> | null;
  userId?: string | null;
}) {
  const member = params.project?.members?.find((entry) => entry.user_id === params.userId);
  if (!member) return null;
  const custom = member.custom_permissions ?? {};

  return {
    view: custom.view ?? (member.role === "viewer" || member.role === "operator" || member.role === "manager"),
    operate: custom.operate ?? (member.role === "operator" || member.role === "manager"),
    manage: custom.manage ?? member.role === "manager",
  };
}

export function canAccessFormsModule(
  permissions: PermissionSet,
  isDefaultAdmin: boolean,
  context?: {
    userId?: string | null;
    projects?: Array<Pick<FormProject, "members">>;
  }
) {
  return (
    isDefaultAdmin ||
    legacyCanUseForms(permissions) ||
    permissions.forms.global.view_all_projects ||
    permissions.forms.global.create_projects ||
    Object.values(permissions.forms.projects).some(
      (project) => project.view || project.operate || project.manage
    ) ||
    (context?.projects ?? []).some((project) =>
      projectMemberPermission({ project, userId: context?.userId })?.view === true
    )
  );
}

export function assertFormPermission(
  permissions: PermissionSet,
  isDefaultAdmin: boolean,
  projectId: string | null,
  level: ProjectPermissionLevel,
  context?: {
    userId?: string | null;
    project?: Pick<FormProject, "members"> | null;
  }
) {
  if (isDefaultAdmin) return;

  if (legacyCanUseForms(permissions)) {
    if (level === "manage" && !permissions.dp.checklists.manageTemplates) {
      throw new Error("Sem permissão para gerenciar formulários.");
    }
    if (level === "operate" && !permissions.dp.checklists.operate) {
      throw new Error("Sem permissão para operar formulários.");
    }
    return;
  }

  if (!projectId && level === "view" && permissions.forms.global.view_all_projects) {
    return;
  }

  const projectPermission = projectId
    ? permissions.forms.projects[projectId]
    : null;
  const memberPermission = projectMemberPermission(context ?? {});

  if (level === "manage") {
    if (projectPermission?.manage || memberPermission?.manage || permissions.forms.global.create_projects) return;
    throw new Error("Sem permissão para gerenciar formulários.");
  }

  if (level === "operate") {
    if (projectPermission?.operate || projectPermission?.manage || memberPermission?.operate || memberPermission?.manage) return;
    throw new Error("Sem permissão para operar formulários.");
  }

  if (
    projectPermission?.view ||
    projectPermission?.operate ||
    projectPermission?.manage ||
    memberPermission?.view ||
    memberPermission?.operate ||
    memberPermission?.manage ||
    permissions.forms.global.view_all_projects
  ) {
    return;
  }

  throw new Error("Sem permissão para visualizar formulários.");
}

export function getUserFormUnitIds(userDoc: Record<string, unknown>) {
  const unitIds = Array.isArray(userDoc.unitIds) ? userDoc.unitIds : [];
  const assignedKioskIds = Array.isArray(userDoc.assignedKioskIds) ? userDoc.assignedKioskIds : [];
  return Array.from(
    new Set(
      [...unitIds, ...assignedKioskIds]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

export function isExecutionAvailableToUserUnit(params: {
  execution: Pick<FormExecution, "assigned_user_id" | "unit_id" | "collaborator_user_ids">;
  userId: string;
  userDoc: Record<string, unknown>;
}) {
  if (params.execution.assigned_user_id === params.userId) return true;
  if (params.execution.collaborator_user_ids?.includes(params.userId)) return true;

  const isUnitPool =
    !params.execution.assigned_user_id ||
    params.execution.assigned_user_id === FORM_UNIT_POOL_ASSIGNEE_ID ||
    params.execution.assigned_user_id === "unit_pool";
  if (!isUnitPool) return false;

  return getUserFormUnitIds(params.userDoc).includes(params.execution.unit_id);
}

export function assertFormExecutionAccess(params: {
  permissions: PermissionSet;
  isDefaultAdmin: boolean;
  userId: string;
  userDoc: Record<string, unknown>;
  workspaceId: string;
  execution: FormExecution;
  level: ProjectPermissionLevel;
}) {
  if (params.execution.workspace_id !== params.workspaceId) {
    throw new Error("Execução não encontrada neste workspace.");
  }

  if (params.isDefaultAdmin) return;

  if (
    params.level !== "manage" &&
    isExecutionAvailableToUserUnit({
      execution: params.execution,
      userId: params.userId,
      userDoc: params.userDoc,
    })
  ) {
    return;
  }

  assertFormPermission(
    params.permissions,
    params.isDefaultAdmin,
    params.execution.form_project_id,
    params.level
  );
}

export async function loadFormsNavigation(params: {
  permissions: PermissionSet;
  isDefaultAdmin: boolean;
  workspaceId: string;
  userId?: string;
}) {
  const flags = await getFeatureFlags(params.workspaceId);
  if (flags.kill_forms_module) {
    throw new Error("O módulo de formulários está temporariamente desativado.");
  }

  if (!flags.forms_navigation_api_enabled && !flags.forms_new_engine_enabled) {
    throw new Error("A navegação de formulários ainda não foi liberada.");
  }

  if (!canAccessFormsModule(params.permissions, params.isDefaultAdmin)) {
    throw new Error("Sem permissão para acessar formulários.");
  }

  const projectsSnap = await checklistDbAdmin
    .collection("form_projects")
    .where("workspace_id", "==", params.workspaceId)
    .where("is_active", "==", true)
    .get();

  const projects = projectsSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) }))
    .filter((project) => {
      try {
        assertFormPermission(
          params.permissions,
          params.isDefaultAdmin,
          project.id,
          "view",
          { userId: params.userId, project: project as unknown as FormProject }
        );
        return true;
      } catch {
        return false;
      }
    });

  return {
    flags,
    summary: {
      total_projects: projects.length,
      can_create_projects:
        params.isDefaultAdmin || params.permissions.forms.global.create_projects,
    },
    projects,
  };
}
