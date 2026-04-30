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
} from "@/features/forms/lib/server";
import {
  getLegacyFormExecutionBySyntheticId,
  getLegacyFormTemplateBySyntheticId,
  listLegacyFormExecutions,
  listLegacyFormProjects,
  listLegacyFormTemplates,
} from "@/features/forms/lib/legacy-read";
import { getFeatureFlags } from "@/lib/feature-flags";

export async function buildFormsBootstrap(params: {
  workspaceId: string;
  permissions: PermissionSet;
  isDefaultAdmin: boolean;
}) {
  const flags = await getFeatureFlags(params.workspaceId);
  if (flags.kill_forms_module) {
    throw new Error("O módulo de formulários está temporariamente desativado.");
  }

  if (!flags.forms_new_engine_enabled && !flags.forms_navigation_api_enabled) {
    throw new Error("O novo motor de formulários ainda não foi liberado.");
  }

  if (!canAccessFormsModule(params.permissions, params.isDefaultAdmin)) {
    throw new Error("Sem permissão para acessar formulários.");
  }

  const [projects, templates, executions] = await Promise.all([
    listFormProjects(params.workspaceId),
    listFormTemplates({ workspaceId: params.workspaceId, isActive: true }),
    listFormExecutions({ workspaceId: params.workspaceId, limit: 30 }),
  ]);
  const [legacyProjects, legacyTemplates, legacyExecutions] =
    flags.forms_read_from_legacy_enabled
      ? await Promise.all([
          listLegacyFormProjects(200),
          listLegacyFormTemplates(200),
          listLegacyFormExecutions(200),
        ])
      : [[], [], []];

  const mergedProjects = [...projects];
  legacyProjects.forEach((project) => {
    if (!mergedProjects.some((current) => current.id === project.id)) {
      mergedProjects.push(project);
    }
  });

  const visibleProjects = mergedProjects.filter((project) => {
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

  const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));

  return {
    flags,
    access: {
      can_view: true,
      can_create_projects:
        params.isDefaultAdmin || params.permissions.forms.global.create_projects,
      can_manage_templates:
        params.isDefaultAdmin ||
        params.permissions.forms.global.manage_templates ||
        params.permissions.dp.checklists.manageTemplates,
      can_view_analytics:
        params.isDefaultAdmin ||
        params.permissions.forms.global.view_analytics ||
        params.permissions.dp.checklists.viewAnalytics,
    },
    projects: visibleProjects,
    templates: [...templates, ...legacyTemplates].filter((template) =>
      visibleProjectIds.has(template.form_project_id)
    ),
    executions: [...executions, ...legacyExecutions].filter((execution) =>
      visibleProjectIds.has(execution.form_project_id)
    ),
  };
}

export async function buildFormTemplatePayload(params: {
  templateId: string;
  permissions: PermissionSet;
  isDefaultAdmin: boolean;
}) {
  const template =
    (await getFormTemplateById(params.templateId)) ??
    (await getLegacyFormTemplateBySyntheticId(params.templateId));
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
  permissions: PermissionSet;
  isDefaultAdmin: boolean;
}) {
  const payload =
    (await getFormExecutionById(params.executionId)) ??
    (await getLegacyFormExecutionBySyntheticId(params.executionId));
  if (!payload) {
    throw new Error("Execução não encontrada.");
  }

  assertFormPermission(
    params.permissions,
    params.isDefaultAdmin,
    payload.execution.form_project_id,
    "view"
  );

  return payload;
}
