import { createHash, randomUUID } from "node:crypto";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { createBeneficiarySnapshot, resolvePaymentBeneficiary } from "../beneficiaries/resolver.server";
import { normalizeBrazilianDocument } from "../beneficiaries/normalization";
import type { PaymentBeneficiaryReference } from "../beneficiaries/types";
import { createAndStoreConfirmedPaymentProof } from "@/lib/integrations/inter/proof.server";
import { getInterPixStatus, mapInterPixStatus, submitInterPix } from "@/lib/integrations/inter/pix-payments.server";
import { addPaymentEvent, findPaymentRequestBySource, getPaymentRequest, paymentRequestRef, transitionPaymentRequest } from "./repository.server";
import type { BankPaymentRequest, BankPaymentRequestStatus, BankPaymentSourceType, PaymentActor, PaymentLegalEntitySnapshot } from "./types";

export async function createPaymentRequest(input: {
  sourceType: BankPaymentSourceType;
  sourceId: string;
  expenseId?: string;
  beneficiaryReference: PaymentBeneficiaryReference;
  legalEntitySnapshot?: PaymentLegalEntitySnapshot;
  amount: number;
  description: string;
}, actor: PaymentActor) {
  const existing = await findPaymentRequestBySource(input.sourceType, input.sourceId);
  if (existing) return existing;
  const beneficiary = await resolvePaymentBeneficiary(input.beneficiaryReference);
  if (!beneficiary.validated) throw new Error("O favorecido ainda não foi validado.");
  const now = new Date().toISOString();
  const ref = paymentRequestRef(randomUUID());
  const status: BankPaymentRequestStatus = "awaiting_financial_authorization";
  const request: BankPaymentRequest = {
    id: ref.id,
    ...input,
    amount: Number(input.amount.toFixed(2)),
    description: input.description.trim().slice(0, 140),
    beneficiarySnapshot: createBeneficiarySnapshot(beneficiary, now),
    status,
    idempotencyKey: randomUUID(),
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
  };
  await ref.create(Object.fromEntries(Object.entries(request).filter(([key]) => key !== "id")));
  await addPaymentEvent(ref.id, "PAYMENT_REQUEST_CREATED", actor, { status, sourceType: input.sourceType, sourceId: input.sourceId, amount: request.amount });
  return request;
}

export async function authorizePaymentRequest(id: string, actor: PaymentActor) {
  const now = new Date().toISOString();
  const request = await transitionPaymentRequest(id, ["awaiting_financial_authorization"], "ready_to_submit", { authorizedAt: now, authorizedBy: actor.uid });
  await addPaymentEvent(id, "FINANCIAL_AUTHORIZATION_GRANTED", actor);
  if (request.sourceType === "aso" || request.sourceType === "termination") {
    const notificationId = request.sourceType === "aso" ? `aso_payment_${request.sourceId}` : `termination_payment_${request.sourceId}`;
    await hrDbAdmin.collection("hrNotifications").doc(notificationId).set({ status: "completed", authorizedAt: now, authorizedBy: actor.uid, updatedAt: now }, { merge: true });
  }
  return request.sourceType === "termination" || request.sourceType === "aso" ? submitPaymentRequest(id, actor) : request;
}

function safeBankError(error: unknown) {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return { code: status ? `INTER_HTTP_${status}` : "INTER_REQUEST_FAILED", safeMessage: "Não foi possível concluir a comunicação com o Banco Inter. Consulte novamente antes de tentar outro envio.", occurredAt: new Date().toISOString() };
}

