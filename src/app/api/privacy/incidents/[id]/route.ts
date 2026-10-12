import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

import { securityIncidentUpdateSchema, type SecurityIncidentUpdateInput } from "@/features/privacy/security";
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
type IncidentResource = { ref: FirebaseFirestore.DocumentReference; snapshot: FirebaseFirestore.DocumentSnapshot };

function serializeIncident(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {};
  return { id: doc.id, workspace_id: data.workspace_id ?? "", title: data.title ?? "", incidentType: data.incidentType ?? "other", severity: data.severity ?? "low", status: data.status ?? "open", occurredAt: serializeDate(data.occurredAt), detectedAt: serializeDate(data.detectedAt) ?? "", affectedData: data.affectedData ?? "", affectedSubjects: data.affectedSubjects ?? "", estimatedSubjectsCount: typeof data.estimatedSubjectsCount === "number" ? data.estimatedSubjectsCount : null, containmentActions: data.containmentActions ?? "", resolutionNotes: data.resolutionNotes ?? null, owner: data.owner ?? null, createdAt: serializeDate(data.createdAt) ?? "", updatedAt: serializeDate(data.updatedAt) ?? "" };
}

const contract = defineSecurityContract({ schemaVersion: 1, id: "privacy.incident.update", version: 1, surface: { method: "PATCH", path: "/api/privacy/incidents/[id]" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "permission", action: "privacy.incident.manage" }, resourceScope: { kind: "workspace" }, input: { kind: "schema", schema: "privacy.incident.update-input", unknownFields: "reject" }, effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized" });
const enforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, SecurityIncidentUpdateInput, IncidentResource>(contract, {
  authenticate: ({ request }) => authenticatePrivacyUser(request),
  async parseInput({ request }) { const parsed = securityIncidentUpdateSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) throw new AppError({ code: "PRIVACY_INCIDENT_UPDATE_INVALID", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message ?? "Atualização inválida." }); return parsed.data; },
  async loadResource({ routeContext }) { const { id } = await routeContext.params; if (!id || id.includes("/")) throw new AppError({ code: "PRIVACY_INCIDENT_ID_INVALID", kind: "VALIDATION" }); const ref = dbAdmin.collection("securityIncidents").doc(id); const snapshot = await ref.get(); if (!snapshot.exists) throw new AppError({ code: "PRIVACY_INCIDENT_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Incidente não encontrado." }); return { ref, snapshot }; },
  authorize: ({ actor }) => requirePrivacyManage(actor),
  assertScope: ({ actor, resource }) => { if (resource.snapshot.get("workspace_id") !== actor.workspace_id) throw new AppError({ code: "PRIVACY_INCIDENT_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Incidente não encontrado." }); },
});

export const PATCH = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const now = new Date();
  await dbAdmin.runTransaction(async (transaction) => {
    const current = await transaction.get(resource.ref);
    if (!current.exists || current.get("workspace_id") !== actor.workspace_id) throw new AppError({ code: "PRIVACY_INCIDENT_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Incidente não encontrado." });
    const update = { status: input.status, owner: input.owner || null, resolutionNotes: input.resolutionNotes || null, updatedAt: Timestamp.fromDate(now), updatedBy: { user_id: actor.userDoc.id, username: actor.userDoc.username } };
    transaction.update(resource.ref, update);
    transaction.set(dbAdmin.collection("actionLogs").doc(), buildActionLogRecord({ workspace_id: actor.workspace_id, user_id: actor.userDoc.id, username: actor.userDoc.username, module: "privacy.incidents", action: "security_incident_updated", metadata: { target_type: "security_incident", target_id: current.id, target_name: current.get("title") ?? current.id, before_status: current.get("status") ?? null, after_status: input.status }, ttl_days: 365, trust_source: "server-authoritative", event_namespace: "privacy" }));
  });
  return NextResponse.json({ incident: serializeIncident(await resource.ref.get()) });
});
