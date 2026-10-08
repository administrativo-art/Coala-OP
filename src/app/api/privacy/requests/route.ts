import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

import { privacyRequestCreateSchema, type PrivacyRequestCreateInput } from "@/features/privacy/security";
import { type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { buildActionLogRecord } from "@/lib/log-action";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { authenticatePrivacyUser, requirePrivacyManage, requirePrivacyView, serializeDate, ttlFrom } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };
type WorkspaceResource = { workspaceId: string };

function serializeRequest(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {};
  return { id: doc.id, workspace_id: data.workspace_id ?? "", subjectName: data.subjectName ?? "", subjectEmail: data.subjectEmail ?? "", subjectType: data.subjectType ?? "other", requestType: data.requestType ?? "other", origin: data.origin ?? "other", description: data.description ?? "", status: data.status ?? "open", owner: data.owner ?? null, response: data.response ?? null, dueAt: serializeDate(data.dueAt), completedAt: serializeDate(data.completedAt), createdAt: serializeDate(data.createdAt) ?? "", updatedAt: serializeDate(data.updatedAt) ?? "" };
}

const listContract = defineSecurityContract({ schemaVersion: 1, id: "privacy.request.list", version: 1, surface: { method: "GET", path: "/api/privacy/requests" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "permission", action: "privacy.request.view" }, resourceScope: { kind: "workspace" }, input: { kind: "none" }, effects: { mode: "read", audit: "none" }, errorExposure: "sanitized" });
const createContract = defineSecurityContract({ schemaVersion: 1, id: "privacy.request.create", version: 1, surface: { method: "POST", path: "/api/privacy/requests" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "permission", action: "privacy.request.manage" }, resourceScope: { kind: "workspace" }, input: { kind: "schema", schema: "privacy.request.create-input", unknownFields: "reject" }, effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized" });

const workspace = (actor: ServerUserContext): WorkspaceResource => ({ workspaceId: actor.workspace_id });
const assertWorkspace = ({ actor, resource }: { actor: ServerUserContext; resource: WorkspaceResource }) => {
  if (!resource.workspaceId || resource.workspaceId !== actor.workspace_id) throw new AppError({ code: "PRIVACY_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" });
};
const listEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, undefined, WorkspaceResource>(listContract, {
  authenticate: ({ request }) => authenticatePrivacyUser(request), loadResource: ({ actor }) => workspace(actor), authorize: ({ actor }) => requirePrivacyView(actor), assertScope: assertWorkspace,
});
const createEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, PrivacyRequestCreateInput, WorkspaceResource>(createContract, {
  authenticate: ({ request }) => authenticatePrivacyUser(request),
  async parseInput({ request }) { const parsed = privacyRequestCreateSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) throw new AppError({ code: "PRIVACY_REQUEST_INPUT_INVALID", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message ?? "Pedido inválido." }); return parsed.data; },
  loadResource: ({ actor }) => workspace(actor), authorize: ({ actor }) => requirePrivacyManage(actor), assertScope: assertWorkspace,
});

export const GET = secureRoute({ contract: listContract, enforcer: listEnforcer }, async ({ security }) => {
  const snapshot = await dbAdmin.collection("privacyRequests").where("workspace_id", "==", security.resource.workspaceId).limit(100).get();
  const requests = snapshot.docs.map(serializeRequest).sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  return NextResponse.json({ requests });
});

export const POST = secureRoute({ contract: createContract, enforcer: createEnforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const now = new Date();
  const ref = dbAdmin.collection("privacyRequests").doc();
  const payload = { workspace_id: resource.workspaceId, subjectName: input.subjectName, subjectEmail: input.subjectEmail?.toLowerCase() ?? "", subjectType: input.subjectType, requestType: input.requestType, origin: input.origin, description: input.description, status: "open", owner: input.owner || null, response: null, dueAt: input.dueAt ? Timestamp.fromDate(new Date(`${input.dueAt}T12:00:00Z`)) : null, completedAt: null, createdAt: Timestamp.fromDate(now), updatedAt: Timestamp.fromDate(now), ttl: ttlFrom(now, 365 * 3), createdBy: { user_id: actor.userDoc.id, username: actor.userDoc.username } };
  const auditRef = dbAdmin.collection("actionLogs").doc();
  await dbAdmin.runTransaction(async (transaction) => {
    transaction.set(ref, payload);
    transaction.set(auditRef, buildActionLogRecord({ workspace_id: resource.workspaceId, user_id: actor.userDoc.id, username: actor.userDoc.username, module: "privacy.requests", action: "privacy_request_created", metadata: { target_type: "privacy_request", target_id: ref.id, target_name: input.subjectName, request_type: input.requestType, subject_type: input.subjectType }, ttl_days: 365, trust_source: "server-authoritative", event_namespace: "privacy" }));
  });
  return NextResponse.json({ request: serializeRequest(await ref.get()) }, { status: 201 });
});
