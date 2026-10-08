import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };
type WorkspaceResource = { workspaceId: string };

function canViewAudit(context: ServerUserContext) {
  return Boolean(context.isDefaultAdmin || context.permissions.settings.manageUsers || context.permissions.settings.manageProfiles);
}

function serializeDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "object" && "toDate" in (value as Record<string, unknown>)) { const date = (value as { toDate?: () => Date }).toDate?.(); return date ? date.toISOString() : null; }
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const contract = defineSecurityContract({ schemaVersion: 1, id: "audit.event.list", version: 1, surface: { method: "GET", path: "/api/audit/logs" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "permission", action: "audit.event.view" }, resourceScope: { kind: "workspace" }, input: { kind: "none" }, effects: { mode: "read", audit: "none" }, errorExposure: "sanitized" });
const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, undefined, WorkspaceResource>(contract, {
  authenticate: ({ request }) => requireUser(request).catch((cause) => { throw new AppError({ code: "AUDIT_VIEW_AUTH_REQUIRED", kind: "AUTHENTICATION", cause }); }),
  loadResource: ({ actor }) => ({ workspaceId: actor.workspace_id }),
  authorize: ({ actor }) => { if (!canViewAudit(actor)) throw new AppError({ code: "AUDIT_VIEW_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para visualizar auditoria." }); },
  assertScope: ({ actor, resource }) => { if (!resource.workspaceId || resource.workspaceId !== actor.workspace_id) throw new AppError({ code: "AUDIT_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" }); },
});

export const GET = secureRoute({ contract, enforcer }, async ({ request, security }) => {
  const params = request.nextUrl.searchParams;
  const moduleFilter = params.get("module")?.trim().toLowerCase();
  const actionFilter = params.get("action")?.trim().toLowerCase();
  const userFilter = params.get("userId")?.trim();
  const searchFilter = params.get("search")?.trim().toLowerCase();
  const requestedLimit = Number(params.get("limit") ?? 100);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 100, 20), 200);
  const snapshot = await dbAdmin.collection("actionLogs").where("workspace_id", "==", security.resource.workspaceId).limit(500).get();
  const logs = snapshot.docs.map((doc) => {
    const data = doc.data();
    return { id: doc.id, workspace_id: typeof data.workspace_id === "string" ? data.workspace_id : null, user_id: typeof data.user_id === "string" ? data.user_id : null, username: typeof data.username === "string" ? data.username : null, module: typeof data.module === "string" ? data.module : "", action: typeof data.action === "string" ? data.action : "", metadata: data.metadata && typeof data.metadata === "object" ? data.metadata : {}, ip_address: typeof data.ip_address === "string" ? data.ip_address : null, timestamp: serializeDate(data.timestamp), ttl: serializeDate(data.ttl), trust_source: data.trust_source === "client-declared" || data.trust_source === "server-authoritative" ? data.trust_source : null, event_namespace: typeof data.event_namespace === "string" ? data.event_namespace : null };
  }).sort((left, right) => String(right.timestamp ?? "").localeCompare(String(left.timestamp ?? ""))).filter((log) => {
    if (moduleFilter && !log.module.toLowerCase().includes(moduleFilter)) return false;
    if (actionFilter && !log.action.toLowerCase().includes(actionFilter)) return false;
    if (userFilter && log.user_id !== userFilter) return false;
    if (searchFilter && ![log.username, log.module, log.action, log.ip_address, JSON.stringify(log.metadata)].filter(Boolean).join(" ").toLowerCase().includes(searchFilter)) return false;
    return true;
  }).slice(0, limit);
  return NextResponse.json({ logs });
});
