import { type PermissionSet } from "@/types";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { getFeatureFlags } from "@/lib/feature-flags";

type ProjectPermissionLevel = "view" | "operate" | "manage";

function legacyCanUseForms(permissions: PermissionSet) {
  return (
    permissions.dp.checklists.view ||
    permissions.dp.checklists.operate ||
    permissions.dp.checklists.manageTemplates
  );
}

export function canAccessFormsModule(
  permissions: PermissionSet,
  isDefaultAdmin: boolean
) {
  return (
    isDefaultAdmin ||
    legacyCanUseForms(permissions) ||
    permissions.forms.global.view_all_projects ||
    permissions.forms.global.create_projects ||
    Object.values(permissions.forms.projects).some(
      (project) => project.view || project.operate || project.manage
    )
  );
}

export function assertFormPermission(
  permissions: PermissionSet,
  isDefaultAdmin: boolean,
  projectId: string | null,
  level: ProjectPermissionLevel
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

  if (level === "manage") {
    if (projectPermission?.manage || permissions.forms.global.create_projects) return;
    throw new Error("Sem permissão para gerenciar formulários.");
  }

  if (level === "operate") {
    if (projectPermission?.operate || projectPermission?.manage) return;
    throw new Error("Sem permissão para operar formulários.");
  }

  if (
    projectPermission?.view ||
    projectPermission?.operate ||
    projectPermission?.manage ||
    permissions.forms.global.view_all_projects
  ) {
    return;
  }

  throw new Error("Sem permissão para visualizar formulários.");
}

export async function loadFormsNavigation(params: {
  permissions: PermissionSet;
  isDefaultAdmin: boolean;
  workspaceId: string;
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
          "view"
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
