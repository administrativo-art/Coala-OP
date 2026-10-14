import { NextRequest, NextResponse } from "next/server";

import type { HrAccess } from "@/features/hr/lib/server-access";
import {
  authenticateCollaboratorRequestReviewer,
  authenticateCollaboratorRequestUser,
  collaboratorRequestOperationError,
  collaboratorRequestPatchSchema,
  collaboratorRequestRouteSchema,
  requireCollaboratorRequestResource,
  type CollaboratorRequestPatchInput,
} from "@/features/hr/requests/security.server";
import {
  approveCollaboratorRequest,
  cancelCollaboratorRequest,
  rejectCollaboratorRequest,
  retryCollaboratorRequestDocument,
  type RequestAccess,
} from "@/features/hr/requests/service.server";
import type { ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ requestId: string }> };
type RequestResource = { requestId: string; employeeId: string; owner: boolean };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "collaborator.requests.update",
  version: 1,
  surface: { method: "PATCH", path: "/api/collaborator/requests/[requestId]" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "collaborator-request-action" },
  resourceScope: { kind: "custom", strategy: "collaborator-request" },
  input: { kind: "schema", schema: "collaborator-request-action", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<
  NextRequest,
  RouteContext,
  unknown,
  RequestAccess,
  CollaboratorRequestPatchInput,
  RequestResource
>({
  id: "collaborator-request-action-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:collaborator-request-action", "scope:collaborator-request", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const user = await authenticateCollaboratorRequestUser(request);
    const [params, body] = await Promise.all([
      routeContext.params,
      request.json().catch(() => null),
    ]);
    const parsedParams = collaboratorRequestRouteSchema.safeParse(params);
    const parsedInput = collaboratorRequestPatchSchema.safeParse(body);
    if (!parsedParams.success || !parsedInput.success) {
      throw new AppError({ code: "COLLABORATOR_REQUEST_ACTION_INPUT_INVALID", kind: "VALIDATION", safeMessage: parsedInput.error?.issues[0]?.message ?? "Ação inválida.", reportable: false });
    }
    const input = parsedInput.data;
    const actor: ServerUserContext | HrAccess = input.action === "cancel"
      ? user
      : await authenticateCollaboratorRequestReviewer(request);
    const resource = await requireCollaboratorRequestResource(actor, parsedParams.data.requestId);
    if (input.action === "cancel" && !resource.owner) {
      throw new AppError({ code: "COLLABORATOR_REQUEST_CANCEL_OWNER_REQUIRED", kind: "AUTHORIZATION", safeMessage: "Somente o titular pode cancelar esta solicitação.", reportable: false });
    }
    return { actor, input, resource };
  },
});

export const PATCH = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  try {
    if (input.action === "cancel") {
      await cancelCollaboratorRequest(actor, resource.requestId);
      return NextResponse.json({ ok: true });
    }
    const reviewer = actor as HrAccess;
    if (input.action === "reject") {
      await rejectCollaboratorRequest(reviewer, resource.requestId, input.notes);
      return NextResponse.json({ ok: true });
    }
    if (input.action === "approve") {
      return NextResponse.json(await approveCollaboratorRequest(reviewer, resource.requestId, input));
    }
    const generatedDocumentId = await retryCollaboratorRequestDocument(reviewer, resource.requestId);
    return NextResponse.json({ ok: true, generatedDocumentId });
  } catch (cause) {
    throw collaboratorRequestOperationError(cause, "Falha ao atualizar solicitação.");
  }
});
