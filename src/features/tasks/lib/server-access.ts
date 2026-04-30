import { type PermissionSet } from "@/types";
import { getFeatureFlags } from "@/lib/feature-flags";

type TaskPermissionLevel = "view" | "manage";

export function assertTaskPermission(
  permissions: PermissionSet,
  isDefaultAdmin: boolean,
  _projectId: string | null,
  level: TaskPermissionLevel
) {
  if (isDefaultAdmin) return;

  if (level === "manage" && permissions.tasks.manage) return;
  if (level === "view" && (permissions.tasks.view || permissions.tasks.manage)) return;

  throw new Error(
    level === "manage"
      ? "Sem permissão para gerenciar tarefas."
      : "Sem permissão para visualizar tarefas."
  );
}

export async function loadTasksNavigation(params: {
  permissions: PermissionSet;
  isDefaultAdmin: boolean;
  workspaceId: string;
}) {
  const flags = await getFeatureFlags(params.workspaceId);
  if (flags.kill_tasks_module) {
    throw new Error("O módulo de tarefas está temporariamente desativado.");
  }

  assertTaskPermission(params.permissions, params.isDefaultAdmin, null, "view");

  return {
    flags,
    summary: {
      can_manage: params.isDefaultAdmin || params.permissions.tasks.manage,
      integrations: {
        forms: flags.tasks_from_forms_enabled && !flags.kill_tasks_from_forms,
        purchase_receipt:
          flags.tasks_from_purchase_receipt_enabled &&
          !flags.kill_tasks_from_purchase_receipt,
      },
    },
    links: [
      { label: "Painel de tarefas", href: "/dashboard/tasks" },
      { label: "Checklists legados", href: "/dashboard/dp/checklists?tab=operations" },
    ],
  };
}

export async function assertTasksModuleEnabled(workspaceId: string) {
  const flags = await getFeatureFlags(workspaceId);
  if (flags.kill_tasks_module) {
    throw new Error("O módulo de tarefas está temporariamente desativado.");
  }

  return flags;
}
