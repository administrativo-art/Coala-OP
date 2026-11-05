import { NextResponse } from "next/server";

import { defaultEditorApiDeps, finalizeDocument } from "@/features/documents/editor/editor-api.server";
import { finalizeEditorBodySchema } from "@/features/documents/editor/editor-api-schemas";
import { createEditorEnforcer } from "@/features/documents/editor/editor-route-security.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { editorErrorResponse } from "@/features/documents/editor/editor-error-response.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "documents.editor.finalize",
  version: 1,
  surface: { method: "POST", path: "/api/documents/editor/[id]/finalize" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "editor-document-generate-and-review" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.editor.finalize.body", unknownFields: "reject" },
  effects: { mode: "external", audit: "server-authoritative" },
  errorExposure: "sanitized",
});
const enforcer = createEditorEnforcer(contract, { action: "finalize", bodySchema: finalizeEditorBodySchema });

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { documentId, body } = security.input;
  const result = await finalizeDocument(
    { documentId, clientRequestId: body.clientRequestId, expectedContentVersion: body.expectedContentVersion, employeeId: body.subject?.employeeId },
    security.actor,
    await defaultEditorApiDeps(),
  );
  const headers = { "Cache-Control": "no-store" };
  if (result.kind === "conflict") {
    return editorErrorResponse(409, "EDITOR_VERSION_CONFLICT", "O documento foi alterado por outra sessão.", { currentVersion: result.currentVersion }, headers);
  }
  if (result.kind === "missing_fields") {
    return editorErrorResponse(422, "EDITOR_MISSING_FIELDS", "Há campos sem valor no cadastro do titular.", { missingKeys: result.missingKeys }, headers);
  }
  return NextResponse.json({ document: result.document, replayed: result.replayed }, { headers });
});
