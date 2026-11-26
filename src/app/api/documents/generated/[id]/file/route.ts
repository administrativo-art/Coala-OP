import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "firebase-admin/storage";
import { z } from "zod";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { historicalSignatureEmployeeId } from "@/features/privacy/signature-person-history";
import { uploadAccessFilter } from "@/features/documents/central/upload-access.server";
import { canViewHr } from "@/features/hr/lib/server-access";
import { generatedFileReference, assertGeneratedSignedReference, GeneratedArchiveFileError } from "@/features/documents/central/generated-archive-file";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const paramsSchema = z.object({ id: z.string().min(1).max(256).regex(/^[^/]+$/) }).strict();
const querySchema = z.object({ format: z.enum(["pdf", "docx", "signed-pdf"]).default("docx") }).strict();
const contract = defineSecurityContract({
  schemaVersion: 1, id: "documents.generated.file", version: 1,
  surface: { method: "GET", path: "/api/documents/generated/[id]/file" }, exposure: "authenticated",
  identity: { kind: "active-user" }, authorization: { kind: "custom", strategy: "generated-document-artifact-access" },
  resourceScope: { kind: "custom", strategy: "generated-documents-legacy-global" },
  input: { kind: "schema", schema: "documents.generated.file.input", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" }, errorExposure: "sanitized",
});
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, { id: string; format: "pdf" | "docx" | "signed-pdf" }, undefined>({
  id: "generated-file-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:generated-document-artifact-access", "scope:generated-documents-legacy-global", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch(rethrowServerAuthenticationFailure);
    if (!hasFormalizationPermission(actor.permissions, "documents.view", actor.isDefaultAdmin)) throw new AppError({ code: "GENERATED_FILE_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para abrir documentos gerados." });
    const params = paramsSchema.safeParse(await routeContext.params);
    const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!params.success || !query.success) throw new AppError({ code: "GENERATED_FILE_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Pedido de arquivo inválido." });
    if (query.data.format === "signed-pdf" && !hasFormalizationPermission(actor.permissions, "signatures.view", actor.isDefaultAdmin)) throw new AppError({ code: "GENERATED_SIGNED_FILE_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para abrir o PDF assinado." });
    return { actor, input: { ...params.data, ...query.data }, resource: undefined };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { id, format } = security.input;
  const document = await dbAdmin.collection("generatedDocuments").doc(id).get();
  if (!document.exists) throw new AppError({ code: "GENERATED_FILE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Documento gerado não encontrado." });
  const record = document.data()!;
  if (record.workspaceId != null && record.workspaceId !== security.actor.workspace_id) throw new AppError({ code: "GENERATED_FILE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Documento gerado não encontrado." });
  if (typeof record.onboardingId === "string" && record.onboardingId) {
    const parent = await hrDbAdmin.collection("onboardingProcesses").doc(record.onboardingId).get();
    if (parent.get("status") === "cancelled" || parent.get("documentDiscard")) throw new AppError({ code: "GENERATED_FILE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Documento gerado não encontrado." });
  }
  let reference;
  try {
    reference = generatedFileReference(id, record, format);
    if (reference.signed) {
      const request = await hrDbAdmin.collection("hrSignatureRequests").doc(reference.requestId!).get();
      const requestData = request.data() ?? {};
      assertGeneratedSignedReference(id, record, requestData);
      const employeeId = historicalSignatureEmployeeId(requestData, record);
      if (employeeId) {
        const documentId = record.employeeDocumentId;
        if (typeof documentId !== "string" || !documentId || documentId.includes("/")) throw new GeneratedArchiveFileError("incomplete_signature");
        const archived = await hrDbAdmin.collection("employeeDocuments").doc(documentId).get();
        const data = archived.data() ?? {};
        if (!archived.exists || data.deletedAt || data.employeeId !== employeeId || data.signatureRequestId !== reference.requestId || data.storagePath !== reference.path || data.contentHash !== reference.hash) throw new GeneratedArchiveFileError("incomplete_signature");
        const actor = security.actor;
        const allowed = canViewHr(actor.permissions, actor.isDefaultAdmin) && await (await uploadAccessFilter(actor))(data);
        if (!allowed) throw new AppError({ code: "GENERATED_SIGNED_EMPLOYEE_FILE_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Documento indisponível para seu acesso." });
      }
    }
  } catch (cause) {
    if (!(cause instanceof GeneratedArchiveFileError)) throw cause;
    throw new AppError({ code: "GENERATED_FILE_NOT_READY", kind: cause.reason === "incomplete_signature" ? "CONFLICT" : "NOT_FOUND", safeMessage: cause.reason === "incomplete_signature" ? "O PDF assinado ainda não tem arquivamento íntegro. Confira a assinatura antes de abrir." : "Arquivo indisponível para este documento." });
  }
  const [buffer] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(reference.path).download();
  if (reference.signed && (buffer.subarray(0, 4).toString() !== "%PDF" || createHash("sha256").update(buffer).digest("hex") !== reference.hash)) throw new AppError({ code: "GENERATED_SIGNED_FILE_INVALID", kind: "CONFLICT", safeMessage: "Não foi possível conferir a integridade do PDF assinado." });
  const base = String(record.originalName ?? "documento.docx").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.docx$/i, "");
  const pdf = format !== "docx";
  const fileName = `${base}${reference.signed ? "_assinado" : ""}.${pdf ? "pdf" : "docx"}`;
  return new NextResponse(new Uint8Array(buffer), { headers: {
    "Content-Type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `${pdf ? "inline" : "attachment"}; filename="${fileName}"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
});
