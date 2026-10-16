import { NextRequest, NextResponse } from "next/server";

import type { HrAccess } from "@/features/hr/lib/server-access";
import {
  collaboratorRequestListSchema,
  collaboratorRequestOperationError,
  assertCollaboratorRequestWorkspace,
  authenticateCollaboratorRequestList,
  authenticateCollaboratorRequestUser,
  transportVoucherRequestCreateSchema,
} from "@/features/hr/requests/security.server";
import {
  createTransportVoucherRequest,
  listOwnCollaboratorRequests,
  listReviewableCollaboratorRequests,
} from "@/features/hr/requests/service.server";
import type { ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer, defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };
type ListInput = { scope: "own" | "team" };
type WorkspaceResource = { workspaceId: string };
type OwnerResource = WorkspaceResource & { employeeId: string };

const listContract = defineSecurityContract({
  schemaVersion: 1,
  id: "collaborator.requests.list",
  version: 1,
  surface: { method: "GET", path: "/api/collaborator/requests" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "collaborator-request-list" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "collaborator-request-list", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const createContract = defineSecurityContract({
  schemaVersion: 1,
  id: "collaborator.requests.create",
  version: 1,
  surface: { method: "POST", path: "/api/collaborator/requests" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "owner" },
  resourceScope: { kind: "owner" },
  input: { kind: "schema", schema: "transport-voucher-request-create", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

function parseListInput(request: NextRequest): ListInput {
  const raw = request.nextUrl.searchParams.get("scope");
  const parsed = collaboratorRequestListSchema.safeParse({ scope: raw === null ? "own" : raw });
  if (!parsed.success) {
    throw new AppError({ code: "COLLABORATOR_REQUEST_LIST_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Escopo de solicitações inválido.", reportable: false });
  }
  return parsed.data;
}

const listEnforcer = defineSecurityEnforcer<
  NextRequest,
  StaticRouteContext,
  unknown,
  ServerUserContext | HrAccess,
  ListInput,
  WorkspaceResource
>({
  id: "collaborator-request-list-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:collaborator-request-list", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request }) {
    const input = parseListInput(request);
    const actor = await authenticateCollaboratorRequestList(request, input.scope);
    const resource = { workspaceId: "workspaceId" in actor ? actor.workspaceId : actor.workspace_id };
    assertCollaboratorRequestWorkspace(actor, resource);
    return { actor, input, resource };
  },
});

const createEnforcer = createStandardSecurityEnforcer<
  NextRequest,
  StaticRouteContext,
  unknown,
  ServerUserContext,
  ReturnType<typeof transportVoucherRequestCreateSchema.parse>,
  OwnerResource
>(createContract, {
  authenticate: ({ request }) => authenticateCollaboratorRequestUser(request),
  async parseInput({ request }) {
    const parsed = transportVoucherRequestCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: "TRANSPORT_VOUCHER_REQUEST_INPUT_INVALID", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message ?? "Solicitação inválida.", reportable: false });
    return parsed.data;
  },
  loadResource: ({ actor }) => ({ workspaceId: actor.workspace_id, employeeId: actor.decoded.uid }),
  authorize: ({ actor, resource }) => {
    if (resource.employeeId !== actor.decoded.uid) throw new AppError({ code: "COLLABORATOR_REQUEST_OWNER_FORBIDDEN", kind: "AUTHORIZATION" });
  },
  assertScope: ({ actor, resource }) => {
    if (resource.employeeId !== actor.decoded.uid || resource.workspaceId !== actor.workspace_id) {
      throw new AppError({ code: "COLLABORATOR_REQUEST_OWNER_SCOPE_FORBIDDEN", kind: "AUTHORIZATION" });
    }
  },
});

export const GET = secureRoute({ contract: listContract, enforcer: listEnforcer }, async ({ security }) => {
  try {
    const requests = security.input.scope === "team"
      ? await listReviewableCollaboratorRequests(security.actor as HrAccess)
      : await listOwnCollaboratorRequests(security.actor);
    return NextResponse.json({ requests }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    throw collaboratorRequestOperationError(cause, "Falha ao carregar solicitações.");
  }
});

export const POST = secureRoute({ contract: createContract, enforcer: createEnforcer }, async ({ security }) => {
  try {
    const created = await createTransportVoucherRequest(security.actor, security.input);
    return NextResponse.json({ request: created }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    throw collaboratorRequestOperationError(cause, "Falha ao criar solicitação.");
  }
});
