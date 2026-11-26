import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { dbAdmin } from "@/lib/firebase-admin";
import { InternalCompanyRepository } from "@/lib/company/internal-company-repository";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { assertGenerationPersonScopes, type GenerationActor } from "@/features/hr/documents/generation-access.server";
import { assertPayableReceipt, canResumePreparedReceiptPayment, receiptPartyDocumentHash, receiptPixDestinationMatches, type ReceiptPaymentSnapshot } from "@/features/hr/documents/receipt-payment";
import { createBeneficiarySnapshot, resolvePaymentBeneficiary } from "../beneficiaries/resolver.server";
import type { PaymentActor, PixBankPaymentRequest } from "./types";
import { paymentRequestRef } from "./repository.server";
import { submitPaymentRequest } from "./service.server";

type DocumentRecord = Record<string, unknown>;
function value(value: unknown): DocumentRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as DocumentRecord : {}; }
function receiptRequestId(id: string) { return `document_receipt_${createHash("sha256").update(id).digest("hex").slice(0, 40)}`; }

export function assertDocumentReceiptPaymentTarget(document: DocumentRecord, receipt: ReceiptPaymentSnapshot | undefined, payerCnpj: string) {
  if (document.templateId !== "system-receipt-standard" || !["approved", "final"].includes(String(document.status))) throw new Error("Aprove o recibo antes de enviar pagamento.");
  if (!document.pdfStoragePath || (Array.isArray(document.missingRequired) && document.missingRequired.length)) throw new Error("O recibo não possui PDF oficial completo.");
  if (!receipt) throw new Error("Este recibo foi gerado antes da captura financeira; gere uma nova revisão.");
  assertPayableReceipt(receipt);
  const issuer = Array.isArray(document.parties) ? document.parties.find((party) => value(party).role === "issuer") : undefined;
  if (!/^\d{14}$/.test(payerCnpj) || value(issuer).partyType !== "company" || typeof value(issuer).ref !== "string" || !value(issuer).ref) {
    throw new Error("O emitente deve ser a empresa vinculada à conta Inter configurada. Confira o cadastro pagador.");
  }
  const recipient = Array.isArray(document.parties) ? document.parties.find((party) => value(party).role === "recipient") : undefined;
  const recipientType = value(recipient).partyType;
  const recipientId = value(recipient).ref;
  if (recipientType === "external_person") throw new Error("Pagamento a pessoa física externa requer cadastro pessoal consultável; selecione um colaborador ou empresa cadastrada.");
  if (typeof recipientId !== "string" || !recipientId || recipientId.includes("/") || !["employee", "company", "external_company"].includes(String(recipientType))) throw new Error("Selecione um recebedor com cadastro financeiro validado; recebedores avulsos exigem cadastro e seleção comprovada.");
  return { snapshot: receipt, issuerId: String(value(issuer).ref), beneficiaryReference: { sourceType: recipientType === "employee" ? "employee" as const : "entity" as const, sourceId: recipientId } };
}

