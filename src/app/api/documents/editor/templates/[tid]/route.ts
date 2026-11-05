import { NextResponse } from "next/server";

import { defaultTemplateApiDeps, openTemplate } from "@/features/documents/editor/template-api.server";
import { createTemplateEnforcer } from "@/features/documents/editor/template-route-security.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "documents.editor.templates.open",
  version: 1,
  surface: { method: "GET", path: "/api/documents/editor/templates/[tid]" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "hr.documents.generate" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.editor.templates.open.params", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});
const enforcer = createTemplateEnforcer(contract, { action: "open", schema: null });

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const opened = await openTemplate(security.input.templateId, security.actor, await defaultTemplateApiDeps());
  return NextResponse.json(opened, { headers: { "Cache-Control": "private, no-store" } });
});
