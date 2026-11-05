import { NextResponse } from "next/server";

import { createTemplate, defaultTemplateApiDeps, listTemplates } from "@/features/documents/editor/template-api.server";
import { createEditorTemplateBodySchema, listEditorTemplatesQuerySchema } from "@/features/documents/editor/editor-api-schemas";
import { createTemplateEnforcer } from "@/features/documents/editor/template-route-security.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const listContract = defineSecurityContract({
  schemaVersion: 1,
  id: "documents.editor.templates.list",
  version: 1,
  surface: { method: "GET", path: "/api/documents/editor/templates" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "hr.documents.generate" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.editor.templates.list.query", unknownFields: "reject" },
  // Leitura paginada por índice (limit <= 25 + cursor); sem escrita nem auditoria.
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});
const listEnforcer = createTemplateEnforcer(listContract, { action: "list", schema: listEditorTemplatesQuerySchema, source: "query" });

export const GET = secureRoute({ contract: listContract, enforcer: listEnforcer }, async ({ security }) => {
  const page = await listTemplates(security.input.body, security.actor, await defaultTemplateApiDeps());
  return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
});

const createContract = defineSecurityContract({
  schemaVersion: 1,
  id: "documents.editor.templates.create",
  version: 1,
  surface: { method: "POST", path: "/api/documents/editor/templates" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "hr.documents.generate" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.editor.templates.create.body", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});
const createEnforcer = createTemplateEnforcer(createContract, { action: "create", schema: createEditorTemplateBodySchema });

export const POST = secureRoute({ contract: createContract, enforcer: createEnforcer }, async ({ security }) => {
  const template = await createTemplate(security.input.body, security.actor, await defaultTemplateApiDeps());
  return NextResponse.json({ template }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
