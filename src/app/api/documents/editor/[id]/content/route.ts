import { NextResponse } from "next/server";

import { defaultEditorApiDeps, saveContent } from "@/features/documents/editor/editor-api.server";
import { saveEditorBodySchema } from "@/features/documents/editor/editor-api-schemas";
import { createEditorEnforcer } from "@/features/documents/editor/editor-route-security.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "documents.editor.save",
  version: 1,
  surface: { method: "PUT", path: "/api/documents/editor/[id]/content" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "editor-document-author-or-review" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.editor.save.body", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});
const enforcer = createEditorEnforcer(contract, { action: "edit", bodySchema: saveEditorBodySchema });

export const PUT = secureRoute({ contract, enforcer }, async ({ security }) => {
  const result = await saveContent({ documentId: security.input.documentId, ...security.input.body }, security.actor, await defaultEditorApiDeps());
  if (result.kind === "conflict") {
    return NextResponse.json(
      { error: { code: "EDITOR_VERSION_CONFLICT", message: "O documento foi alterado por outra sessão." }, currentVersion: result.currentVersion },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json({ document: result.document }, { headers: { "Cache-Control": "no-store" } });
});
