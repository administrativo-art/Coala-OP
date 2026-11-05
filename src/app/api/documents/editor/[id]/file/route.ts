import { NextResponse } from "next/server";

import { defaultEditorApiDeps, downloadFinalPdf } from "@/features/documents/editor/editor-api.server";
import { createEditorEnforcer } from "@/features/documents/editor/editor-route-security.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "documents.editor.file",
  version: 1,
  surface: { method: "GET", path: "/api/documents/editor/[id]/file" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "editor-document-author-or-review" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.editor.file.params", unknownFields: "reject" },
  // Não altera o documento; grava 1 evento `editor.pdf_downloaded` (ator, versão, hash; sem conteúdo) em editorDocuments/{id}/audit.
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});
const enforcer = createEditorEnforcer(contract, { action: "download", bodySchema: null });

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { pdf, fileName } = await downloadFinalPdf(security.input.documentId, security.actor, await defaultEditorApiDeps());
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