export async function submitPaymentRequest(id: string, actor: PaymentActor | "system") {
  const pending = await transitionPaymentRequest(id, ["ready_to_submit", "failed"], "submitting", { lastError: null });
  await addPaymentEvent(id, "INTER_SUBMISSION_STARTED", actor);
  try {
    const beneficiary = await resolvePaymentBeneficiary(pending.beneficiaryReference);
    if (beneficiary.sourceUpdatedAt !== pending.beneficiarySnapshot.sourceUpdatedAt) {
      throw new Error("Os dados do favorecido mudaram após a criação. Crie uma nova solicitação para revalidar o pagamento.");
    }
    const result = await submitInterPix({ idempotencyKey: pending.idempotencyKey, amount: pending.amount, description: pending.description, beneficiary });
    const interRequestId = String(result.codigoSolicitacao ?? "");
    if (!interRequestId) throw new Error("O Banco Inter não retornou o código da solicitação.");
    const approval = String(result.tipoRetorno ?? "").toUpperCase() === "APROVACAO";
    const next = approval ? "awaiting_bank_approval" : "processing";
    const request = await transitionPaymentRequest(id, ["submitting"], next, { interRequestId, submittedAt: new Date().toISOString(), bankStatus: result.tipoRetorno ?? null });
    await addPaymentEvent(id, approval ? "BANK_APPROVAL_REQUIRED" : "INTER_SUBMISSION_ACCEPTED", actor, { interRequestId, bankReturnType: result.tipoRetorno ?? null });
    return request;
  } catch (error) {
    const lastError = safeBankError(error);
    await transitionPaymentRequest(id, ["submitting"], "failed", { lastError });
    await addPaymentEvent(id, "INTER_SUBMISSION_FAILED", actor, { code: lastError.code });
    throw error;
  }
}

