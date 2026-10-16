import { NextRequest, NextResponse } from "next/server";

import type { HrAccess } from "@/features/hr/lib/server-access";
import {
  authenticateCollaboratorRequestReviewer,
  authenticateCollaboratorRequestUser,
  collaboratorRequestOperationError,
  collaboratorRequestRouteSchema,
  requireCollaboratorRequestResource,
} from "@/features/hr/requests/security.server";
import {
  loadCollaboratorRequestSignature,
  sendCollaboratorRequestForSignature,
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
type SignatureInput = { requestId: string };
type RequestResource = { requestId: string; employeeId: string; owner: boolean };

const getContract = defineSecurityContract({
  schemaVersion: 1,
  id: "collaborator.requests.signature.read",
  version: 1,
  surface: { method: "GET", path: "/api/collaborator/requests/[requestId]/signature" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "collaborator-request-signature" },
  resourceScope: { kind: "custom", strategy: "collaborator-request" },
  input: { kind: "schema", schema: "collaborator-request-route", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const postContract = defineSecurityContract({
  schemaVersion: 1,
  id: "collaborator.requests.signature.send",
  version: 1,
  surface: { method: "POST", path: "/api/collaborator/requests/[requestId]/signature" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "collaborator-request-signature-send" },
  resourceScope: { kind: "custom", strategy: "collaborator-request" },
  input: { kind: "schema", schema: "collaborator-request-route", unknownFields: "reject" },
  effects: { mode: "external", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

async function parseResource(request: NextRequest, routeContext: RouteContext) {
  const user = await authenticateCollaboratorRequestUser(request);
  const parsed = collaboratorRequestRouteSchema.safeParse(await routeContext.params);
  if (!parsed.success) {
    throw new AppError({ code: "COLLABORATOR_REQUEST_SIGNATURE_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Solicitação inválida.", reportable: false });
  }
  const resource = await requireCollaboratorRequestResource(user, parsed.data.requestId);
  return { user, input: parsed.data, resource };
}

const getEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, SignatureInput, RequestResource>({
  id: "collaborator-request-signature-read-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:collaborator-request-signature", "scope:collaborator-request", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const parsed = await parseResource(request, routeContext);
    return { actor: parsed.user, input: parsed.input, resource: parsed.resource };
  },
});

const postEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, RequestAccess, SignatureInput, RequestResource>({
  id: "collaborator-request-signature-send-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:collaborator-request-signature-send", "scope:collaborator-request", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const parsed = await parseResource(request, routeContext);
    const actor: ServerUserContext | HrAccess = parsed.resource.owner
      ? parsed.user
      : await authenticateCollaboratorRequestReviewer(request);
    return { actor, input: parsed.input, resource: parsed.resource };
  },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) => {
  try {
    return NextResponse.json({ signature: await loadCollaboratorRequestSignature(security.actor, security.resource.requestId) });
  } catch (cause) {
    throw collaboratorRequestOperationError(cause, "Falha ao carregar a assinatura.");
  }
});

export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ security }) => {
  try {
    return NextResponse.json({ signature: await sendCollaboratorRequestForSignature(security.actor, security.resource.requestId) });
  } catch (cause) {
    throw collaboratorRequestOperationError(cause, "Falha ao disponibilizar a assinatura.");
  }
});
