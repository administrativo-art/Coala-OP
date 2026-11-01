import "server-only";

import { createHash } from "node:crypto";
import { getStorage } from "firebase-admin/storage";

import { applyCoalaLetterheadToPdf } from "@/features/hr/documents/letterhead-pdf.server";
import { resolveCompanyDocumentSignatory } from "@/features/hr/documents/company-document-signatory.server";
import { allocateIdempotentDocumentProtocol } from "@/features/hr/documents/document-protocol.server";
import { resolveDocumentLegalEntitySnapshot } from "@/features/hr/documents/legal-entity-snapshot.server";
import { archiveAutentiqueSignedDocument, reconcileGeneratedDocumentStandaloneSignature, sendGeneratedDocumentForStandaloneSignature } from "@/features/hr/documents/signature-workflow.server";
import { renderAssetCustodyTermPdf, safeAssetCustodyTermText } from "@/features/assets/custody-term-pdf";
import { createManualTask } from "@/features/tasks/lib/server";
import type { ServerUserContext } from "@/lib/auth-server";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { AppError } from "@/lib/observability/app-error";
import { resolveActiveEmployee } from "@/features/assets/references.server";

const TEMPLATE_ID = "system-asset-custody-term";
const DOCUMENT_TYPE = "ASSET_CUSTODY_TERM";
const PURPOSE = "asset_custody_term";

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const generatedId = (transferId: string) => `asset_custody_term_${createHash("sha256").update(transferId).digest("hex").slice(0, 32)}`;

async function createFailureTask(context: ServerUserContext, transferId: string, asset: Record<string, any>) {
  try {
    const task = await createManualTask({ context, input: {
      title: `Concluir termo de posse · ${text(asset.code) ?? "Patrimônio"}`,
      description: "A transferência de posse foi registrada, mas o termo não foi concluído. Revise a configuração institucional e tente gerar ou reconciliar novamente.",
      priority: "high", originLink: "/dashboard/assets", idempotencyKey: `asset-custody-term-${transferId}`,
    } });
    return task.id;
  } catch {
    return null;
  }
}

