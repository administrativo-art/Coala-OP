import { NextRequest, NextResponse } from "next/server";

import { clientAuditEventSchema, type ClientAuditEventInput } from "@/features/privacy/security";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { logAction } from "@/lib/log-action";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_METADATA_DEPTH = 3;
const MAX_STRING_LENGTH = 500;
type StaticRouteContext = { params: Promise<Record<string, never>> };
type WorkspaceResource = { workspaceId: string };

function getClientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
}

function cleanValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_METADATA_DEPTH) return "[truncated]";
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, MAX_STRING_LENGTH);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((entry) => cleanValue(entry, depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 50).map(([key, entry]) => [key.slice(0, 80), cleanValue(entry, depth + 1)]));
  return String(value).slice(0, MAX_STRING_LENGTH);
}

const contract = defineSecurityContract({ schemaVersion: 1, id: "audit.client-event.create", version: 1, surface: { method: "POST", path: "/api/audit/log" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "none" }, resourceScope: { kind: "workspace" }, input: { kind: "schema", schema: "audit.client-event.input", unknownFields: "reject" }, effects: { mode: "write", audit: "client-declared" }, errorExposure: "sanitized" });
const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, ClientAuditEventInput, WorkspaceResource>(contract, {
  authenticate: ({ request }) => requireUser(request).catch((cause) => { throw new AppError({ code: "AUDIT_EVENT_AUTH_REQUIRED", kind: "AUTHENTICATION", cause }); }),
  async parseInput({ request }) { const parsed = clientAuditEventSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) throw new AppError({ code: "AUDIT_EVENT_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Módulo e ação válidos são obrigatórios." }); return parsed.data; },
  loadResource: ({ actor }) => ({ workspaceId: actor.workspace_id }),
  assertScope: ({ actor, resource }) => { if (!resource.workspaceId || resource.workspaceId !== actor.workspace_id) throw new AppError({ code: "AUDIT_EVENT_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" }); },
});

export const POST = secureRoute({ contract, enforcer }, async ({ request, security }) => {
  const { actor, input, resource } = security;
  const metadata = cleanValue({ ...(input.metadata ?? {}), target_type: input.targetType ?? null, target_id: input.targetId ?? null, target_name: input.targetName ?? null }) as Record<string, unknown>;
  await logAction({ workspace_id: resource.workspaceId, user_id: actor.userDoc.id, username: actor.userDoc.username, module: input.module, action: input.action, metadata, ip_address: getClientIp(request), ttl_days: 365, trust_source: "client-declared", event_namespace: "client" });
  return NextResponse.json({ ok: true });
});
