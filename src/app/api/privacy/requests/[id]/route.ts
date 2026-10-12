import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

import { privacyRequestUpdateSchema, type PrivacyRequestUpdateInput } from "@/features/privacy/security";
import { type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { buildActionLogRecord } from "@/lib/log-action";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { authenticatePrivacyUser, requirePrivacyManage, serializeDate } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type RequestResource = { ref: FirebaseFirestore.DocumentReference; snapshot: FirebaseFirestore.DocumentSnapshot };

function serializeRequest(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {};
  return { id: doc.id, workspace_id: data.workspace_id ?? "", subjectName: data.subjectName ?? "", subjectEmail: data.subjectEmail ?? "", subjectType: data.subjectType ?? "other", requestType: data.requestType ?? "other", origin: data.origin ?? "other", description: data.description ?? "", status: data.status ?? "open", owner: data.owner ?? null, response: data.response ?? null, dueAt: serializeDate(data.dueAt), completedAt: serializeDate(data.completedAt), createdAt: serializeDate(data.createdAt) ?? "", updatedAt: serializeDate(data.updatedAt) ?? "" };
}

const contract = defineSecurityContract({ schemaVersion: 1, id: "privacy.request.update", version: 1, surface: { method: "PATCH", path: "/api/privacy/requests/[id]" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "permission", action: "privacy.request.manage" }, resourceScope: { kind: "workspace" }, input: { kind: "schema", schema: "privacy.request.update-input", unknownFields: "reject" }, effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized" });
const enforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, PrivacyRequestUpdateInput, RequestResource>(contract, {
  authenticate: ({ request }) => authenticatePrivacyUser(request),
  async parseInput({ request }) { const parsed = privacyRequestUpdateSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) throw new AppError({ code: "PRIVACY_REQUEST_UPDATE_INVALID", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message ?? "Atualização inválida." }); return parsed.data; },
  async loadResource({ routeContext }) { const { id } = await routeContext.params; if (!id || id.includes("/")) throw new AppError({ code: "PRIVACY_REQUEST_ID_INVALID", kind: "VALIDATION" }); const ref = dbAdmin.collection("privacyRequests").doc(id); const snapshot = await ref.get(); if (!snapshot.exists) throw new AppError({ code: "PRIVACY_REQUEST_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Pedido não encontrado." }); return { ref, snapshot }; },
  authorize: ({ actor }) => requirePrivacyManage(actor),
  assertScope: ({ actor, resource }) => { if (resource.snapshot.get("workspace_id") !== actor.workspace_id) throw new AppError({ code: "PRIVACY_REQUEST_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Pedido não encontrado." }); },
});

export const PATCH = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const now = new Date();
  await dbAdmin.runTransaction(async (transaction) => {
    const current = await transaction.get(resource.ref);
    if (!current.exists || current.get("workspace_id") !== actor.workspace_id) throw new AppError({ code: "PRIVACY_REQUEST_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Pedido não encontrado." });
    const update = { status: input.status, owner: input.owner || null, response: input.response || null, completedAt: input.status === "completed" || input.status === "rejected" ? Timestamp.fromDate(now) : null, updatedAt: Timestamp.fromDate(now), updatedBy: { user_id: actor.userDoc.id, username: actor.userDoc.username } };
    transaction.update(resource.ref, update);
    transaction.set(dbAdmin.collection("actionLogs").doc(), buildActionLogRecord({ workspace_id: actor.workspace_id, user_id: actor.userDoc.id, username: actor.userDoc.username, module: "privacy.requests", action: "privacy_request_updated", metadata: { target_type: "privacy_request", target_id: current.id, target_name: current.get("subjectName") ?? current.id, before_status: current.get("status") ?? null, after_status: input.status }, ttl_days: 365, trust_source: "server-authoritative", event_namespace: "privacy" }));
  });
  return NextResponse.json({ request: serializeRequest(await resource.ref.get()) });
});
