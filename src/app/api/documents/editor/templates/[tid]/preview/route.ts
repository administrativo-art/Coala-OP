import { NextResponse } from "next/server";

import { defaultTemplateApiDeps, renderTemplatePreview } from "@/features/documents/editor/template-api.server";
import { createTemplateEnforcer } from "@/features/documents/editor/template-route-security.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "documents.editor.templates.preview",
  version: 1,
  surface: { method: "POST", path: "/api/documents/editor/templates/[tid]/preview" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "hr.documents.generate" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.editor.templates.preview.params", unknownFields: "reject" },
  // Prévia de exemplo: sem titular, sem persistir o PDF e sem auditoria (nenhum dado pessoal é lido).
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});
const enforcer = createTemplateEnforcer(contract, { action: "preview", schema: null });

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const pdf = await renderTemplatePreview(security.input.templateId, security.actor, await defaultTemplateApiDeps());
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="previa-modelo.pdf"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
