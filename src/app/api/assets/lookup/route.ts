import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { dbAdmin } from "@/lib/firebase-admin";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";

export const runtime = "nodejs";
const schema = z.object({ code: z.string().trim().toUpperCase().regex(/^PAT-\d{6,12}$/) }).strict();
const contract = defineSecurityContract({ schemaVersion: 1, id: "assets.lookup", version: 1,
  surface: { method: "GET", path: "/api/assets/lookup" }, exposure: "authenticated", identity: { kind: "active-user" }, authorization: { kind: "permission", action: "assets.view" }, resourceScope: { kind: "workspace" }, input: { kind: "schema", schema: "assets.lookup-code", unknownFields: "reject" }, effects: { mode: "read", audit: "none" }, errorExposure: "sanitized" });
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, z.infer<typeof schema>, undefined>({
  id: "assets-lookup-v1", guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if (!actor.isDefaultAdmin && actor.permissions.assets?.view !== true) throw new AppError({ code: "ASSET_LOOKUP_FORBIDDEN", kind: "AUTHORIZATION" });
    const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new AppError({ code: "ASSET_LOOKUP_INVALID", kind: "VALIDATION", safeMessage: "Informe a etiqueta patrimonial completa, por exemplo PAT-000123." });
    return { actor, input: parsed.data, resource: undefined };
  },
});
export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const snapshot = await dbAdmin.collection("assets").where("workspaceId", "==", security.actor.workspace_id).where("code", "==", security.input.code).limit(2).get();
  return NextResponse.json(snapshot.docs.map((asset) => ({ id: asset.id, code: asset.get("code"), name: asset.get("name") })), { headers: { "Cache-Control": "private, no-store" } });
});
