import { NextResponse } from "next/server";

import { defaultEditorApiDeps, openDocument } from "@/features/documents/editor/editor-api.server";
import { createEditorEnforcer } from "@/features/documents/editor/editor-route-security.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "documents.editor.open",
  version: 1,
  surface: { method: "GET", path: "/api/documents/editor/[id]" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "editor-document-author-or-review" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.editor.open.params", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});
const enforcer = createEditorEnforcer(contract, { action: "view", bodySchema: null });

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const opened = await openDocument(security.input.documentId, security.actor, await defaultEditorApiDeps());
  return NextResponse.json(opened, { headers: { "Cache-Control": "private, no-store" } });
});
