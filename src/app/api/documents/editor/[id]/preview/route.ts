import { NextResponse } from "next/server";

import { defaultEditorApiDeps, renderPreview } from "@/features/documents/editor/editor-api.server";
import { previewEditorBodySchema } from "@/features/documents/editor/editor-api-schemas";
import { createEditorEnforcer } from "@/features/documents/editor/editor-route-security.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "documents.editor.preview",
  version: 1,
  surface: { method: "POST", path: "/api/documents/editor/[id]/preview" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "editor-document-author-or-review" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.editor.preview.body", unknownFields: "reject" },
  // Não persiste PDF nem altera o documento; o modo resolved lê dados do titular sob escopo verificado
  // e grava 1 evento de auditoria `editor.preview_resolved` (sem conteúdo) em editorDocuments/{id}/audit.
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});
const enforcer = createEditorEnforcer(contract, { action: "preview", bodySchema: previewEditorBodySchema });

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { documentId, body } = security.input;
  const result = await renderPreview({ documentId, mode: body.mode, employeeId: body.subject?.employeeId }, security.actor, await defaultEditorApiDeps());
  if (result.kind === "missing_fields") {
    return NextResponse.json(
      { error: { code: "EDITOR_MISSING_FIELDS", message: "Há campos sem valor no cadastro do titular." }, missingKeys: result.missingKeys },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
  return new NextResponse(new Uint8Array(result.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="previa.pdf"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
