import "server-only";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { assertHrAccess, type HrAccess } from "@/features/hr/lib/server-access";
import {
  assertCollaboratorRequestAccess,
  canReviewCollaboratorRequests,
  canViewCollaboratorRequests,
  type RequestAccess,
} from "@/features/hr/requests/service.server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";

export const collaboratorRequestIdSchema = z.string().trim().min(1).max(250);

export const collaboratorRequestRouteSchema = z.object({
  requestId: collaboratorRequestIdSchema,
}).strict();

export const collaboratorRequestListSchema = z.object({
  scope: z.enum(["own", "team"]),
}).strict();

export const transportVoucherRequestCreateSchema = z.object({
  action: z.enum(["activate", "change", "suspend", "reactivate"]),
  details: z.string().trim().max(1_500).optional().default(""),
}).strict();

const optionalNotes = z.string().trim().max(1_500).optional();

export const collaboratorRequestPatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }).strict(),
  z.object({ action: z.literal("reject"), notes: z.string().trim().min(5).max(1_500) }).strict(),
  z.object({
    action: z.literal("approve"),
    approvedDailyValue: z.union([z.string().trim().max(40), z.number().finite()]).optional(),
    notes: optionalNotes,
  }).strict(),
  z.object({ action: z.literal("generate_document") }).strict(),
]);

export type CollaboratorRequestPatchInput = z.infer<typeof collaboratorRequestPatchSchema>;

function securityError(
  code: string,
  kind: "AUTHENTICATION" | "AUTHORIZATION" | "VALIDATION",
  safeMessage: string,
  cause?: unknown,
) {
  return new AppError({ code, kind, safeMessage, cause, reportable: false });
}

export function collaboratorRequestOperationError(cause: unknown, fallback: string) {
  return new AppError({
    code: "COLLABORATOR_REQUEST_OPERATION_FAILED",
    kind: "EXPECTED_BUSINESS",
    safeMessage: cause instanceof Error && cause.message ? cause.message : fallback,
    cause,
    reportable: false,
  });
}

export async function authenticateCollaboratorRequestUser(request: NextRequest) {
  return requireUser(request).catch((cause) => {
    throw securityError("COLLABORATOR_REQUEST_AUTHENTICATION_REQUIRED", "AUTHENTICATION", "Autenticação necessária.", cause);
  });
}

export async function authenticateCollaboratorRequestReviewer(request: NextRequest): Promise<HrAccess> {
  const access = await assertHrAccess(request, "view").catch((cause) => {
    throw securityError("COLLABORATOR_REQUEST_REVIEW_ACCESS_REQUIRED", "AUTHORIZATION", "Sem permissão para analisar solicitações.", cause);
  });
  if (!canReviewCollaboratorRequests(access)) {
    throw securityError("COLLABORATOR_REQUEST_REVIEW_FORBIDDEN", "AUTHORIZATION", "Sem permissão para analisar solicitações.");
  }
  return access;
}

export async function authenticateCollaboratorRequestList(
  request: NextRequest,
  scope: "own" | "team",
): Promise<RequestAccess> {
  if (scope === "own") return authenticateCollaboratorRequestUser(request);
  const access = await assertHrAccess(request, "view").catch((cause) => {
    throw securityError("COLLABORATOR_REQUEST_LIST_ACCESS_REQUIRED", "AUTHORIZATION", "Sem permissão para visualizar solicitações.", cause);
  });
  if (!canViewCollaboratorRequests(access)) {
    throw securityError("COLLABORATOR_REQUEST_LIST_FORBIDDEN", "AUTHORIZATION", "Sem permissão para visualizar solicitações.");
  }
  return access;
}

export async function requireCollaboratorRequestResource(access: RequestAccess, requestId: string) {
  return assertCollaboratorRequestAccess(access, requestId).catch((cause) => {
    throw securityError("COLLABORATOR_REQUEST_ACCESS_FORBIDDEN", "AUTHORIZATION", "Sem permissão para acessar esta solicitação.", cause);
  });
}

export function assertCollaboratorRequestWorkspace(
  actor: ServerUserContext | HrAccess,
  resource: { workspaceId: string },
) {
  const workspaceId = "workspaceId" in actor ? actor.workspaceId : actor.workspace_id;
  if (!resource.workspaceId || resource.workspaceId !== workspaceId) {
    throw securityError("COLLABORATOR_REQUEST_WORKSPACE_FORBIDDEN", "AUTHORIZATION", "Solicitação fora do espaço de trabalho.");
  }
}
