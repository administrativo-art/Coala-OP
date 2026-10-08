import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

import { securityIncidentCreateSchema, type SecurityIncidentCreateInput } from "@/features/privacy/security";
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

function serializeIncident(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {};
  return { id: doc.id, workspace_id: data.workspace_id ?? "", title: data.title ?? "", incidentType: data.incidentType ?? "other", severity: data.severity ?? "low", status: data.status ?? "open", occurredAt: serializeDate(data.occurredAt), detectedAt: serializeDate(data.detectedAt) ?? "", affectedData: data.affectedData ?? "", affectedSubjects: data.affectedSubjects ?? "", estimatedSubjectsCount: typeof data.estimatedSubjectsCount === "number" ? data.estimatedSubjectsCount : null, containmentActions: data.containmentActions ?? "", resolutionNotes: data.resolutionNotes ?? null, owner: data.owner ?? null, createdAt: serializeDate(data.createdAt) ?? "", updatedAt: serializeDate(data.updatedAt) ?? "" };
}

const listContract = defineSecurityContract({ schemaVersion: 1, id: "privacy.incident.list", version: 1, surface: { method: "GET", path: "/api/privacy/incidents" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "permission", action: "privacy.incident.view" }, resourceScope: { kind: "workspace" }, input: { kind: "none" }, effects: { mode: "read", audit: "none" }, errorExposure: "sanitized" });
const createContract = defineSecurityContract({ schemaVersion: 1, id: "privacy.incident.create", version: 1, surface: { method: "POST", path: "/api/privacy/incidents" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "permission", action: "privacy.incident.manage" }, resourceScope: { kind: "workspace" }, input: { kind: "schema", schema: "privacy.incident.create-input", unknownFields: "reject" }, effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized" });
const workspace = (actor: ServerUserContext): WorkspaceResource => ({ workspaceId: actor.workspace_id });
const assertWorkspace = ({ actor, resource }: { actor: ServerUserContext; resource: WorkspaceResource }) => { if (!resource.workspaceId || resource.workspaceId !== actor.workspace_id) throw new AppError({ code: "PRIVACY_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" }); };
const listEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, undefined, WorkspaceResource>(listContract, { authenticate: ({ request }) => authenticatePrivacyUser(request), loadResource: ({ actor }) => workspace(actor), authorize: ({ actor }) => requirePrivacyView(actor), assertScope: assertWorkspace });
const createEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, SecurityIncidentCreateInput, WorkspaceResource>(createContract, {
  authenticate: ({ request }) => authenticatePrivacyUser(request),
  async parseInput({ request }) { const parsed = securityIncidentCreateSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) throw new AppError({ code: "PRIVACY_INCIDENT_INPUT_INVALID", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message ?? "Incidente inválido." }); return parsed.data; },
  loadResource: ({ actor }) => workspace(actor), authorize: ({ actor }) => requirePrivacyManage(actor), assertScope: assertWorkspace,
});

export const GET = secureRoute({ contract: listContract, enforcer: listEnforcer }, async ({ security }) => {
  const snapshot = await dbAdmin.collection("securityIncidents").where("workspace_id", "==", security.resource.workspaceId).limit(100).get();
  return NextResponse.json({ incidents: snapshot.docs.map(serializeIncident).sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))) });
});

export const POST = secureRoute({ contract: createContract, enforcer: createEnforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const now = new Date();
  const ref = dbAdmin.collection("securityIncidents").doc();
  const payload = { workspace_id: resource.workspaceId, title: input.title, incidentType: input.incidentType, severity: input.severity, status: "open", occurredAt: input.occurredAt ? Timestamp.fromDate(new Date(`${input.occurredAt}T12:00:00Z`)) : null, detectedAt: Timestamp.fromDate(now), affectedData: input.affectedData, affectedSubjects: input.affectedSubjects ?? "", estimatedSubjectsCount: input.estimatedSubjectsCount ?? null, containmentActions: input.containmentActions, resolutionNotes: null, owner: input.owner || null, createdAt: Timestamp.fromDate(now), updatedAt: Timestamp.fromDate(now), ttl: ttlFrom(now, 365 * 5), createdBy: { user_id: actor.userDoc.id, username: actor.userDoc.username } };
  await dbAdmin.runTransaction(async (transaction) => {
    transaction.set(ref, payload);
    transaction.set(dbAdmin.collection("actionLogs").doc(), buildActionLogRecord({ workspace_id: resource.workspaceId, user_id: actor.userDoc.id, username: actor.userDoc.username, module: "privacy.incidents", action: "security_incident_created", metadata: { target_type: "security_incident", target_id: ref.id, target_name: input.title, incident_type: input.incidentType, severity: input.severity }, ttl_days: 365, trust_source: "server-authoritative", event_namespace: "privacy" }));
  });
  return NextResponse.json({ incident: serializeIncident(await ref.get()) }, { status: 201 });
});