export async function ensureAssetCustodyTerm(params: { context: ServerUserContext; assetId: string; transferId: string }) {
  const transferRef = dbAdmin.collection("assetCustodyTransfers").doc(params.transferId);
  const assetRef = dbAdmin.collection("assets").doc(params.assetId);
  const [transferSnap, assetSnap] = await Promise.all([transferRef.get(), assetRef.get()]);
  if (!transferSnap.exists || transferSnap.get("assetId") !== params.assetId || !assetSnap.exists) throw new AppError({ code: "ASSET_CUSTODY_TRANSFER_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Transferência de posse não encontrada." });
  if ((transferSnap.get("workspaceId") ?? assetSnap.get("workspaceId")) !== params.context.workspace_id) throw new AppError({ code: "ASSET_CUSTODY_TERM_FORBIDDEN", kind: "AUTHORIZATION" });
  const toHolder = transferSnap.get("toHolder") as Record<string, unknown> | undefined;
  const employeeId = text(toHolder?.holderId);
  if (toHolder?.holderType !== "employee" || !employeeId || transferSnap.get("generateTerm") !== true) throw new AppError({ code: "ASSET_CUSTODY_TERM_NOT_APPLICABLE", kind: "VALIDATION", safeMessage: "Esta transferência não exige termo para colaborador." });
  const failConfiguration = async (error: AppError): Promise<never> => {
    const taskId = await createFailureTask(params.context, params.transferId, assetSnap.data() ?? {});
    const now = new Date().toISOString();
    await transferRef.set({ status: "term_generation_failed", termGenerationError: error.safeMessage, followUp: { status: "pending", taskId, kind: "asset_custody_term" }, updatedAt: now }, { merge: true });
    throw error;
  };
  try {
    await resolveActiveEmployee(params.context.workspace_id, employeeId);
  } catch {
    return failConfiguration(new AppError({ code: "ASSET_CUSTODY_TERM_EMPLOYEE_NOT_FOUND", kind: "VALIDATION", safeMessage: "O colaborador da transferência não foi encontrado, está inativo ou pertence a outro ambiente." }));
  }
  const employee = await dbAdmin.collection("users").doc(employeeId).get();
  const employeeName = text(employee.get("username")) ?? text(toHolder.holderNameSnapshot) ?? "Colaborador";
  const employeeEmail = text(employee.get("documentSignatureEmail")) ?? text(employee.get("email"));
  if (!employeeEmail) return failConfiguration(new AppError({ code: "ASSET_CUSTODY_TERM_EMPLOYEE_EMAIL", kind: "VALIDATION", safeMessage: "Configure o e-mail de assinatura do colaborador." }));
  const generatedDocumentId = generatedId(params.transferId);
  const generatedRef = dbAdmin.collection("generatedDocuments").doc(generatedDocumentId);
  const currentStatus = String(transferSnap.get("status") ?? "");
  const existingRequestId = text(transferSnap.get("signatureRequestId"));
  if (currentStatus === "signed" && existingRequestId) return { generatedDocumentId, signatureRequestId: existingRequestId, status: "signed", reused: true };
  if (currentStatus === "awaiting_signature" && existingRequestId) return { generatedDocumentId, signatureRequestId: existingRequestId, status: "awaiting_signature", reused: true };
  if (["rejected", "expired", "cancelled"].includes(currentStatus)) throw new AppError({ code: "ASSET_CUSTODY_TERM_RESEND_REQUIRED", kind: "CONFLICT", safeMessage: "A assinatura anterior foi encerrada. Um novo envio exige uma tentativa própria." });
  try {
    const claimed = await dbAdmin.runTransaction(async (transaction) => {
      const current = await transaction.get(transferRef);
      const status = String(current.get("status") ?? "");
      if (["signed", "awaiting_signature"].includes(status) && current.get("generatedDocumentId")) return false;
      const startedAt = text(current.get("termGenerationStartedAt"));
      if (status === "term_generation_in_progress" && startedAt && Date.now() - new Date(startedAt).getTime() < 5 * 60_000) throw new AppError({ code: "ASSET_CUSTODY_TERM_IN_PROGRESS", kind: "CONFLICT", safeMessage: "O termo já está sendo processado." });
      const now = new Date().toISOString();
      transaction.set(transferRef, { status: "term_generation_in_progress", generatedDocumentId, termGenerationStartedAt: now, termGenerationError: null, updatedAt: now }, { merge: true });
      return true;
    });
    let generated = await generatedRef.get();
    if (!generated.exists) {
      const legalEntity = await resolveDocumentLegalEntitySnapshot({ cnpj: employee.get("employerCnpj"), fallbackName: employee.get("employerUnitName") ?? "Coala Shakes", fallbackTradeName: "Coala Shakes", fallbackAddress: employee.get("employerAddress") });
      if (legalEntity.cnpj.replace(/\D/g, "").length !== 14) throw new AppError({ code: "ASSET_CUSTODY_TERM_LEGAL_ENTITY", kind: "VALIDATION", safeMessage: "Configure o empregador e o CNPJ do colaborador antes de emitir o termo." });
      const companySignatory = await resolveCompanyDocumentSignatory({ entityId: legalEntity.entityId, cnpj: legalEntity.cnpj });
      if (!companySignatory) throw new AppError({ code: "ASSET_CUSTODY_TERM_COMPANY_SIGNATORY", kind: "VALIDATION", safeMessage: "Configure o signatário institucional da empresa antes de enviar o termo." });
      const protocol = await allocateIdempotentDocumentProtocol({ entity: legalEntity.legalName || legalEntity.cnpj, type: "PAT", actorId: params.context.userDoc.id, reservationKey: `asset-custody:${params.transferId}` });
      const asset = assetSnap.data() ?? {};
      const rawPdf = await renderAssetCustodyTermPdf({
        protocol, issuedAt: new Date().toISOString(), effectiveAt: String(transferSnap.get("effectiveAt")),
        company: { legalName: legalEntity.legalName || "Coala Shakes", tradeName: legalEntity.tradeName || undefined, cnpj: legalEntity.cnpj, address: legalEntity.address || undefined },
        employee: { name: employeeName },
        asset: { code: String(asset.code), name: String(asset.name), category: text(asset.category) ?? undefined, brand: text(asset.brand) ?? undefined, model: text(asset.model) ?? undefined, assetTag: text(asset.assetTag) ?? undefined },
        condition: text(transferSnap.get("conditionSnapshot")) ? safeAssetCustodyTermText(transferSnap.get("conditionSnapshot")) : undefined,
        accessories: (Array.isArray(transferSnap.get("accessories")) ? transferSnap.get("accessories") : []).map(safeAssetCustodyTermText).filter(Boolean),
      });
      const pdf = await applyCoalaLetterheadToPdf(rawPdf);
      const storagePath = `generated-documents/assets/${params.assetId}/${params.transferId}/custody-term.pdf`;
      await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(pdf, { resumable: false, metadata: { contentType: "application/pdf", cacheControl: "private, no-store" } });
      const now = new Date().toISOString();
      await generatedRef.create({
        workspaceId: params.context.workspace_id, templateId: TEMPLATE_ID, templateName: "Termo de transferência de posse de patrimônio", templateVersion: 1,
        status: "approved", signatureScope: "independent", signaturePurpose: PURPOSE, signatureStatus: "pending", documentTypeCode: DOCUMENT_TYPE,
        employeeId: employee.id, employeeName, sourceModule: "assets", sourceAssetId: params.assetId, sourceCustodyTransferId: params.transferId,
        protocol, legalEntityId: legalEntity.entityId, legalEntitySnapshot: legalEntity,
        parties: [
          { partyType: "employee", role: "recipient", ref: employee.id, snapshot: { name: employeeName, signatureName: employeeName, signatureEmail: employeeEmail } },
          { partyType: "company", role: "issuer", ref: legalEntity.entityId, snapshot: { name: legalEntity.legalName, signatureName: companySignatory.name, signatureEmail: companySignatory.email } },
        ],
        pdfStoragePath: storagePath, pdfContentHash: createHash("sha256").update(pdf).digest("hex"), createdAt: now, updatedAt: now, createdBy: params.context.userDoc.id,
      });
      generated = await generatedRef.get();
    }
    const sent = await sendGeneratedDocumentForStandaloneSignature({ generatedDocumentId, actorId: params.context.userDoc.id, actorName: params.context.userDoc.username });
    const now = new Date().toISOString();
    await Promise.all([
      hrDbAdmin.collection("hrSignatureRequests").doc(sent.requestId).set({ purpose: PURPOSE, sourceAssetId: params.assetId, sourceCustodyTransferId: params.transferId, generatedDocumentId, employeeId: employee.id, updatedAt: now }, { merge: true }),
      transferRef.set({ status: "awaiting_signature", generatedDocumentId, signatureRequestId: sent.requestId, providerDocumentId: (await generatedRef.get()).get("providerDocumentId") ?? null, termGenerationCompletedAt: now, followUp: null, updatedAt: now }, { merge: true }),
    ]);
    return { generatedDocumentId, signatureRequestId: sent.requestId, status: "awaiting_signature", reused: !claimed || sent.reused };
  } catch (cause) {
    const taskId = await createFailureTask(params.context, params.transferId, assetSnap.data() ?? {});
    const now = new Date().toISOString();
    await transferRef.set({ status: "term_generation_failed", termGenerationError: cause instanceof AppError ? cause.safeMessage : "Não foi possível concluir o termo.", followUp: { status: "pending", taskId, kind: "asset_custody_term" }, updatedAt: now }, { merge: true });
    throw cause;
  }
}

