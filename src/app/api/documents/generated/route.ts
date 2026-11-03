import { NextRequest, NextResponse } from "next/server";

import { serializeHrValue } from "@/features/hr/lib/server-access";
import { z } from "zod";
import { FieldPath } from "firebase-admin/firestore";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { dbAdmin } from "@/lib/firebase-admin";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  documentId: z.string().trim().min(1).max(256).regex(/^[^/]+$/).optional(),
  employeeId: z.string().trim().max(256).optional(),
  templateId: z.string().trim().max(256).optional(),
  includeDiscarded: z.enum(["true", "false"]).optional(),
}).strict();
const contract = defineSecurityContract({
  schemaVersion: 1, id: "documents.generated.list", version: 1,
  surface: { method: "GET", path: "/api/documents/generated" }, exposure: "authenticated",
  identity: { kind: "active-user" }, authorization: { kind: "custom", strategy: "generated-documents-view" },
  resourceScope: { kind: "workspace" }, input: { kind: "schema", schema: "documents.generated.query", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" }, errorExposure: "sanitized",
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, z.infer<typeof schema>, { workspaceId: string }>({
  id: "generated-documents-list-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:generated-documents-view", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch(rethrowServerAuthenticationFailure);
    if (!hasFormalizationPermission(actor.permissions, "documents.view", actor.isDefaultAdmin)) throw new AppError({ code: "GENERATED_DOCUMENTS_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para consultar documentos gerados." });
    const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new AppError({ code: "GENERATED_DOCUMENTS_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Filtro documental inválido." });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
    const access = security.actor;
    const includeSensitive = hasFormalizationPermission(
      access.permissions,
      "sensitiveData.view",
      access.isDefaultAdmin,
    );
    const includeSignatureContacts = includeSensitive || hasFormalizationPermission(
      access.permissions,
      "signatures.send",
      access.isDefaultAdmin,
    );
    const { employeeId, templateId, documentId } = security.input;
    const includeDiscarded = security.input.includeDiscarded === "true";
    let query: FirebaseFirestore.Query = dbAdmin.collection("generatedDocuments");
    if (employeeId) query = query.where("employeeId", "==", employeeId);
    if (templateId) query = query.where("templateId", "==", templateId);
    if (documentId) query = query.where(FieldPath.documentId(), "==", documentId);
    const snap = await query.limit(documentId ? 1 : 300).get();
    const documents = snap.docs
      .filter((doc) => includeDiscarded || doc.get("status") !== "discarded")
      .map((doc): Record<string, unknown> & { id: string } => {
        const data = serializeHrValue(doc.data());
        const record = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
        // Caminhos internos nunca saem. Valores manuais só são devolvidos a quem
        // possui a mesma permissão exigida para visualizar dados sensíveis.
        return {
          ...record,
          id: doc.id,
          storagePath: undefined,
          pdfAvailable: !!record.pdfStoragePath,
          pdfStoragePath: undefined,
          manualValues: includeSensitive ? record.manualValues : undefined,
          parties: Array.isArray(record.parties)
            ? record.parties.map((party) => {
                const item = party && typeof party === "object" && !Array.isArray(party)
                  ? party as Record<string, unknown>
                  : {};
                const snapshot = item.snapshot && typeof item.snapshot === "object" && !Array.isArray(item.snapshot)
                  ? item.snapshot as Record<string, unknown>
                  : {};
                return {
                  ...item,
                  snapshot: {
                    ...snapshot,
                    signatureEmail: includeSignatureContacts
                      ? snapshot.signatureEmail ?? null
                      : undefined,
                  },
                };
              })
            : [],
        };
      })
      .sort((a, b) => String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")));
    return NextResponse.json({ documents });
});
