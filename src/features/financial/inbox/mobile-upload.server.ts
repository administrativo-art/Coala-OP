import { getStorage } from "firebase-admin/storage";
import { createHash } from "node:crypto";

import { adminApp } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import type { ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";

import { classifyFinancialEmail } from "./parser";
import { listLocalPurchaseAccounts } from "@/features/purchasing/local-purchase-catalog.server";
import { listLocalPurchaseProducts, recallLocalPurchaseItemLinks } from "@/features/purchasing/local-purchase-stock.server";
import { extractMobilePurchaseDocuments } from "./mobile-purchase-extraction.server";
import {
  buildFinancialInboxSearchTerms,
  FINANCIAL_INBOX_SEARCH_INDEX_VERSION,
} from "./search-index";
import {
  FINANCIAL_INBOX_RESOLUTION_VERSION,
  pendingFinancialInboxResolution,
} from "./resolution-contract";
import type { FinancialInboxAttachment, FinancialInboxMessage } from "./types";
import {
  mobileInboxDocumentId,
  type DetectedMobileInboxFile,
  type MobileInboxUploadMetadata,
  type MobilePurchaseAnalysis,
} from "./mobile-upload";

function safeSegment(value: string, fallback: string) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return normalized.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 160) || fallback;
}

function isAlreadyExists(error: unknown) {
  const code = (error as { code?: number | string })?.code;
  return code === 6 || code === "already-exists" || String((error as Error)?.message).includes("ALREADY_EXISTS");
}

function mobileAnalysis(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const data = snapshot.data() as FinancialInboxMessage | undefined;
  const dedicated = snapshot.get("mobilePurchaseAnalysis") as MobilePurchaseAnalysis | null | undefined;
  if (dedicated) return dedicated;
  const hints = data?.attachments?.flatMap((attachment) => attachment.extractedHints ? [attachment.extractedHints] : [])[0] ?? null;
  return {
    supplierName: hints?.supplierName ?? data?.classification?.supplierName ?? null,
    supplierTaxId: hints?.supplierTaxId ?? data?.classification?.billingIdentity?.supplierTaxId ?? null,
    purchaseDate: hints?.documentDate ?? hints?.dueDate ?? null,
    amountCents: hints?.amountCents ?? data?.classification?.amountCents ?? null,
    items: hints?.purchaseItems ?? [],
    confidence: hints?.confidence ?? data?.classification?.confidence ?? "low",
  };
}

type MobileUploadDocument = { originalFilename: string; buffer: Buffer; detected: DetectedMobileInboxFile };
const sha256Of = (document: MobileUploadDocument) => createHash("sha256").update(document.buffer).digest("hex");
const sameHashes = (left: string[], right: string[]) => left.length === right.length && [...left].sort().join() === [...right].sort().join();