async function completeSource(request: BankPaymentRequest) {
  if (request.sourceType === "aso") {
    await hrDbAdmin.collection("onboardingProcesses").doc(request.sourceId).set({
      asoWorkflow: { paymentRequestId: request.id, paymentStatus: "paid", paymentProofStoragePath: request.proofStoragePath, paymentConfirmedAt: request.paidAt },
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return;
  }
  if (request.sourceType === "termination") {
    await hrDbAdmin.collection("terminationProcesses").doc(request.sourceId).set({
      payment: {
        status: "paid",
        requestId: request.id,
        amount: request.amount,
        paidAt: request.paidAt ?? null,
        proofStoragePath: request.proofStoragePath ?? null,
        maskedDestination: request.beneficiarySnapshot.maskedPaymentDestination,
        lastError: null,
      },
      lastActivityAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return;
  }
  if (request.sourceType === "purchase_order") {
    const now = new Date().toISOString();
    await Promise.all([
      dbAdmin.collection("purchase_orders").doc(request.sourceId).set({
        paymentStatus: "paid",
        paymentRequestId: request.id,
        paidAt: request.paidAt ?? null,
        updatedAt: now,
      }, { merge: true }),
      dbAdmin.collection("purchase_financials")
        .where("purchaseOrderId", "==", request.sourceId)
        .limit(10)
        .get()
        .then((snapshot) => Promise.all(snapshot.docs.map((document) => document.ref.set({
          status: "paid",
          paymentRequestId: request.id,
          paidAt: request.paidAt ?? null,
          updatedAt: now,
        }, { merge: true })))).then(() => undefined),
    ]);
  }
  if (request.expenseId) {
    const now = new Date().toISOString();
    const expenseRef = financialDbAdmin.collection("expenses").doc(request.expenseId);
    const paymentRef = financialDbAdmin.collection("payments").doc(`inter_${request.id}`);
    await financialDbAdmin.runTransaction(async (transaction) => {
      const expense = await transaction.get(expenseRef);
      if (!expense.exists) throw new Error("A despesa vinculada à solicitação não foi encontrada.");
      transaction.set(paymentRef, {
        expenseId: request.expenseId, paymentRequestId: request.id, paidAt: request.paidAt,
        totalPaid: request.amount, paymentMethodLabel: "Pix Banco Inter", proofStoragePath: request.proofStoragePath,
        createdAt: now, createdBy: "bank-reconciliation",
      }, { merge: false });
      transaction.set(expenseRef, { status: "paid", paidAt: request.paidAt, paymentRequestId: request.id, paymentProofStoragePath: request.proofStoragePath, updatedAt: now }, { merge: true });
      transaction.set(financialDbAdmin.collection("transactions").doc(`inter_${request.id}`), {
        type: "expense", expenseId: request.expenseId, paymentRequestId: request.id,
        description: request.description, amount: request.amount, date: request.paidAt,
        paymentMethodLabel: "Pix Banco Inter", createdAt: now, createdBy: "bank-reconciliation",
      }, { merge: false });
    });
  }
  if (request.sourceType === "generated_receipt") {
    await financialDbAdmin.collection("generatedReceipts").doc(request.sourceId).set({ status: "paid", paidAt: request.paidAt, paymentRequestId: request.id, paymentProofStoragePath: request.proofStoragePath, updatedAt: new Date().toISOString() }, { merge: true });
  }
}

export async function refreshPaymentRequest(id: string, actor: PaymentActor | "system") {
  let current = await getPaymentRequest(id);
  if (current.status === "paid") {
    if (!current.proofStoragePath) {
      const proofStoragePath = await createAndStoreConfirmedPaymentProof(current);
      current = await transitionPaymentRequest(id, ["paid"], "paid", { proofStoragePath });
      await addPaymentEvent(id, "PAYMENT_PROOF_STORED", "system", { proofStoragePath });
    }
    if (!current.sourceCompletedAt) {
      await completeSource(current);
      const sourceCompletedAt = new Date().toISOString();
      current = await transitionPaymentRequest(id, ["paid"], "paid", { sourceCompletedAt });
      await addPaymentEvent(id, "SOURCE_COMPLETED_AFTER_PAYMENT", "system", { sourceType: current.sourceType, sourceId: current.sourceId });
    }
    return current;
  }
  if (!current.interRequestId) throw new Error("A solicitação ainda não foi enviada ao Banco Inter.");
  const bank = await getInterPixStatus(current.interRequestId);
  const transaction = bank.transacaoPix ?? {};
  const rawStatus = String(transaction.status ?? "");
  const next = mapInterPixStatus(rawStatus);
  if (Number(transaction.valor ?? 0).toFixed(2) !== Number(current.amount).toFixed(2)) {
    await addPaymentEvent(id, "BANK_RECONCILIATION_DIVERGENCE", actor, { field: "amount", bankStatus: rawStatus });
    throw new Error("O valor confirmado pelo banco diverge da solicitação. O pagamento não foi baixado.");
  }
  const receiverDocument = normalizeBrazilianDocument(transaction.recebedor?.cpfCnpj);
  const snapshotDocument = normalizeBrazilianDocument(current.beneficiarySnapshot.document);
  const receiverHash = receiverDocument
    ? createHash("sha256").update(receiverDocument).digest("hex")
    : "";
  const snapshotDocumentMatches = current.beneficiarySnapshot.documentHash
    ? receiverHash === current.beneficiarySnapshot.documentHash
    : snapshotDocument.length === receiverDocument.length
      ? receiverDocument === snapshotDocument
      : receiverDocument.endsWith(snapshotDocument);
  if (receiverDocument && snapshotDocument && !snapshotDocumentMatches) {
    await addPaymentEvent(id, "BANK_RECONCILIATION_DIVERGENCE", actor, { field: "receiver", bankStatus: rawStatus });
    throw new Error("O favorecido confirmado pelo banco diverge da solicitação. O pagamento não foi baixado.");
  }
  const patch: Record<string, unknown> = { bankStatus: rawStatus, endToEndId: transaction.endToEnd ?? null };
  if (next === "paid") patch.paidAt = transaction.dataHoraMovimento ?? new Date().toISOString();
  let updated = await transitionPaymentRequest(id, ["awaiting_bank_approval", "processing", "failed", "rejected", "approval_expired"], next, patch);
  await addPaymentEvent(id, "BANK_STATUS_RECONCILED", actor, { bankStatus: rawStatus, status: next });
  if (next === "paid" && !updated.proofStoragePath) {
    const proofStoragePath = await createAndStoreConfirmedPaymentProof(updated);
    updated = await transitionPaymentRequest(id, ["paid"], "paid", { proofStoragePath });
    await addPaymentEvent(id, "PAYMENT_PROOF_STORED", "system", { proofStoragePath });
    await completeSource(updated);
    const sourceCompletedAt = new Date().toISOString();
    updated = await transitionPaymentRequest(id, ["paid"], "paid", { sourceCompletedAt });
    await addPaymentEvent(id, "SOURCE_COMPLETED_AFTER_PAYMENT", "system", { sourceType: updated.sourceType, sourceId: updated.sourceId });
  }
  return updated;
}
