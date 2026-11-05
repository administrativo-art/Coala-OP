import { NextResponse } from "next/server";

import { saveEditorTemplateBodySchema } from "@/features/documents/editor/editor-api-schemas";
import { defaultTemplateApiDeps, saveTemplateContent } from "@/features/documents/editor/template-api.server";
import { createTemplateEnforcer } from "@/features/documents/editor/template-route-security.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { editorErrorResponse } from "@/features/documents/editor/editor-error-response.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "documents.editor.templates.save",
  version: 1,
  surface: { method: "PUT", path: "/api/documents/editor/templates/[tid]/content" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "hr.documents.generate" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.editor.templates.save.body", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});
const enforcer = createTemplateEnforcer(contract, { action: "save", schema: saveEditorTemplateBodySchema });

export const PUT = secureRoute({ contract, enforcer }, async ({ security }) => {
  const result = await saveTemplateContent({ templateId: security.input.templateId, ...security.input.body }, security.actor, await defaultTemplateApiDeps());
  if (result.kind === "conflict") {
    return editorErrorResponse(409, "EDITOR_TEMPLATE_VERSION_CONFLICT", "O modelo foi alterado por outra sessão.", { currentVersion: result.currentVersion });
  }
  return NextResponse.json({ template: result.template }, { headers: { "Cache-Control": "no-store" } });
});