export async function projectAssetCustodyTermSignature(signatureRequestId: string) {
  const request = await hrDbAdmin.collection("hrSignatureRequests").doc(signatureRequestId).get();
  if (!request.exists || request.get("purpose") !== PURPOSE) return null;
  const transferId = text(request.get("sourceCustodyTransferId"));
  if (!transferId) return null;
  const status = String(request.get("status") ?? "");
  const projected = status === "signed" && request.get("archivedDocumentId") ? "signed"
    : status === "rejected" ? "rejected"
      : status === "expired" ? "expired"
        : status === "cancelled" ? "cancelled"
          : request.get("archiveStatus") === "failed" ? "archive_failed"
            : "awaiting_signature";
  const now = new Date().toISOString();
  await dbAdmin.collection("assetCustodyTransfers").doc(transferId).set({ status: projected, employeeDocumentId: request.get("archivedDocumentId") ?? null, providerDocumentId: request.get("providerDocumentId") ?? null, signatureUpdatedAt: now, ...(projected === "signed" ? { signedAt: request.get("signedAt") ?? now, followUp: null } : projected === "archive_failed" ? { followUp: { status: "pending", taskId: null, kind: "asset_custody_term_archive" } } : {}), updatedAt: now }, { merge: true });
  return projected;
}

export async function reconcileAssetCustodyTerm(generatedDocumentId: string) {
  const result = await reconcileGeneratedDocumentStandaloneSignature(generatedDocumentId);
  const generated = await dbAdmin.collection("generatedDocuments").doc(generatedDocumentId).get();
  const signatureRequestId = text(generated.get("signatureRequestId"));
  if (signatureRequestId) await projectAssetCustodyTermSignature(signatureRequestId);
  return result;
}

export async function archiveAndProjectAssetCustodyTerm(params: { signatureRequestId: string; signedUrl: string; signedAt?: string | null; eventId?: string | null }) {
  await archiveAutentiqueSignedDocument({ signatureRequestId: params.signatureRequestId, signedUrl: params.signedUrl, signedAt: params.signedAt, confirmedByEventId: params.eventId });
  return projectAssetCustodyTermSignature(params.signatureRequestId);
}
