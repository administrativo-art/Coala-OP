import { NextResponse, type NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { TIME_RECORDING_COMPLIANCE_CATEGORY, TIME_RECORDING_COMPLIANCE_FOLDER, companyDocumentFolderCode, companyDocumentEvidenceSection } from "@/lib/documents/company-document-folders";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const path = "/api/documents/company/folder" as const;
const inputSchema = z.object({
  id: z.string().uuid(),
  folderCode: z.union([z.literal(TIME_RECORDING_COMPLIANCE_FOLDER), z.null()]),
  evidenceSection: z.enum(["registration", "samples", "validation", "technical", "versions"]).nullable(),
  reason: z.string().trim().min(3).max(500),
  expected: z.object({
    folderCode: z.union([z.literal(TIME_RECORDING_COMPLIANCE_FOLDER), z.null()]),
    evidenceSection: z.enum(["registration", "samples", "validation", "technical", "versions"]).nullable(),
  }).strict(),
}).strict();
type Input = z.infer<typeof inputSchema>;
type Resource = Record<string, never>;

const contract = defineSecurityContract({
  schemaVersion: 1, id: "documents.company.folder.assign", version: 1,
  surface: { method: "POST", path }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "company-documents-manage" }, resourceScope: { kind: "none" },
  input: { kind: "schema", schema: "documents.company.folder.assign", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized",
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, Input, Resource>({
  id: "company-document-folder-assign-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:company-documents-manage", "input-validated", "fields-allowlisted"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if (!hasFormalizationPermission(actor.permissions, "companyDocuments.manage", actor.isDefaultAdmin)) {
      throw new AppError({ code: "COMPANY_DOCUMENT_FOLDER_FORBIDDEN", kind: "AUTHORIZATION" });
    }
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: "COMPANY_DOCUMENT_FOLDER_QUERY_INVALID", kind: "VALIDATION" });
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: "COMPANY_DOCUMENT_FOLDER_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Pasta ou documento inválido." });
    return { actor, input: parsed.data, resource: {} };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { id, folderCode, evidenceSection, reason } = security.input;
  if ((folderCode === null && evidenceSection !== null) || (folderCode !== null && evidenceSection === null)) {
    throw new AppError({ code: "COMPANY_DOCUMENT_SECTION_INVALID", kind: "VALIDATION", safeMessage: "Escolha uma seção válida da pasta." });
  }
  const ref = dbAdmin.collection("companyDocuments").doc(id);
  const result = await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.get("deletedAt") || snapshot.get("workspaceId") && snapshot.get("workspaceId") !== security.actor.workspace_id) {
      throw new AppError({ code: "COMPANY_DOCUMENT_FOLDER_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Documento não encontrado." });
    }
    if (folderCode && snapshot.get("category") !== TIME_RECORDING_COMPLIANCE_CATEGORY
      && !(snapshot.get("category") === "Trabalhista e RH" && typeof snapshot.get("title") === "string" && /^REP-P\s*[—–-]/i.test(snapshot.get("title").trim()))) {
      throw new AppError({ code: "COMPANY_DOCUMENT_FOLDER_CATEGORY_INVALID", kind: "VALIDATION", safeMessage: "Esta pasta aceita documentos de conformidade do sistema de ponto." });
    }
    const previousFolderCode = companyDocumentFolderCode(snapshot.data() ?? {});
    const previousEvidenceSection = companyDocumentEvidenceSection(snapshot.data() ?? {});
    if (snapshot.get("folderCode") === folderCode && snapshot.get("evidenceSection") === evidenceSection) return { changed: false, folderCode, evidenceSection };
    if (previousFolderCode !== security.input.expected.folderCode || previousEvidenceSection !== security.input.expected.evidenceSection) {
      throw new AppError({ code: "COMPANY_DOCUMENT_FOLDER_CONFLICT", kind: "CONFLICT", safeMessage: "A pasta deste documento mudou. Atualize a lista e confirme o destino novamente." });
    }
    const now = Timestamp.now();
    transaction.update(ref, { folderCode, evidenceSection, updatedAt: now });
    transaction.create(ref.collection("audit").doc(), {
      action: "DOCUMENT_FOLDER_CHANGED", previousFolderCode, folderCode, previousEvidenceSection, evidenceSection,
      reason, actorId: security.actor.decoded.uid, at: now,
    });
    return { changed: true, folderCode, evidenceSection };
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