export async function ingestFinancialMobileUpload(params: {
  actor: ServerUserContext;
  metadata: MobileInboxUploadMetadata;
  receipts: MobileUploadDocument[];
  paymentProofs: MobileUploadDocument[];
}) {
  const { actor, metadata } = params;
  const documentId = mobileInboxDocumentId(actor.workspace_id, metadata.submissionId);
  const reference = financialDbAdmin.collection("financialInboxMessages").doc(documentId);
  const existing = await reference.get();
  if (existing.exists) {
    const existingAttachments = existing.get("attachments");
    const storedHashes = (prefix: string) => (Array.isArray(existingAttachments) ? existingAttachments : [])
      .filter((attachment) => String(attachment?.filename ?? "").startsWith(prefix))
      .map((attachment) => String(attachment?.sha256 ?? ""));
    if (existing.get("submittedBy.userId") !== actor.userDoc.id
      || existing.get("mobilePurchaseFundingSource") !== metadata.fundingSource
      || !sameHashes(storedHashes("receipt-"), params.receipts.map(sha256Of))
      || !sameHashes(storedHashes("payment-proof-"), params.paymentProofs.map(sha256Of))) {
      throw new AppError({ code: "FINANCIAL_INBOX_MOBILE_REPLAY_CONFLICT", kind: "CONFLICT", safeMessage: "Este identificador de envio já foi usado com outros documentos." });
    }
    return {
      id: documentId,
      duplicate: true,
      status: String(existing.get("status") || "pending_review") as FinancialInboxMessage["status"],
      analysis: mobileAnalysis(existing),
    };
  }

  const now = new Date().toISOString();
  const receivedAt = metadata.capturedAt ?? now;
  async function storeDocument(role: "receipt" | "payment-proof", document: MobileUploadDocument) {
    const filenameBase = safeSegment(document.originalFilename, `${role}.${document.detected.extension}`).replace(/\.[^.]+$/, "");
    const filename = `${role}-${filenameBase}.${document.detected.extension}`;
    const fileHash = createHash("sha256").update(document.buffer).digest("hex");
    const attachmentId = `mobile-${role}-${fileHash.slice(0, 20)}`;
    const storagePath = `financial-inbox/${safeSegment(actor.workspace_id, "workspace")}/${documentId}/attachments/${attachmentId}-${filename}`;
    await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(document.buffer, {
      resumable: false,
      metadata: { contentType: document.detected.contentType, cacheControl: "private, no-store", metadata: {
        sha256: fileHash, source: "coala-notas-android", documentRole: role, workspaceId: actor.workspace_id,
        submittedBy: actor.userDoc.id, submissionId: metadata.submissionId,
      } },
    });
    const attachment: FinancialInboxAttachment = {
      id: attachmentId, filename, contentType: document.detected.contentType, size: document.buffer.byteLength,
      contentDisposition: "attachment", storagePath, sha256: fileHash, archiveStatus: "stored", sourceType: "attachment", extractionStatus: "not_attempted",
    };
    return { attachment, fileHash };
  }
  const storedReceipts: Array<Awaited<ReturnType<typeof storeDocument>>> = [];
  for (const document of params.receipts) storedReceipts.push(await storeDocument("receipt", document));
  const storedPaymentProofs: Array<Awaited<ReturnType<typeof storeDocument>>> = [];
  for (const document of params.paymentProofs) storedPaymentProofs.push(await storeDocument("payment-proof", document));
  const storedReceipt = storedReceipts[0]!;
  const attachments = [...storedReceipts, ...storedPaymentProofs].map((stored) => stored.attachment);
  const note = metadata.note?.trim() ?? "";
  const subject = note || `Nota de compra enviada pelo aplicativo: ${storedReceipt.attachment.filename}`;
  const parsed = classifyFinancialEmail({ subject, text: note, html: null, senderDomain: null });
  const username = String(actor.userDoc.username || actor.decoded.email || "Usuário do Coala One");
  const email = typeof actor.decoded.email === "string" ? actor.decoded.email : null;
  const message: Omit<FinancialInboxMessage, "id"> = {
    workspaceId: actor.workspace_id,
    provider: "mobile",
    providerEmailId: metadata.submissionId,
    providerEventId: metadata.submissionId,
    submittedBy: { userId: actor.userDoc.id, username, email },
    messageId: null,
    status: "pending_review",
    from: `${username} · Coala Notas`,
    fromAddress: email,
    senderDomain: null,
    to: [],
    originalRecipients: [],
    subject,
    receivedAt,
    textPreview: parsed.textPreview,
    textContent: parsed.textContent,
    classification: {
      ...parsed.classification,
      financeLikely: true,
      marketingLikely: false,
    },
    attachments,
    mobilePurchaseFundingSource: metadata.fundingSource,
    mobilePurchaseAnalysis: null,
    rawStoragePath: null,
    rawSha256: null,
    archiveWarnings: [],
    linkedExpenseId: null,
    linkedProvisionId: null,
    obligationId: null,
    paymentRequestId: null,
    provisionSuggestion: {
      status: "not_checked",
      provisionExpenseId: null,
      confidence: null,
      score: null,
      reasons: [],
      description: null,
      supplier: null,
      competence: parsed.classification.competence,
      dueDate: null,
      provisionedAmountCents: null,
      checkedAt: null,
    },
    creationSuggestion: null,
    linkResolution: { status: "not_needed", checkedAt: null, sourceDomain: null, message: null },
    bankState: "not_prepared",
    statementTransactionId: null,
    resolution: pendingFinancialInboxResolution(),
    resolutionContractVersion: FINANCIAL_INBOX_RESOLUTION_VERSION,
    reviewedAt: null,
    reviewedBy: null,
    searchTerms: [],
    searchIndexVersion: FINANCIAL_INBOX_SEARCH_INDEX_VERSION,
    searchIndexedAt: now,
    archivedAt: null,
    archivedBy: null,
    archivedFromStatus: null,
    retentionClass: null,
    purgeEligibleAt: null,
    retentionPolicyVersion: null,
    createdAt: now,
    updatedAt: now,
  };
  message.searchTerms = buildFinancialInboxSearchTerms(message);

  try {
    const batch = financialDbAdmin.batch();
    batch.create(reference, message);
    batch.create(reference.collection("events").doc("mobile-document-submitted-v1"), {
      type: "MOBILE_DOCUMENT_SUBMITTED",
      at: now,
      actorId: actor.userDoc.id,
      submissionId: metadata.submissionId,
      receiptSha256: storedReceipt.fileHash,
      paymentProofSha256: storedPaymentProofs[0]?.fileHash ?? null,
      receiptSha256s: storedReceipts.map((stored) => stored.fileHash),
      paymentProofSha256s: storedPaymentProofs.map((stored) => stored.fileHash),
      fundingSource: metadata.fundingSource,
    });
    await batch.commit();
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    return { id: documentId, duplicate: true, status: "pending_review" as const };
  }

  const products = actor.isDefaultAdmin || actor.permissions.app?.localPurchase?.stockEntry === true
    ? await listLocalPurchaseProducts().catch(() => [])
    : [];
  await extractMobilePurchaseDocuments({
    metadata,
    products,
    // A failed catalog read only costs the suggestion; the operator still picks the category in the review.
    accounts: await listLocalPurchaseAccounts().catch(() => []),
    receipts: params.receipts.map((document, index) => ({ buffer: document.buffer, filename: storedReceipts[index]!.attachment.filename, detected: document.detected })),
    paymentProofs: params.paymentProofs.map((document, index) => ({ buffer: document.buffer, filename: storedPaymentProofs[index]!.attachment.filename, detected: document.detected })),
  }).then(async (analysis) => {
    if (!analysis) return;
    // What a person linked before for this supplier and description outranks the model's guess.
    const remembered = await recallLocalPurchaseItemLinks(
      { workspaceId: actor.workspace_id, supplierTaxId: analysis.supplierTaxId, supplierName: analysis.supplierName },
      analysis.items.map((item) => item.description),
    ).catch(() => analysis.items.map(() => null));
    analysis.items.forEach((item, index) => {
      const productId = remembered[index];
      if (!productId || !products.some((product) => product.id === productId)) return;
      if (item.productId !== productId) item.packages = item.quantity;
      item.productId = productId;
    });
    await reference.set({ mobilePurchaseAnalysis: analysis, updatedAt: new Date().toISOString() }, { merge: true });
  }).catch(async () => {
    await reference.collection("events").doc().create({ type: "DOCUMENT_ANALYSIS_FAILED", at: new Date().toISOString(), actorId: "system:financial-inbox", safeMessage: "A análise automática não foi concluída; os documentos permanecem disponíveis para revisão manual." });
  });

  const refreshed = await reference.get();
  return {
    id: documentId,
    duplicate: false,
    status: String(refreshed.get("status") || "pending_review") as FinancialInboxMessage["status"],
    analysis: mobileAnalysis(refreshed),
  };
}
