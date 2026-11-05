import { NextResponse } from "next/server";

import { useEditorTemplateBodySchema } from "@/features/documents/editor/editor-api-schemas";
import { defaultTemplateApiDeps, useTemplate } from "@/features/documents/editor/template-api.server";
import { createTemplateEnforcer } from "@/features/documents/editor/template-route-security.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "documents.editor.templates.use",
  version: 1,
  surface: { method: "POST", path: "/api/documents/editor/templates/[tid]/use" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "hr.documents.generate" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.editor.templates.use.body", unknownFields: "reject" },
  // Cria um rascunho sem titular a partir da versão publicada, na mesma transação da auditoria.
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});
const enforcer = createTemplateEnforcer(contract, { action: "use", schema: useEditorTemplateBodySchema });

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const result = await useTemplate({ templateId: security.input.templateId, ...security.input.body }, security.actor, await defaultTemplateApiDeps());
  if (result.kind === "published_version_changed") {
    return NextResponse.json(
      { error: { code: "EDITOR_TEMPLATE_PUBLISHED_VERSION_CHANGED", message: "A versão publicada do modelo mudou." }, publishedVersion: result.publishedVersion },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json({ document: result.document }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
