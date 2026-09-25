import "server-only";
import type { NextRequest } from "next/server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability";
import { BudgetDomainError } from "./service.server";

export async function budgetActor(request: NextRequest, action: "view" | "manage") {
  const actor = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "BUDGET_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  assertBudgetPermission(actor, action);
  return actor;
}

export function assertBudgetPermission(actor: ServerUserContext, action: "view" | "manage") {
  if (actor.isDefaultAdmin) return;
  const financial = actor.permissions.financial;
  const permitted = financial?.view && (action === "manage"
    ? financial.settings?.view && financial.settings?.manageBudgets
    : financial.settings?.view || financial.cashFlow?.view);
  if (!permitted) throw new AppError({ code: "BUDGET_FORBIDDEN", kind: "AUTHORIZATION" });
}

export function budgetError(error: unknown): never {
  if (error instanceof BudgetDomainError) {
    throw new AppError({ code: "BUDGET_INVALID_OPERATION", kind: "VALIDATION", safeMessage: error.message, cause: error });
  }
  throw error;
}

export function validBudgetDocumentId(id: string) {
  if (!id || id.length > 180 || id.includes("/")) {
    throw new AppError({ code: "BUDGET_DOCUMENT_ID_INVALID", kind: "VALIDATION" });
  }
  return id;
}
