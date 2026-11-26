import { admissionRecordVisibility } from "@/lib/hr/admission-archive-lifecycle.server";
import { NextRequest, NextResponse } from "next/server";
import { FieldPath } from "firebase-admin/firestore";
import { z } from "zod";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { serializeHrValue } from "@/features/hr/lib/server-access";
import { generatedArchivePage } from "@/features/documents/central/archive-source-folders";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({
  cursor: z.string().min(1).max(256).regex(/^[^/]+$/).optional(),
  documentId: z.string().min(1).max(256).regex(/^[^/]+$/).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict().refine((input) => !input.cursor || !input.documentId);
const contract = defineSecurityContract({
  schemaVersion: 1, id: "documents.archive.generated", version: 1,
  surface: { method: "GET", path: "/api/documents/archive/generated" }, exposure: "authenticated",
  identity: { kind: "active-user" }, authorization: { kind: "custom", strategy: "generated-documents-view" },
  // Legacy records have no workspaceId. Preserve their existing documents-admin global policy.
  resourceScope: { kind: "custom", strategy: "generated-documents-legacy-global" },
  input: { kind: "schema", schema: "documents.archive.generated.query", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" }, errorExposure: "sanitized",
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, z.infer<typeof schema>, undefined>({
  id: "generated-document-archive-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:generated-documents-view", "scope:generated-documents-legacy-global", "input-validated", "fields-allowlisted"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch(rethrowServerAuthenticationFailure);
    if (!hasFormalizationPermission(actor.permissions, "documents.view", actor.isDefaultAdmin)) throw new AppError({ code: "GENERATED_ARCHIVE_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para consultar documentos gerados." });
    const input = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!input.success) throw new AppError({ code: "GENERATED_ARCHIVE_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Filtro da pasta inválido." });
    return { actor, input: input.data, resource: undefined };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { limit, cursor, documentId } = security.input;
  let query = dbAdmin.collection("generatedDocuments").orderBy(FieldPath.documentId());
  if (documentId) query = query.where(FieldPath.documentId(), "==", documentId);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.select("onboardingId", "workspaceId", "templateName", "originalName", "protocol", "status", "archiveStatus", "deletedAt", "signatureStatus", "generatedAt", "createdAt", "signedAt", "pdfStoragePath", "signedStoragePath", "signedHash", "signatureRequestId").limit(limit + 1).get();
  const records = page.docs.map((doc) => ({ id: doc.id, ...(serializeHrValue(doc.data()) as Record<string, unknown>) }));
  const visible = admissionRecordVisibility();
  const eligible = await Promise.all(records.map(async (record) => await visible(record) ? record : { id: record.id, status: "discarded" }));
  return NextResponse.json(generatedArchivePage(eligible, limit, security.actor.workspace_id), { headers: { "Cache-Control": "private, no-store" } });
});
