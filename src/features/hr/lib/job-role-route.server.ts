import "server-only";

import type { NextRequest } from "next/server";

import { assertHrAccess } from "@/features/hr/lib/server-access";
import { AppError } from "@/lib/observability/app-error";
import { toRouteAccessError } from "@/lib/security/route-access.server";

export function requireJobRoleAccess(request: NextRequest, mode: "view" | "manage") {
  return assertHrAccess(request, mode).catch((cause) => { throw toRouteAccessError(cause, "HR_JOB_ROLE"); });
}

export function rejectJobRole(message: string, kind: "VALIDATION" | "NOT_FOUND" = "VALIDATION"): never {
  throw new AppError({ code: kind === "NOT_FOUND" ? "HR_JOB_ROLE_NOT_FOUND" : "HR_JOB_ROLE_REJECTED", kind, safeMessage: message });
}
