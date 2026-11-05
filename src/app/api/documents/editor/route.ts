import { NextResponse } from "next/server";

import { createDraft, defaultEditorApiDeps, listDocuments } from "@/features/documents/editor/editor-api.server";
import { createEditorBodySchema, listEditorDocumentsQuerySchema } from "@/features/documents/editor/editor-api-schemas";
import { defaultEditorDocumentListDeps } from "@/features/documents/editor/document-store.server";
import { createEditorEnforcer } from "@/features/documents/editor/editor-route-security.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const listContract = defineSecurityContract({
  schemaVersion: 1,
  id: "documents.editor.list",
  version: 1,
  surface: { method: "GET", path: "/api/documents/editor" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "hr.documents.generate" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.editor.list.query", unknownFields: "reject" },
  // Leitura paginada por índice (limit <= 25 + cursor); quem não tem review só enxerga os próprios.
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});
const listEnforcer = createEditorEnforcer(listContract, { action: "list", bodySchema: listEditorDocumentsQuerySchema, source: "query" });

export const GET = secureRoute({ contract: listContract, enforcer: listEnforcer }, async ({ security }) => {
  const page = await listDocuments(security.input.body, security.actor, { store: await defaultEditorDocumentListDeps() });
  return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
});

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "documents.editor.create",
  version: 1,
  surface: { method: "POST", path: "/api/documents/editor" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "hr.documents.generate" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.editor.create.body", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});
const enforcer = createEditorEnforcer(contract, { action: "create", bodySchema: createEditorBodySchema });

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const document = await createDraft(security.input.body, security.actor, await defaultEditorApiDeps());
  return NextResponse.json({ document }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
