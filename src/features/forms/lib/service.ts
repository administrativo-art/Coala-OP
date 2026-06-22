import type { PermissionSet } from "@/types";

import {
  assertFormPermission,
  canAccessFormsModule,
} from "@/features/forms/lib/server-access";
import {
  getFormExecutionById,
  getFormTemplateById,
  listFormExecutions,
  listFormProjects,
  listFormTemplates,
  listFormTypes,
} from "@/features/forms/lib/server";
import { getFeatureFlags } from "@/lib/feature-flags";

export async function buildFormsBootstrap(params: {
  workspaceId: string;
  permissions: PermissionSet;
  isDefaultAdmin: boolean;
  userId?: string;
}) {
  const flags = await getFeatureFlags(params.workspaceId);
  if (flags.kill_forms_module) {
    throw new Error("O módulo de formulários está temporariamente desativado.");
  }

  if (!flags.forms_new_engine_enabled && !flags.forms_navigation_api_enabled) {
    throw new Error("O novo motor de formulários ainda não foi liberado.");
  }

  const [projects, templates, executions, types] = await Promise.all([
    listFormProjects(params.workspaceId),
    listFormTemplates({ workspaceId: params.workspaceId, isActive: true }),
    listFormExecutions({ workspaceId: params.workspaceId, limit: 30 }),
    listFormTypes({ workspaceId: params.workspaceId, isActive: true }),
  ]);

  const mergedProjects = [...projects];

  const visibleProjects = mergedProjects.filter((project) => {
      try {
        assertFormPermission(
          params.permissions,
          params.isDefaultAdmin,
          project.id,
          "view",
          { userId: params.userId, project: project as any }
        );
        return true;
      } catch {
      return false;
    }
  });

  const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));

  if (
    visibleProjects.length === 0 &&
    !canAccessFormsModule(params.permissions, params.isDefaultAdmin)
  ) {
    throw new Error("Sem permissão para acessar formulários.");
  }

  return {
    flags,
    access: {
      can_view: true,
      can_create_projects:
        params.isDefaultAdmin || params.permissions.forms.global.create_projects,
      can_manage_templates:
        params.isDefaultAdmin ||
        params.permissions.forms.global.manage_templates,
      can_view_analytics:
        params.isDefaultAdmin ||
        params.permissions.forms.global.view_analytics,
    },
    projects: visibleProjects,
    types: types.filter((type) => visibleProjectIds.has(type.form_project_id)),
    templates: templates.filter((template) =>
      visibleProjectIds.has(template.form_project_id)
    ),
    executions: executions.filter((execution) =>
      visibleProjectIds.has(execution.form_project_id)
    ),
  };
}

export async function buildFormTemplatePayload(params: {
  templateId: string;
  workspaceId: string;
  permissions: PermissionSet;
  isDefaultAdmin: boolean;
}) {
  const template = await getFormTemplateById(params.templateId, params.workspaceId);
  if (!template) {
    throw new Error("Template não encontrado.");
  }

  assertFormPermission(
    params.permissions,
    params.isDefaultAdmin,
    template.form_project_id,
    "view"
  );

  return template;
}

export async function buildFormExecutionPayload(params: {
  executionId: string;
  workspaceId: string;
  permissions: PermissionSet;
  isDefaultAdmin: boolean;
}) {
  const payload = await getFormExecutionById(params.executionId, params.workspaceId);
  if (!payload) {
    throw new Error("Execução não encontrada.");
  }

  return payload;
}
