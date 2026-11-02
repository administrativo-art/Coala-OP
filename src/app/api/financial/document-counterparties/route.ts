import { NextResponse, type NextRequest } from "next/server";
import { FieldPath } from "firebase-admin/firestore";
import { z } from "zod";
import { dbAdmin } from "@/lib/firebase-admin";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";

export const runtime = "nodejs";
const schema = z.object({ cursor: z.string().min(1).max(256).regex(/^[^/]+$/).optional() }).strict();
const contract = defineSecurityContract({ schemaVersion: 1, id: "financial.document-counterparties", version: 1,
  surface: { method: "GET", path: "/api/financial/document-counterparties" }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "financial-document-counterparties" }, resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.document-counterparties", unknownFields: "reject" }, effects: { mode: "read", audit: "none" }, errorExposure: "sanitized" });
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, z.infer<typeof schema>, undefined>({
  id: "financial-counterparties-v1", guarantees: ["authenticated-user", "active-user", "authorization:financial-document-counterparties", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch(rethrowServerAuthenticationFailure);
    if (!actor.isDefaultAdmin && (!actor.permissions.financial?.view || !actor.permissions.financial?.inbox?.view || !actor.permissions.financial?.inbox?.link || !actor.permissions.registration?.view)) throw new AppError({ code: "DOCUMENT_COUNTERPARTIES_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "A escolha de contraparte exige acesso aos cadastros e à classificação financeira." });
    const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new AppError({ code: "DOCUMENT_COUNTERPARTIES_INVALID", kind: "VALIDATION" });
    return { actor, input: parsed.data, resource: undefined };
  },
});
export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  let query = dbAdmin.collection("entities").orderBy(FieldPath.documentId());
  if (security.input.cursor) query = query.startAfter(security.input.cursor);
  const snapshot = await query.limit(51).get();
  const options = snapshot.docs.slice(0, 50).filter((doc) => doc.get("status") !== "inactive" && doc.get("isActive") !== false && !doc.get("isArchived"))
    .map((doc) => ({ id: doc.id, name: String(doc.get("name") ?? doc.get("razao_social") ?? doc.id) }));
  return NextResponse.json({ options, nextCursor: snapshot.size > 50 ? snapshot.docs[49].id : null }, { headers: { "Cache-Control": "private, no-store" } });
});
