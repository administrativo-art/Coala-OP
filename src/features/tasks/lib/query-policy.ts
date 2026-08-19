import { type Task } from "@/types";

export const ACTIVE_TASK_STATUSES = [
  "pending",
  "in_progress",
  "awaiting_approval",
  "reopened",
] as const satisfies readonly Task["status"][];

export const ACTIVE_TASK_LIMIT = 100;
export const TASK_HISTORY_LIMIT = 500;

export type TaskBootstrapScope = "active" | "history";

export function taskBootstrapScopeForPathname(pathname: string | null | undefined): TaskBootstrapScope {
  if (
    pathname === "/dashboard/tasks" ||
    pathname?.startsWith("/dashboard/tasks/") ||
    pathname === "/dashboard/operations" ||
    pathname?.startsWith("/dashboard/operations/")
  ) {
    return "history";
  }

  return "active";
}

export function resolveTaskBootstrapPolicy(scope: string | null | undefined) {
  if (scope === "history") {
    return {
      scope: "history" as const,
      limit: TASK_HISTORY_LIMIT,
      statuses: undefined,
    };
  }

  return {
    scope: "active" as const,
    limit: ACTIVE_TASK_LIMIT,
    statuses: ACTIVE_TASK_STATUSES,
  };
}
