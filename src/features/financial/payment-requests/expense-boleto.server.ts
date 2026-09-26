import { createHash } from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import { Timestamp } from "firebase-admin/firestore";
import { adminApp } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { AppError } from "@/lib/observability";
import { normalizeFinancialDocumentIdentity, paymentBarcodeHash } from "../inbox/document-identity";
import { assertExpenseBoletoTarget, expenseBoletoSchema, type ExpenseBoletoInput } from "./expense-boleto";
import type { BarcodeBankPaymentRequest, PaymentActor } from "./types";

export function boletoConflict(cause?: unknown): never {
  throw new AppError({ code: "EXPENSE_BOLETO_CONFLICT", kind: "CONFLICT", safeMessage: "Confira valor, vencimento, competência, CNPJ e linha digitável. A despesa deve estar em aberto, sem outra ordem de pagamento.", cause });
}
function validateTarget(data: Record<string, any>, input: ExpenseBoletoInput, workspace: string) {
  try { assertExpenseBoletoTarget(data, input, workspace); } catch (cause) { boletoConflict(cause); }
}
export async function attachExpenseBoleto(expenseId: string, workspace: string, input: ExpenseBoletoInput, bytes: Buffer, filename: string, actor: PaymentActor) {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== "%PDF-") throw new AppError({ code: "EXPENSE_BOLETO_PDF_INVALID", kind: "VALIDATION", safeMessage: "Envie um PDF de até 10 MB." });
  const ref = financialDbAdmin.collection("expenses").doc(expenseId);
  const attachmentRef = financialDbAdmin.collection("expenseBoletoAttachments").doc(expenseId);
  const first = await ref.get();
  if (!first.exists) boletoConflict();
  validateTarget(first.data()!, input, workspace);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (first.get("paymentRequestId") || (first.get("boletoAttachment.sha256") && first.get("boletoAttachment.sha256") !== sha256)) boletoConflict();
  const storagePath = `financial/expense-boletos/${workspace}/${expenseId}/${sha256}.pdf`;
  const file = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath);
  // Content-addressed immutable object: retry never overwrites a different document.
  await file.save(bytes, { resumable: false, contentType: "application/pdf", preconditionOpts: { ifGenerationMatch: 0 } }).catch((error: unknown) => {
    if (Number((error as { code?: number }).code) !== 412) throw error;
  });
  const attachment = { ...input, workspaceId: workspace, expenseId, sha256, storagePath, filename: filename.replace(/[\r\n"\\/]/g, "_").slice(0, 180), uploadedAt: new Date().toISOString(), uploadedBy: actor.uid };
  await financialDbAdmin.runTransaction(async tx => {
    const [snapshot, stored] = await Promise.all([tx.get(ref), tx.get(attachmentRef)]);
    if (!snapshot.exists) boletoConflict();
    const data = snapshot.data()!;
    validateTarget(data, input, workspace);
    if (data.paymentRequestId || (data.boletoAttachment?.sha256 && data.boletoAttachment.sha256 !== sha256)) boletoConflict();
    if (stored.exists) {
      if (stored.get("sha256") !== sha256 || stored.get("barcode") !== input.barcode || stored.get("beneficiaryDocument") !== input.beneficiaryDocument) boletoConflict();
      return;
    }
    const documentIdentity = normalizeFinancialDocumentIdentity({ barcode: input.barcode, documentReferences: [input.documentReference], confidence: "high" });
    const installments = (data.installments?.length ? data.installments : [{ number: 1, dueDate: data.dueDate, value: data.totalValue, status: data.status }]).map((item: any) => ({ ...item, documentIdentity }));
    tx.update(ref, { boletoAttachment: attachment, documentIdentity, installments, sourceDocumentName: attachment.filename, sourceDocumentSha256: sha256, sourceReference: input.documentReference, updatedAt: Timestamp.now(), updatedBy: actor.uid });
    tx.create(attachmentRef, attachment);
    tx.create(ref.collection("events").doc(), { type: "EXPENSE_BOLETO_ATTACHED", at: attachment.uploadedAt, actorId: actor.uid, sha256 });
  });
  return { attached: true, sha256, filename: attachment.filename };
}
export async function prepareExpenseBoleto(expenseId: string, workspace: string, scheduledFor: string, actor: PaymentActor) {
  const now = new Date().toISOString();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Belem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const expenseRef = financialDbAdmin.collection("expenses").doc(expenseId);
  const requestRef = financialDbAdmin.collection("bankPaymentRequests").doc(`expense_boleto_${expenseId}`);
  return financialDbAdmin.runTransaction(async tx => {
    const [expense, existing, stored] = await Promise.all([tx.get(expenseRef), tx.get(requestRef), tx.get(financialDbAdmin.collection("expenseBoletoAttachments").doc(expenseId))]);
    if (!expense.exists) boletoConflict();
    const data = expense.data()!;
    const parsed = expenseBoletoSchema.safeParse(Object.fromEntries(Object.keys(expenseBoletoSchema.shape).map(key => [key, stored.data()?.[key]])));
    if (!parsed.success || stored.get("workspaceId") !== workspace || !stored.get("storagePath")) boletoConflict();
    const input = parsed.data;
    validateTarget(data, input, workspace);
    if (scheduledFor < today || scheduledFor > input.dueDate) boletoConflict();
    if (existing.exists) {
      const prior = { id: existing.id, ...existing.data() } as BarcodeBankPaymentRequest;
      if (prior.expenseId !== expenseId || prior.barcodeSnapshot.code !== input.barcode || prior.barcodeSnapshot.scheduledFor !== scheduledFor || prior.barcodeSnapshot.beneficiaryDocument !== input.beneficiaryDocument || Math.round(prior.amount * 100) !== input.amountCents) boletoConflict();
      return prior;
    }
    if (data.paymentRequestId) boletoConflict();
    const duplicates = await tx.get(financialDbAdmin.collection("bankPaymentRequests").where("barcodeSnapshot.codeHash", "==", paymentBarcodeHash(input.barcode)).limit(1));
    const legacyDuplicates = await tx.get(financialDbAdmin.collection("bankPaymentRequests").where("barcodeSnapshot.code", "==", input.barcode).limit(1));
    if (!duplicates.empty || !legacyDuplicates.empty) boletoConflict();
    const request: BarcodeBankPaymentRequest = {
      id: requestRef.id, sourceType: "expense_boleto", sourceId: expenseId, expenseId, installmentNumber: 1,
      paymentRail: "barcode", barcodeSnapshot: { type: "barcode", code: input.barcode, codeHash: paymentBarcodeHash(input.barcode), maskedCode: normalizeFinancialDocumentIdentity({ barcode: input.barcode }).barcodeMasked!, dueDate: input.dueDate, scheduledFor, beneficiaryDocument: input.beneficiaryDocument },
      amount: input.amountCents / 100, description: String(data.description).slice(0, 140), status: "awaiting_financial_authorization", idempotencyKey: requestRef.id, statementReconciliationStatus: "not_expected", createdAt: now, updatedAt: now, createdBy: actor.uid,
    };
    tx.create(requestRef, Object.fromEntries(Object.entries(request).filter(([key]) => key !== "id")));
    tx.update(expenseRef, { paymentRequestId: request.id, updatedAt: Timestamp.now(), updatedBy: actor.uid });
    tx.create(requestRef.collection("events").doc(), { type: "PAYMENT_REQUEST_CREATED", at: now, actorId: actor.uid, sourceType: request.sourceType, sourceId: expenseId, amount: request.amount, scheduledFor });
    return request;
  });
}
