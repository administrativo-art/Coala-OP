import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  DEVELOPER_VIEW_AS_COOKIE,
  DEVELOPER_VIEW_AS_MAX_USERS,
  isDeveloperViewAsEmail,
  type DeveloperViewAsDirectory,
} from "@/features/auth/developer-view-as";
import {
  developerViewAsUser,
  requestedDeveloperViewAsUserId,
} from "@/features/auth/developer-view-as.server";
import { authenticatedActorIdentity, requireAuthenticatedUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { logAction } from "@/lib/log-action";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };
type Resource = { workspaceId: string };

const selectionSchema = z.object({
  targetUserId: z.string().trim().min(1).max(128).refine((value) => !value.includes("/")),
}).strict();

function assertDeveloperActor(actor: ServerUserContext) {
  if (!isDeveloperViewAsEmail(authenticatedActorIdentity(actor).email ?? actor.decoded.email)) {
    throw new AppError({
      code: "DEVELOPER_VIEW_AS_FORBIDDEN",
      kind: "AUTHORIZATION",
      safeMessage: "Esta ferramenta não está disponível para este usuário.",
      httpStatus: 403,
    });
  }
}

async function authenticateDeveloper(request: NextRequest) {
  const actor = await requireAuthenticatedUser(request).catch((cause) => {
    throw new AppError({ code: "DEVELOPER_VIEW_AS_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  assertDeveloperActor(actor);
  return actor;
}

const getContract = defineSecurityContract({
  schemaVersion: 1,
  id: "auth.developer-view-as.list",
  version: 1,
  surface: { method: "GET", path: "/api/auth/view-as" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "developer-view-as-email" },
  resourceScope: { kind: "workspace" },
  input: { kind: "none" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const getEnforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, null, Resource>({
  id: "developer-view-as-list-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:developer-view-as-email", "workspace-scoped"],
  async enforce({ request }) {
    const actor = await authenticateDeveloper(request);
    return { actor, input: null, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ request, security }) => {
  const realActor = authenticatedActorIdentity(security.actor);
  const snapshot = await dbAdmin.collection("users").limit(DEVELOPER_VIEW_AS_MAX_USERS).get();
  const users = snapshot.docs
    .filter((document) => document.id !== realActor.uid && document.get("isActive") !== false)
    .map((document) => developerViewAsUser({ id: document.id, ...document.data() }))
    .sort((left, right) => left.username.localeCompare(right.username, "pt-BR"));
  const requestedTargetId = requestedDeveloperViewAsUserId(request);
  let targetUser = requestedTargetId
    ? users.find((candidate) => candidate.id === requestedTargetId) ?? null
    : null;
  if (requestedTargetId && requestedTargetId !== realActor.uid && !targetUser) {
    const targetSnapshot = await dbAdmin.collection("users").doc(requestedTargetId).get();
    if (targetSnapshot.exists && targetSnapshot.get("isActive") !== false) {
      targetUser = developerViewAsUser({ id: targetSnapshot.id, ...targetSnapshot.data()! });
      users.unshift(targetUser);
      if (users.length > DEVELOPER_VIEW_AS_MAX_USERS) users.pop();
    }
  }
  const payload: DeveloperViewAsDirectory = {
    enabled: true,
    targetUserId: targetUser?.id ?? null,
    targetUser,
    users,
  };
  return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
});

const postContract = defineSecurityContract({
  schemaVersion: 1,
  id: "auth.developer-view-as.start",
  version: 1,
  surface: { method: "POST", path: "/api/auth/view-as" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "developer-view-as-email" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "auth.developer-view-as.selection", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const postEnforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, z.infer<typeof selectionSchema>, Resource>({
  id: "developer-view-as-start-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:developer-view-as-email", "workspace-scoped", "input-validated", "fields-allowlisted", "server-authoritative-audit"],
  async enforce({ request }) {
    const actor = await authenticateDeveloper(request);
    const parsed = selectionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({
        code: "DEVELOPER_VIEW_AS_INVALID_SELECTION",
        kind: "VALIDATION",
        safeMessage: "Selecione um usuário válido.",
      });
    }
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ security }) => {
  const realActor = authenticatedActorIdentity(security.actor);
  const targetSnap = await dbAdmin.collection("users").doc(security.input.targetUserId).get();
  if (!targetSnap.exists || targetSnap.get("isActive") === false) {
    throw new AppError({
      code: "DEVELOPER_VIEW_AS_TARGET_UNAVAILABLE",
      kind: "NOT_FOUND",
      safeMessage: "O usuário selecionado não está disponível.",
      httpStatus: 404,
    });
  }
  if (targetSnap.id === realActor.uid) {
    throw new AppError({
      code: "DEVELOPER_VIEW_AS_SELF_TARGET",
      kind: "VALIDATION",
      safeMessage: "Seu próprio usuário já é a visão padrão.",
    });
  }
  const target = developerViewAsUser({ id: targetSnap.id, ...targetSnap.data()! });
  await logAction({
    workspace_id: security.resource.workspaceId,
    user_id: realActor.uid,
    username: realActor.username,
    module: "auth.developer-view-as",
    action: "developer_view_as_started",
    metadata: { target_user_id: target.id, target_username: target.username },
    trust_source: "server-authoritative",
    event_namespace: "security",
  });
  const response = NextResponse.json({ targetUser: target });
  response.cookies.set(DEVELOPER_VIEW_AS_COOKIE, target.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  return response;
});
const deleteContract = defineSecurityContract({
  schemaVersion: 1,
  id: "auth.developer-view-as.stop",
  version: 1,
  surface: { method: "DELETE", path: "/api/auth/view-as" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "developer-view-as-email" },
  resourceScope: { kind: "workspace" },
  input: { kind: "none" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const deleteEnforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, null, Resource>({
  id: "developer-view-as-stop-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:developer-view-as-email", "workspace-scoped", "server-authoritative-audit"],
  async enforce({ request }) {
    const actor = await authenticateDeveloper(request);
    return { actor, input: null, resource: { workspaceId: actor.workspace_id } };
  },
});

export const DELETE = secureRoute({ contract: deleteContract, enforcer: deleteEnforcer }, async ({ request, security }) => {
  const realActor = authenticatedActorIdentity(security.actor);
  const targetUserId = requestedDeveloperViewAsUserId(request);
  await logAction({
    workspace_id: security.resource.workspaceId,
    user_id: realActor.uid,
    username: realActor.username,
    module: "auth.developer-view-as",
    action: "developer_view_as_stopped",
    metadata: { target_user_id: targetUserId },
    trust_source: "server-authoritative",
    event_namespace: "security",
  });
  const response = NextResponse.json({ stopped: true });
  response.cookies.set(DEVELOPER_VIEW_AS_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
});