export async function documentReceiptPaymentSource(id: string, actor: GenerationActor) {
  if (!id || id.length > 180 || id.includes("/")) throw new Error("Identificador do recibo inválido.");
  if (actor.workspace_id !== WORKSPACE_ID) throw new Error("O recibo não pertence ao ambiente financeiro atual.");
  const documentRef = dbAdmin.collection("generatedDocuments").doc(id);
  const [document, audit] = await Promise.all([documentRef.get(), documentRef.collection("audit").doc("resolvedValues").get()]);
  if (!document.exists) throw new Error("Recibo não encontrado.");
  const data = document.data() ?? {};
  if ((data.workspaceId && data.workspaceId !== actor.workspace_id) || (data.workspace_id && data.workspace_id !== actor.workspace_id)) throw new Error("Recibo fora do ambiente autorizado.");
  const target = assertDocumentReceiptPaymentTarget(data, audit.get("receiptPaymentSnapshot") as ReceiptPaymentSnapshot | undefined, (process.env.INTER_DOCUMENT_RECEIPT_PAYER_CNPJ ?? "").replace(/\D/g, ""));
  const payerCnpj = (process.env.INTER_DOCUMENT_RECEIPT_PAYER_CNPJ ?? "").replace(/\D/g, "");
  const payer = await new InternalCompanyRepository(dbAdmin).findByCnpj(payerCnpj);
  if (!payer || payer.id !== target.issuerId || payer.status === "inactive" || target.snapshot.issuerDocumentHash !== receiptPartyDocumentHash(payerCnpj)) throw new Error("O emitente do recibo não corresponde à empresa titular da conta Inter.");
  const parties = Array.isArray(data.parties) ? data.parties : [];
  await assertGenerationPersonScopes({
    actorAccess: actor,
    employeeId: typeof data.employeeId === "string" ? data.employeeId : null,
    onboardingId: typeof data.onboardingId === "string" ? data.onboardingId : null,
    partyHrIds: parties.filter((party) => party?.partyType === "employee" && typeof party.ref === "string").map((party) => party.ref),
  });
  return { data, ...target, payer: { entityId: payer.id, legalName: String(payer.razao_social ?? payer.name ?? ""), cnpj: payerCnpj } };
}

export async function sendDocumentReceiptPayment(id: string, actor: GenerationActor & PaymentActor) {
  if (process.env.INTER_DOCUMENT_RECEIPT_BANK_APPROVAL_CONFIRMED !== "true") throw new Error("A aprovação Pix no aplicativo Inter não foi confirmada para esta origem.");
  const { data, snapshot, beneficiaryReference, payer } = await documentReceiptPaymentSource(id, actor);
  const beneficiary = await resolvePaymentBeneficiary(beneficiaryReference);
  if (!beneficiary.validated) throw new Error("O cadastro financeiro do recebedor ainda não foi validado.");
  if (beneficiaryReference.sourceType === "entity" && String(beneficiary.document).replace(/\D/g, "").length !== 14) throw new Error("Pessoa física externa precisa de fluxo financeiro com rastreabilidade pessoal própria; selecione colaborador ou empresa cadastrada.");
  if (!receiptPixDestinationMatches(snapshot, beneficiary.pixKey, beneficiary.pixKeyType)) {
    throw new Error("A chave Pix do recibo difere do cadastro financeiro validado. Corrija o recibo e gere uma nova revisão.");
  }
  if (snapshot.recipientDocumentHash !== receiptPartyDocumentHash(beneficiary.document)) throw new Error("O documento do recebedor diverge do cadastro financeiro validado.");
  const now = new Date().toISOString();
  const requestId = receiptRequestId(id);
  const ref = paymentRequestRef(requestId);
  const request: PixBankPaymentRequest = {
    id: requestId, workspaceId: WORKSPACE_ID, sourceType: "document_receipt", sourceId: id,
    beneficiaryReference, beneficiarySnapshot: createBeneficiarySnapshot(beneficiary, now),
    legalEntitySnapshot: payer,
    receiptPdfContentHash: String(data.pdfContentHash ?? ""), receiptFormValuesHash: String(data.formValuesHash ?? ""),
    amount: snapshot.amountCents / 100, description: `Recibo ${String(data.protocol ?? id)}`.slice(0, 140),
    status: "ready_to_submit", idempotencyKey: randomUUID(), createdAt: now, createdBy: actor.uid, authorizedAt: now, authorizedBy: actor.uid, updatedAt: now,
  };
  const created = await financialDbAdmin.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) {
      if (existing.get("sourceType") !== "document_receipt" || existing.get("sourceId") !== id || existing.get("workspaceId") !== WORKSPACE_ID || existing.get("amount") !== request.amount || existing.get("beneficiaryReference.sourceType") !== beneficiaryReference.sourceType || existing.get("beneficiaryReference.sourceId") !== beneficiaryReference.sourceId || existing.get("legalEntitySnapshot.entityId") !== payer.entityId || existing.get("receiptPdfContentHash") !== request.receiptPdfContentHash || existing.get("receiptFormValuesHash") !== request.receiptFormValuesHash) throw new Error("A solicitação anterior diverge do recibo. Revise o pagamento.");
      return false;
    }
    transaction.create(ref, Object.fromEntries(Object.entries(request).filter(([key]) => key !== "id")));
    transaction.create(ref.collection("events").doc("document-receipt-payment-prepared-v1"), {
      type: "DOCUMENT_RECEIPT_PAYMENT_PREPARED", at: now, actorId: actor.uid,
      workspaceId: WORKSPACE_ID,
      actorEmail: actor.email ?? null, status: "ready_to_submit",
      sourceType: "document_receipt", sourceId: id, amount: request.amount,
    });
    return true;
  });
  if (!created) {
    const existing = await ref.get();
    if (canResumePreparedReceiptPayment({ status: existing.get("status"), submissionStartedAt: existing.get("submissionStartedAt"), interRequestId: existing.get("interRequestId") })) {
      const resumed = await submitPaymentRequest(requestId, actor, { receiptVerified: true });
      await dbAdmin.collection("generatedDocuments").doc(id).set({ receiptPaymentRequestId: requestId, receiptPaymentStatus: resumed.status }, { merge: true });
      return { request: { id: resumed.id, status: resumed.status, amount: resumed.amount, beneficiarySnapshot: resumed.beneficiarySnapshot }, reused: true };
    }
    return { request: { id: existing.id, status: existing.get("status"), amount: existing.get("amount"), beneficiarySnapshot: existing.get("beneficiarySnapshot") }, reused: true };
  }
  const sent = await submitPaymentRequest(requestId, actor, { receiptVerified: true });
  await dbAdmin.collection("generatedDocuments").doc(id).set({ receiptPaymentRequestId: requestId, receiptPaymentStatus: sent.status }, { merge: true });
  return { request: { id: sent.id, status: sent.status, amount: sent.amount, beneficiarySnapshot: sent.beneficiarySnapshot }, reused: false };
}

