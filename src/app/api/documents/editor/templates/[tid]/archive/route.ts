import { NextResponse } from "next/server";

import { archiveEditorTemplateBodySchema } from "@/features/documents/editor/editor-api-schemas";
import { defaultTemplateApiDeps, archiveTemplate } from "@/features/documents/editor/template-api.server";
import { createTemplateEnforcer } from "@/features/documents/editor/template-route-security.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { editorErrorResponse } from "@/features/documents/editor/editor-error-response.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "documents.editor.templates.archive",
  version: 1,
  surface: { method: "POST", path: "/api/documents/editor/templates/[tid]/archive" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  // generate + documents.review (ambos no servidor); arquiva o modelo.
  authorization: { kind: "custom", strategy: "editor-template-generate-and-review" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.editor.templates.archive.body", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});
const enforcer = createTemplateEnforcer(contract, { action: "archive", schema: archiveEditorTemplateBodySchema });

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const result = await archiveTemplate({ templateId: security.input.templateId, ...security.input.body }, security.actor, await defaultTemplateApiDeps());
  if (result.kind === "conflict") {
    return editorErrorResponse(409, "EDITOR_TEMPLATE_VERSION_CONFLICT", "O modelo foi alterado por outra sessão.", { currentVersion: result.currentVersion });
  }
  return NextResponse.json({ template: result.template }, { headers: { "Cache-Control": "no-store" } });
});
