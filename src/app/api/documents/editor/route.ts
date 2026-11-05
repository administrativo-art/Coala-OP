import { NextResponse } from "next/server";

import { createDraft, defaultEditorApiDeps } from "@/features/documents/editor/editor-api.server";
import { createEditorBodySchema } from "@/features/documents/editor/editor-api-schemas";
import { createEditorEnforcer } from "@/features/documents/editor/editor-route-security.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