export async function readDocumentReceiptPaymentStatus(id: string, actor: GenerationActor) {
  if (!id || id.length > 180 || id.includes("/") || actor.workspace_id !== WORKSPACE_ID) throw new Error("Recibo fora do ambiente autorizado.");
  const document = await dbAdmin.collection("generatedDocuments").doc(id).get();
  if (!document.exists || document.get("templateId") !== "system-receipt-standard") throw new Error("Recibo não encontrado.");
  if ((document.get("workspaceId") && document.get("workspaceId") !== actor.workspace_id) || (document.get("workspace_id") && document.get("workspace_id") !== actor.workspace_id)) throw new Error("Recibo fora do ambiente autorizado.");
  const parties = Array.isArray(document.get("parties")) ? document.get("parties") : [];
  await assertGenerationPersonScopes({ actorAccess: actor, employeeId: document.get("employeeId") ?? null, onboardingId: document.get("onboardingId") ?? null, partyHrIds: parties.filter((party: { partyType?: string; ref?: string }) => party?.partyType === "employee" && typeof party.ref === "string").map((party: { ref: string }) => party.ref) });
  const request = await paymentRequestRef(receiptRequestId(id)).get();
  if (!request.exists) return null;
  if (request.get("workspaceId") !== WORKSPACE_ID || request.get("sourceType") !== "document_receipt" || request.get("sourceId") !== id) throw new Error("A solicitação bancária não corresponde ao recibo.");
  return { id: request.id, status: request.get("status") as string, canResume: canResumePreparedReceiptPayment({
    status: request.get("status"), submissionStartedAt: request.get("submissionStartedAt"), interRequestId: request.get("interRequestId"),
  }) };
}
