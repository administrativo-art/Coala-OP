import { type ServerUserContext } from "@/lib/auth-server";
import { type PermissionSet, type Task } from "@/types";
import { getFeatureFlags } from "@/lib/feature-flags";

type TaskPermissionLevel = "view" | "manage";

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

export function getUserTaskUnitIds(userDoc: Record<string, unknown>) {
  return Array.from(
    new Set([
      ...asStringArray(userDoc.unitIds),
      ...asStringArray(userDoc.assignedKioskIds),
    ])
  );
}

function getUserRoleIds(context: Pick<ServerUserContext, "userDoc" | "profileId">) {
  const userDoc = context.userDoc as unknown as Record<string, unknown>;
  return Array.from(
    new Set([
      context.profileId ?? "",
      String(userDoc.profileId || ""),
      String(userDoc.jobRoleId || ""),
      ...asStringArray(userDoc.jobFunctionIds),
    ].filter(Boolean))
  );
}

function getUserTeamIds(context: Pick<ServerUserContext, "userDoc">) {
  return asStringArray((context.userDoc as unknown as Record<string, unknown>).teamIds);
}

function taskUnitIds(task: Pick<Task, "unitId"> & Record<string, unknown>) {
  return Array.from(
    new Set([
      String(task.unitId || ""),
      String(task.unit_id || ""),
      ...asStringArray(task.unitIds),
      ...asStringArray(task.unit_ids),
    ].filter(Boolean))
  );
}

function taskWatcherIds(task: Task & Record<string, unknown>) {
  return {
    users: Array.from(
      new Set([
        ...asStringArray(task.watcherUserIds),
        ...asStringArray(task.watcher_user_ids),
      ])
    ),
    profiles: Array.from(
      new Set([
        ...asStringArray(task.watcherProfileIds),
        ...asStringArray(task.watcher_profile_ids),
      ])
    ),
    roles: Array.from(
      new Set([
        ...asStringArray(task.watcherRoleIds),
        ...asStringArray(task.watcher_role_ids),
      ])
    ),
  };
}

function getLegacyOriginType(task: Task & Record<string, unknown>) {
  const origin = task.origin;
  if (origin && typeof origin === "object" && "kind" in origin && origin.kind === "legacy") {
    return origin.type;
  }

  const rawOrigin = task.origin as Record<string, unknown> | undefined;
  if (rawOrigin?.kind === "legacy" && typeof rawOrigin.type === "string") {
    return rawOrigin.type;
  }

  return null;
}

function isStockCountApprovalTask(task: Task & Record<string, unknown>) {
  return getLegacyOriginType(task) === "stock_count_approval";
}

function isReturnRequestTask(task: Task & Record<string, unknown>) {
  return getLegacyOriginType(task) === "return_request";
}

function isItemAdditionRequestTask(task: Task & Record<string, unknown>) {
  return getLegacyOriginType(task) === "item_addition_request";
}

function hasStockCountApprovalAccess(context: ServerUserContext) {
  return (
    context.permissions.stock.stockCount.approve ||
    context.permissions.stock.audit.approve
  );
}

function hasReturnRequestAccess(context: ServerUserContext) {
  return context.permissions.stock.returns.updateStatus;
}

function hasItemAdditionRequestAccess(context: ServerUserContext) {
  return context.permissions.itemRequests.approve;
}

function hasIntegratedTaskAccess(context: ServerUserContext, task: Task & Record<string, unknown>) {
  if (isStockCountApprovalTask(task)) return hasStockCountApprovalAccess(context);
  if (isReturnRequestTask(task)) return hasReturnRequestAccess(context);
  if (isItemAdditionRequestTask(task)) return hasItemAdditionRequestAccess(context);
  return false;
}

