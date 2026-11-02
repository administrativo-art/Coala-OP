import { NextRequest, NextResponse } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { dbAdmin } from "@/lib/firebase-admin";
import { canAccessUnit } from "@/lib/unit-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contract = defineSecurityContract({ schemaVersion: 1, id: "documents.company.units", version: 1,
  surface: { method: "GET", path: "/api/documents/company/units" }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "company-documents-view-and-unit" }, resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.company.units", unknownFields: "reject" }, effects: { mode: "read", audit: "none" }, errorExposure: "sanitized" });
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, undefined, undefined>({
  id: "company-units-v1", guarantees: ["authenticated-user", "active-user", "authorization:company-documents-view-and-unit", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch(rethrowServerAuthenticationFailure);
    if (!hasFormalizationPermission(actor.permissions, "companyDocuments.view", actor.isDefaultAdmin)) throw new AppError({ code: "COMPANY_UNITS_FORBIDDEN", kind: "AUTHORIZATION" });
    if (request.nextUrl.searchParams.size) throw new AppError({ code: "COMPANY_UNITS_INPUT_INVALID", kind: "VALIDATION" });
    return { actor, input: undefined, resource: undefined };
  },
});
export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
    const actor = security.actor;
    const snap = await dbAdmin.collection("dp_units").limit(500).get();
    const names = new Set<string>();
    const options: Array<{ id: string; name: string }> = [];
    for (const doc of snap.docs) {
      if (doc.get("isArchived") === true) continue;
      if (!canAccessUnit(actor.userDoc, doc.id, { isDefaultAdmin: actor.isDefaultAdmin })) continue;
      const name = doc.get("name");
      if (typeof name === "string" && name.trim()) { names.add(name.trim()); options.push({ id: doc.id, name: name.trim() }); }
    }
    return NextResponse.json({ units: [...names].sort((a, b) => a.localeCompare(b, "pt-BR")), options });
});
