import { NextRequest, NextResponse } from "next/server";

import { ingestFinancialMobileUpload } from "@/features/financial/inbox/mobile-upload.server";
import { createHash } from "node:crypto";

import {
  detectMobileInboxFile,
  MOBILE_INBOX_UPLOAD_MAX_BYTES,
  MOBILE_INBOX_UPLOAD_MAX_FILES_PER_ROLE,
  MOBILE_INBOX_UPLOAD_MAX_TOTAL_BYTES,
  mobileInboxUploadMetadataSchema,
  type DetectedMobileInboxFile,
  type MobileInboxUploadMetadata,
} from "@/features/financial/inbox/mobile-upload";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { assertMobileAppAttested } from "@/lib/security/mobile-app-attestation.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };
type MobileUploadDocument = { originalFilename: string; buffer: Buffer; detected: DetectedMobileInboxFile };
type MobileUploadInput = {
  metadata: MobileInboxUploadMetadata;
  receipts: MobileUploadDocument[];
  paymentProofs: MobileUploadDocument[];
};

async function readDocument(file: FormDataEntryValue | null, label: string) {
  if (!(file instanceof File) || file.size <= 0 || file.size > MOBILE_INBOX_UPLOAD_MAX_BYTES) {
    throw new AppError({ code: "FINANCIAL_INBOX_MOBILE_FILE_SIZE_INVALID", kind: "VALIDATION", safeMessage: `${label} deve ser uma imagem ou PDF de até 15 MB.` });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = detectMobileInboxFile(buffer);
  if (!detected) {
    throw new AppError({ code: "FINANCIAL_INBOX_MOBILE_FILE_TYPE_INVALID", kind: "VALIDATION", safeMessage: `${label} deve ser uma imagem JPG, PNG, WEBP ou um PDF válido.` });
  }
  return { originalFilename: file.name, buffer, detected };
}

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.inbox.mobile-upload.create",
  version: 1,
  surface: { method: "POST", path: "/api/financial/inbox/mobile-upload" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "app.local-purchase.register" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.inbox.mobile-upload-form", unknownFields: "reject" },
  effects: { mode: "external", audit: "server-authoritative" },
  errorExposure: "sanitized",
  additionalGuarantees: ["replay-protected"],
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, MobileUploadInput, { workspaceId: string }>({
  id: "financial-inbox-mobile-upload-v1",
  guarantees: [
    "authenticated-user",
    "active-user",
    "permission-checked",
    "workspace-scoped",
    "input-validated",
    "fields-allowlisted",
    "replay-protected",
  ],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "FINANCIAL_INBOX_MOBILE_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    assertMobileAppAttested(request, actor.decoded.uid);
    if (!actor.isDefaultAdmin && actor.permissions.app?.localPurchase?.register !== true) {
      throw new AppError({
        code: "FINANCIAL_INBOX_MOBILE_UPLOAD_FORBIDDEN",
        kind: "AUTHORIZATION",
        safeMessage: "Sua conta não possui permissão para enviar notas de compras.",
      });
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      throw new AppError({ code: "FINANCIAL_INBOX_MOBILE_FORM_INVALID", kind: "VALIDATION", safeMessage: "Envio inválido." });
    }
    const allowedFields = new Set(["submissionId", "capturedAt", "note", "fundingSource", "receipt", "paymentProof"]);
    const fields = [...formData.keys()];
    const fileFields = new Set(["receipt", "paymentProof"]);
    if (fields.some((field) => !allowedFields.has(field))
      || [...allowedFields].some((field) => formData.getAll(field).length > (fileFields.has(field) ? MOBILE_INBOX_UPLOAD_MAX_FILES_PER_ROLE : 1))) {
      throw new AppError({ code: "FINANCIAL_INBOX_MOBILE_FIELDS_INVALID", kind: "VALIDATION", safeMessage: "O envio contém campos não permitidos." });
    }
    const metadataResult = mobileInboxUploadMetadataSchema.safeParse({
      submissionId: formData.get("submissionId"),
      ...(typeof formData.get("capturedAt") === "string" && formData.get("capturedAt") ? { capturedAt: formData.get("capturedAt") } : {}),
      ...(typeof formData.get("note") === "string" && formData.get("note") ? { note: formData.get("note") } : {}),
      fundingSource: formData.get("fundingSource"),
    });
    if (!metadataResult.success) {
      throw new AppError({
        code: "FINANCIAL_INBOX_MOBILE_METADATA_INVALID",
        kind: "VALIDATION",
        safeMessage: metadataResult.error.issues[0]?.message ?? "Dados do envio inválidos.",
      });
    }
    const rawReceipts = formData.getAll("receipt");
    const rawPaymentProofs = formData.getAll("paymentProof");
    if (!rawReceipts.length) {
      throw new AppError({ code: "FINANCIAL_INBOX_MOBILE_FILE_SIZE_INVALID", kind: "VALIDATION", safeMessage: "Anexe a nota da compra." });
    }
    if (metadataResult.data.fundingSource === "cash_withdrawal" && rawPaymentProofs.length) {
      throw new AppError({
        code: "FINANCIAL_INBOX_MOBILE_PAYMENT_PROOF_UNEXPECTED",
        kind: "VALIDATION",
        safeMessage: "Compra por sangria não deve incluir comprovante de pagamento.",
      });
    }
    if (metadataResult.data.fundingSource === "company_payment" && !rawPaymentProofs.length) {
      throw new AppError({ code: "FINANCIAL_INBOX_MOBILE_PAYMENT_PROOF_REQUIRED", kind: "VALIDATION", safeMessage: "Anexe o comprovante da compra normal." });
    }
    const receipts: MobileUploadDocument[] = [];
    for (const file of rawReceipts) receipts.push(await readDocument(file, "A nota"));
    const paymentProofs: MobileUploadDocument[] = [];
    for (const file of rawPaymentProofs) paymentProofs.push(await readDocument(file, "O comprovante"));
    const documents = [...receipts, ...paymentProofs];
    if (documents.reduce((sum, document) => sum + document.buffer.byteLength, 0) > MOBILE_INBOX_UPLOAD_MAX_TOTAL_BYTES) {
      throw new AppError({ code: "FINANCIAL_INBOX_MOBILE_TOTAL_SIZE_INVALID", kind: "VALIDATION", safeMessage: "Nota e comprovante devem somar no máximo 25 MB." });
    }
    // The same picture twice would pay for a second analysis page and blur which evidence plays which role.
    if (new Set(documents.map((document) => createHash("sha256").update(document.buffer).digest("hex"))).size !== documents.length) {
      throw new AppError({ code: "FINANCIAL_INBOX_MOBILE_FILE_REPEATED", kind: "VALIDATION", safeMessage: "O mesmo arquivo foi anexado mais de uma vez." });
    }
    return {
      actor,
      input: { metadata: metadataResult.data, receipts, paymentProofs },
      resource: { workspaceId: actor.workspace_id },
    };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const result = await ingestFinancialMobileUpload({ actor: security.actor, ...security.input });
  return NextResponse.json({ submission: result }, { status: result.duplicate ? 200 : 201 });
});