export function isTaskAssignedToContext(
  context: Pick<ServerUserContext, "userDoc" | "profileId">,
  task: Pick<Task, "assigneeType" | "assigneeId"> & Record<string, unknown>
) {
  const userId = context.userDoc.id;
  const assigneeType = task.assigneeType ?? task.assignee_type;
  const assigneeId = String(task.assigneeId ?? task.assignee_id ?? "");
  if (!assigneeId) return false;

  if (assigneeType === "user") return assigneeId === userId;
  if (assigneeType === "profile") return assigneeId === context.profileId;
  if (assigneeType === "role") return getUserRoleIds(context).includes(assigneeId);
  if (assigneeType === "team") return getUserTeamIds(context).includes(assigneeId);
  if (assigneeType === "unit") return getUserTaskUnitIds(context.userDoc as unknown as Record<string, unknown>).includes(assigneeId);

  return false;
}

export function isTaskApprovalTurnForContext(
  context: Pick<ServerUserContext, "userDoc" | "profileId">,
  task: Pick<Task, "status" | "approverType" | "approverId"> & Record<string, unknown>
) {
  if (task.status !== "awaiting_approval") return false;

  const approverType = task.approverType ?? task.approver_type;
  const approverId = String(task.approverId ?? task.approver_id ?? "");
  if (!approverId) return false;

  if (approverType === "user") return approverId === context.userDoc.id;
  if (approverType === "profile") return approverId === context.profileId;
  if (approverType === "role") return getUserRoleIds(context).includes(approverId);
  if (approverType === "team") return getUserTeamIds(context).includes(approverId);
  if (approverType === "unit") return getUserTaskUnitIds(context.userDoc as unknown as Record<string, unknown>).includes(approverId);

  return false;
}

export function canViewTask(context: ServerUserContext, task: Task & Record<string, unknown>) {
  const workspaceId =
    typeof task.workspace_id === "string"
      ? task.workspace_id
      : typeof task.workspaceId === "string"
        ? task.workspaceId
        : null;
  if (workspaceId && workspaceId !== context.workspace_id) return false;

  if (hasIntegratedTaskAccess(context, task)) return true;
  if (context.isDefaultAdmin || context.permissions.tasks.manage) return true;
  if (!context.permissions.tasks.view) return false;

  if (isTaskAssignedToContext(context, task)) return true;
  if (isTaskApprovalTurnForContext(context, task)) return true;

  const createdByUserId = String(task.createdByUserId ?? task.created_by_user_id ?? "");
  if (createdByUserId && createdByUserId === context.userDoc.id) return true;

  const watchers = taskWatcherIds(task);
  if (watchers.users.includes(context.userDoc.id)) return true;
  if (context.profileId && watchers.profiles.includes(context.profileId)) return true;
  if (watchers.roles.some((roleId) => getUserRoleIds(context).includes(roleId))) return true;

  const userUnitIds = getUserTaskUnitIds(context.userDoc as unknown as Record<string, unknown>);
  const relatedUnitIds = taskUnitIds(task);
  if (relatedUnitIds.some((unitId) => userUnitIds.includes(unitId))) return true;

  return false;
}

export function canActOnTask(context: ServerUserContext, task: Task & Record<string, unknown>) {
  const workspaceId =
    typeof task.workspace_id === "string"
      ? task.workspace_id
      : typeof task.workspaceId === "string"
        ? task.workspaceId
        : null;
  if (workspaceId && workspaceId !== context.workspace_id) return false;

  if (hasIntegratedTaskAccess(context, task)) return true;
  if (context.isDefaultAdmin || context.permissions.tasks.manage) return true;
  if (!context.permissions.tasks.view) return false;
  if (isTaskApprovalTurnForContext(context, task)) return true;
  if (task.status === "pending" || task.status === "reopened" || task.status === "in_progress") {
    return isTaskAssignedToContext(context, task);
  }
  return false;
}

export function assertTaskPermission(
  permissions: PermissionSet,
  isDefaultAdmin: boolean,
  _projectId: string | null,
  level: TaskPermissionLevel
) {
  if (isDefaultAdmin) return;

  if (level === "manage" && permissions.tasks.manage) return;
  if (
    level === "view" &&
    (
      permissions.tasks.view ||
      permissions.tasks.manage ||
      permissions.stock.stockCount.approve ||
      permissions.stock.audit.approve ||
      permissions.stock.returns.updateStatus ||
      permissions.itemRequests.approve
    )
  ) return;

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
      { label: "Formulários", href: "/dashboard/forms" },
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
