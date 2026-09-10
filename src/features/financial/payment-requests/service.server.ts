import { randomUUID } from "node:crypto";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { createBeneficiarySnapshot, resolvePaymentBeneficiary } from "../beneficiaries/resolver.server";
import type { PaymentBeneficiaryReference } from "../beneficiaries/types";
import { createAndStoreConfirmedPaymentProof } from "@/lib/integrations/inter/proof.server";
import { safeInterPaymentError } from "@/lib/integrations/inter/payment-error";
import { findInterBarcodePaymentsByCode, getInterBarcodePayment, mapInterBarcodeStatus, submitInterBarcodePayment } from "@/lib/integrations/inter/barcode-payments.server";
import { getInterPixStatus, mapInterPixStatus, submitInterPix } from "@/lib/integrations/inter/pix-payments.server";
import { maskPaymentBarcode, normalizePaymentBarcode } from "@/features/financial/inbox/parser";
import { WORKSPACE_ID } from "@/lib/workspace";
import { addPaymentEvent, findPaymentRequestBySource, getPaymentRequest, paymentRequestRef, transitionPaymentRequest } from "./repository.server";
import {
  paymentSubmissionRequiresManualReconciliation,
  planBankStatusObservation,
} from "./bank-status-observation";
import { paymentReceiverMatchesSnapshot } from "./reconciliation";
import type { BankPaymentRequest, BankPaymentRequestStatus, LegacyBankPaymentSourceType, PaymentActor, PaymentLegalEntitySnapshot, PixBankPaymentRequest } from "./types";

export async function createPaymentRequest(input: {
  sourceType: LegacyBankPaymentSourceType;
  sourceId: string;
  expenseId?: string;
  beneficiaryReference: PaymentBeneficiaryReference;
  legalEntitySnapshot?: PaymentLegalEntitySnapshot;
  amount: number;
  description: string;
  scheduledFor?: string | null;
}, actor: PaymentActor): Promise<PixBankPaymentRequest> {
  const existing = await findPaymentRequestBySource(input.sourceType, input.sourceId);
  if (existing) {
    if (existing.sourceType === "financial_inbox") throw new Error("A origem da solicitação bancária existente é incompatível.");
    if (Math.abs(existing.amount - Number(input.amount.toFixed(2))) > 0.01
      || existing.expenseId !== input.expenseId
      || existing.beneficiaryReference?.sourceType !== input.beneficiaryReference.sourceType
      || existing.beneficiaryReference?.sourceId !== input.beneficiaryReference.sourceId
      || (existing.scheduledFor ?? null) !== (input.scheduledFor ?? null)) {
      throw new Error("A solicitação bancária existente diverge dos dados aprovados. Faça a conferência antes de continuar.");
    }
    if (existing.expenseId) {
      const expenseRef = financialDbAdmin.collection("expenses").doc(existing.expenseId);
      const expense = await expenseRef.get();
      if (!expense.exists) throw new Error("A despesa vinculada à solicitação não foi encontrada.");
      const linkedRequestId = String(expense.get("paymentRequestId") || "").trim();
      if (linkedRequestId && linkedRequestId !== existing.id) {
        throw new Error("A despesa já possui outra solicitação bancária.");
      }
      if (!linkedRequestId) {
        await expenseRef.set({ paymentRequestId: existing.id, updatedAt: new Date().toISOString() }, { merge: true });
      }
    }
    return existing;
  }
  const beneficiary = await resolvePaymentBeneficiary(input.beneficiaryReference);
  if (!beneficiary.validated) throw new Error("O favorecido ainda não foi validado.");
  const now = new Date().toISOString();
  const ref = paymentRequestRef(randomUUID());
  const status: BankPaymentRequestStatus = "awaiting_financial_authorization";
  if (input.scheduledFor && (!isValidIsoDate(input.scheduledFor) || input.scheduledFor < todayInBelem())) {
    throw new Error("A data programada do pagamento é inválida ou está no passado.");
  }
  const request: PixBankPaymentRequest = {
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
  const eventRef = ref.collection("events").doc(randomUUID());
  await financialDbAdmin.runTransaction(async (transaction) => {
    if (input.expenseId) {
      const expenseRef = financialDbAdmin.collection("expenses").doc(input.expenseId);
      const expense = await transaction.get(expenseRef);
      if (!expense.exists) throw new Error("A despesa vinculada à solicitação não foi encontrada.");
      const linkedRequestId = String(expense.get("paymentRequestId") || "").trim();
      if (linkedRequestId && linkedRequestId !== ref.id) {
        throw new Error("A despesa já possui outra solicitação bancária.");
      }
      transaction.set(expenseRef, { paymentRequestId: ref.id, updatedAt: now }, { merge: true });
    }
    transaction.create(ref, Object.fromEntries(Object.entries(request).filter(([key]) => key !== "id")));
    transaction.create(eventRef, {
      type: "PAYMENT_REQUEST_CREATED",
      at: now,
      actorId: actor.uid,
      actorEmail: actor.email ?? null,
      status,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      amount: request.amount,
    });
  });
  return request;
}

function todayInBelem() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export async function createInboxBarcodePaymentRequest(input: {
  inboxMessageId: string;
  workspaceId: string;
  scheduledFor: string;
  barcode?: string;
}, actor: PaymentActor) {
  const messageRef = financialDbAdmin.collection("financialInboxMessages").doc(input.inboxMessageId);
  const messageSnapshot = await messageRef.get();
  if (!messageSnapshot.exists) throw new Error("Cobrança recebida não encontrada.");
  const message = messageSnapshot.data() as Record<string, any>;
  if (message.workspaceId !== input.workspaceId) throw new Error("Cobrança recebida não encontrada.");
  if (message.existingSettlement?.transactionId) {
    throw new Error("A cobrança já corresponde a um pagamento confirmado no extrato.");
  }
  if (message.existingBankPayment?.transactionId) {
    throw new Error("A parcela já possui um pagamento no Banco Inter. Confira o agendamento existente.");
  }
  const existing = await findPaymentRequestBySource("financial_inbox", input.inboxMessageId);
  if (existing) return existing;
  if (!message.linkedExpenseId) throw new Error("Vincule a cobrança a uma despesa antes de preparar o pagamento.");
  const code = normalizePaymentBarcode(String(input.barcode || message.classification?.barcode || ""));
  if (!code) throw new Error("A cobrança não possui uma linha digitável válida com 44, 46, 47 ou 48 dígitos.");
  const dueDate = String(message.classification?.dueDate || "");
  if (!isValidIsoDate(dueDate)) throw new Error("Confirme o vencimento antes de preparar o pagamento.");
  const scheduledFor = String(input.scheduledFor || "");
  const today = todayInBelem();
  if (!isValidIsoDate(scheduledFor) || scheduledFor < today) {
    throw new Error("A data do pagamento não pode estar no passado.");
  }
  if (dueDate >= today && scheduledFor > dueDate) {
    throw new Error("Escolha uma data até o vencimento da cobrança.");
  }
  const amountCents = Number(message.classification?.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Confirme o valor antes de preparar o pagamento.");

  const now = new Date().toISOString();
  const ref = paymentRequestRef(`inbox_${input.inboxMessageId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 170)}`);
  const request: BankPaymentRequest = {
    id: ref.id,
    sourceType: "financial_inbox",
    sourceId: input.inboxMessageId,
    expenseId: String(message.linkedExpenseId),
    paymentRail: "barcode",
    barcodeSnapshot: {
      type: "barcode",
      code,
      maskedCode: maskPaymentBarcode(code)!,
      dueDate,
      scheduledFor,
      beneficiaryDocument: null,
    },
    amount: amountCents / 100,
    description: String(message.subject || "Pagamento de cobrança").trim().slice(0, 140),
    status: "awaiting_financial_authorization",
    idempotencyKey: randomUUID(),
    statementReconciliationStatus: "not_expected",
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
  };
  const batch = financialDbAdmin.batch();
  batch.create(ref, Object.fromEntries(Object.entries(request).filter(([key]) => key !== "id")));
  batch.set(messageRef, {
    status: "awaiting_authorization",
    bankState: "awaiting_authorization",
    paymentRequestId: ref.id,
    updatedAt: now,
  }, { merge: true });
  batch.create(messageRef.collection("events").doc(), {
    type: "BANK_PAYMENT_PREPARED", at: now, actorId: actor.uid, actorEmail: actor.email ?? null,
    paymentRequestId: ref.id, scheduledFor, amountCents,
  });
  try {
    await batch.commit();
  } catch (error) {
    const code = (error as { code?: number | string })?.code;
    if (code === 6 || code === "already-exists" || String((error as Error)?.message).includes("ALREADY_EXISTS")) {
      return getPaymentRequest(ref.id);
    }
    throw error;
  }
  await addPaymentEvent(ref.id, "PAYMENT_REQUEST_CREATED", actor, {
    status: request.status, sourceType: request.sourceType, sourceId: request.sourceId,
    amount: request.amount, paymentRail: "barcode", scheduledFor,
  });
  return request;
}

export async function authorizePaymentRequest(id: string, actor: PaymentActor) {
  const now = new Date().toISOString();
  const request = await transitionPaymentRequest(id, ["awaiting_financial_authorization"], "ready_to_submit", { authorizedAt: now, authorizedBy: actor.uid });
  await addPaymentEvent(id, "FINANCIAL_AUTHORIZATION_GRANTED", actor);
  if (request.sourceType === "aso" || request.sourceType === "termination" || request.sourceType === "vacation") {
    const notificationId = request.sourceType === "aso"
      ? `aso_payment_${request.sourceId}`
      : request.sourceType === "vacation"
        ? `vacation_payment_${request.sourceId}`
        : `termination_payment_${request.sourceId}`;
    await hrDbAdmin.collection("hrNotifications").doc(notificationId).set({ status: "completed", authorizedAt: now, authorizedBy: actor.uid, updatedAt: now }, { merge: true });
  }
  return request.sourceType === "termination" || request.sourceType === "aso" ? submitPaymentRequest(id, actor) : request;
}

export async function submitPaymentRequest(id: string, actor: PaymentActor | "system") {
  const requestRef = paymentRequestRef(id);
  const submissionStartedAt = new Date().toISOString();
  const submissionEventId = randomUUID();
  const pending = await financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(requestRef);
    if (!snapshot.exists) throw new Error("Solicitação de pagamento não encontrada.");
    const current = { id: snapshot.id, ...snapshot.data() } as BankPaymentRequest;
    if (!["ready_to_submit", "failed"].includes(current.status)) {
      throw new Error(`A solicitação está em ${current.status} e não pode ser enviada ao banco.`);
    }
    if (paymentSubmissionRequiresManualReconciliation(current)) {
      throw new Error("A solicitação possui divergência bancária e exige revisão manual; o reenvio foi bloqueado.");
    }
    const patch = {
      status: "submitting" as const,
      lastError: null,
      submissionStartedAt,
      updatedAt: submissionStartedAt,
    };
    transaction.set(requestRef, patch, { merge: true });
    transaction.set(requestRef.collection("events").doc(submissionEventId), {
      type: "INTER_SUBMISSION_STARTED",
      at: submissionStartedAt,
      actorId: actor === "system" ? "system" : actor.uid,
      actorEmail: actor === "system" ? null : actor.email ?? null,
    });
    return { ...current, ...patch } as BankPaymentRequest;
  });
  try {
    if (pending.paymentRail === "barcode") {
      if (!pending.barcodeSnapshot) throw new Error("Os dados da linha digitável não estão disponíveis.");
      const previous = (await findInterBarcodePaymentsByCode(pending.barcodeSnapshot.code))
        .filter((candidate) => !["REJEITADO", "RECUSADO", "CANCELADO"].includes(String(candidate.statusPagamento || "").toUpperCase()))
        .filter((candidate) => {
          const bankAmount = candidate.valorPago ?? candidate.valorNominal;
          return bankAmount == null || Math.abs(Number(bankAmount) - pending.amount) <= 0.01;
        });
      if (previous.length > 1) {
        throw new Error("O Banco Inter retornou mais de um pagamento para esta linha digitável. Confira no Internet Banking antes de continuar.");
      }
      const recovered = previous[0] ?? null;
      const result = recovered ? {
        quantidadeAprovadores: recovered.aprovacoesNecessarias,
        dataAgendamento: recovered.dataPagamento,
        statusPagamento: recovered.statusPagamento,
        codigoTransacao: recovered.codigoTransacao,
      } : await submitInterBarcodePayment({
          code: pending.barcodeSnapshot.code,
          amount: pending.amount,
          dueDate: pending.barcodeSnapshot.dueDate,
          scheduledFor: pending.barcodeSnapshot.scheduledFor,
          beneficiaryDocument: pending.barcodeSnapshot.beneficiaryDocument,
        });
      const interRequestId = String(result.codigoTransacao ?? "");
      if (!interRequestId) throw new Error("O Banco Inter não retornou o código da transação.");
      const approvalRequired = recovered
        ? Number(recovered.aprovacoesRealizadas || 0) < Number(recovered.aprovacoesNecessarias || 0)
        : Number(result.quantidadeAprovadores || 0) > 0;
      const mapped = approvalRequired
        ? "awaiting_bank_approval" as const
        : mapInterBarcodeStatus(result.statusPagamento, pending.barcodeSnapshot.scheduledFor);
      const next = mapped === "paid" ? "awaiting_statement" as const : mapped;
      const submittedAt = new Date().toISOString();
      const observation = planBankStatusObservation({
        current: pending,
        nextStatus: next,
        rawBankStatus: result.statusPagamento,
        observedAt: submittedAt,
        scheduledFor: pending.barcodeSnapshot.scheduledFor,
      });
      const requestPatch = {
        status: next,
        updatedAt: submittedAt,
        interRequestId,
        submittedAt,
        ...observation.patch,
        statementReconciliationStatus: "expected" as const,
      };
      const requestRef = paymentRequestRef(id);
      const expectedDebitRef = financialDbAdmin.collection("expectedBankDebits").doc(`request_${id}`);
      const messageRef = financialDbAdmin.collection("financialInboxMessages").doc(pending.sourceId);
      const expectedStatus = next === "awaiting_statement" ? "awaiting_statement" : "active";
      const requestEventId = randomUUID();
      const messageEventId = randomUUID();
      const request = await financialDbAdmin.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(requestRef);
        if (!currentSnapshot.exists || currentSnapshot.get("status") !== "submitting") {
          throw new Error("A solicitação mudou enquanto o Banco Inter processava o envio.");
        }
        transaction.set(requestRef, requestPatch, { merge: true });
        transaction.set(expectedDebitRef, {
          workspaceId: WORKSPACE_ID,
          status: expectedStatus,
          paymentRequestId: id,
          financialInboxMessageId: pending.sourceId,
          expenseId: pending.expenseId,
          amountCents: Math.round(pending.amount * 100),
          expectedDate: pending.barcodeSnapshot.scheduledFor,
          dueDate: pending.barcodeSnapshot.dueDate,
          bankTransactionCode: interRequestId,
          barcodeLastDigits: pending.barcodeSnapshot.code.slice(-8),
          createdAt: submittedAt,
          updatedAt: submittedAt,
        }, { merge: true });
        transaction.set(messageRef, {
          status: next === "scheduled" ? "scheduled" : next === "awaiting_statement" ? "awaiting_statement" : "linked",
          bankState: next,
          updatedAt: submittedAt,
        }, { merge: true });
        transaction.set(messageRef.collection("events").doc(messageEventId), {
          type: "INTER_BARCODE_PAYMENT_ACCEPTED",
          at: submittedAt,
          actorId: actor === "system" ? "system" : actor.uid,
          interRequestId,
          bankStatus: result.statusPagamento ?? null,
          scheduledFor: pending.barcodeSnapshot.scheduledFor,
        });
        transaction.set(requestRef.collection("events").doc(requestEventId), {
          type: approvalRequired ? "BANK_APPROVAL_REQUIRED" : "INTER_SUBMISSION_ACCEPTED",
          at: submittedAt,
          actorId: actor === "system" ? "system" : actor.uid,
          actorEmail: actor === "system" ? null : actor.email ?? null,
          interRequestId,
          bankStatus: result.statusPagamento ?? null,
          scheduledFor: pending.barcodeSnapshot.scheduledFor,
          recoveredFromBankPreflight: Boolean(recovered),
        });
        return { ...pending, ...requestPatch } as BankPaymentRequest;
      });
      return request;
    }
    if (!pending.beneficiaryReference || !pending.beneficiarySnapshot) {
      throw new Error("Os dados do favorecido não estão disponíveis.");
    }
    const beneficiary = await resolvePaymentBeneficiary(pending.beneficiaryReference);
    if (beneficiary.sourceUpdatedAt !== pending.beneficiarySnapshot.sourceUpdatedAt) {
      throw new Error("Os dados do favorecido mudaram após a criação. Crie uma nova solicitação para revalidar o pagamento.");
    }
    if (!pending.beneficiarySnapshot.documentHash) {
      const refreshedSnapshot = createBeneficiarySnapshot(beneficiary, pending.beneficiarySnapshot.resolvedAt);
      if (refreshedSnapshot.documentHash) {
        pending.beneficiarySnapshot = {
          ...pending.beneficiarySnapshot,
          documentHash: refreshedSnapshot.documentHash,
        };
        await paymentRequestRef(id).set({ beneficiarySnapshot: pending.beneficiarySnapshot }, { merge: true });
      }
    }
    const result = await submitInterPix({
      idempotencyKey: pending.idempotencyKey,
      amount: pending.amount,
      description: pending.description,
      beneficiary,
      scheduledFor: pending.scheduledFor,
    });
    const interRequestId = String(result.codigoSolicitacao ?? "");
    if (!interRequestId) throw new Error("O Banco Inter não retornou o código da solicitação.");
    const approval = String(result.tipoRetorno ?? "").toUpperCase() === "APROVACAO";
    const next = approval
      ? "awaiting_bank_approval"
      : result.dataPagamento && result.dataPagamento > todayInBelem()
        ? "scheduled"
        : "processing";
    const submittedAt = new Date().toISOString();
    const observation = planBankStatusObservation({
      current: pending,
      nextStatus: next,
      rawBankStatus: result.tipoRetorno,
      observedAt: submittedAt,
      scheduledFor: result.dataPagamento ?? pending.scheduledFor,
    });
    const requestPatch = {
      status: next,
      updatedAt: submittedAt,
      interRequestId,
      submittedAt,
      ...observation.patch,
    };
    const requestRef = paymentRequestRef(id);
    const eventId = randomUUID();
    const request = await financialDbAdmin.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(requestRef);
      if (!snapshot.exists || snapshot.get("status") !== "submitting") {
        throw new Error("A solicitação mudou enquanto o Banco Inter processava o envio.");
      }
      transaction.set(requestRef, requestPatch, { merge: true });
      transaction.set(requestRef.collection("events").doc(eventId), {
        type: approval ? "BANK_APPROVAL_REQUIRED" : "INTER_SUBMISSION_ACCEPTED",
        at: submittedAt,
        actorId: actor === "system" ? "system" : actor.uid,
        actorEmail: actor === "system" ? null : actor.email ?? null,
        interRequestId,
        bankReturnType: result.tipoRetorno ?? null,
      });
      return { ...pending, ...requestPatch } as BankPaymentRequest;
    });
    return request;
  } catch (error) {
    const lastError = safeInterPaymentError(error);
    await transitionPaymentRequest(id, ["submitting"], "failed", { lastError });
    await addPaymentEvent(id, "INTER_SUBMISSION_FAILED", actor, { code: lastError.code });
    throw new Error(lastError.safeMessage);
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
        maskedDestination: request.beneficiarySnapshot?.maskedPaymentDestination ?? "Destino protegido",
        lastError: null,
      },
      lastActivityAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return;
  }
  if (request.sourceType === "vacation") {
    const { completeVacationPayment } = await import("@/features/hr/vacations/payment-completion.server");
    await completeVacationPayment({
      vacationId: request.sourceId,
      paymentRequestId: request.id,
      amount: request.amount,
      paidAt: request.paidAt ?? new Date().toISOString(),
      proofStoragePath: request.proofStoragePath ?? null,
    });
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

async function attachFinancialInboxProof(request: BankPaymentRequest) {
  if (request.sourceType !== "financial_inbox" || !request.proofStoragePath) return;
  const now = new Date().toISOString();
  const batch = financialDbAdmin.batch();
  batch.set(financialDbAdmin.collection("financialInboxMessages").doc(request.sourceId), {
    paymentProofStoragePath: request.proofStoragePath,
    updatedAt: now,
  }, { merge: true });
  if (request.expenseId) {
    batch.set(financialDbAdmin.collection("expenses").doc(request.expenseId), {
      paymentProofStoragePath: request.proofStoragePath,
      updatedAt: now,
    }, { merge: true });
  }
  await batch.commit();
}

// O endpoint tem timeout operacional de cinco minutos. A trava dura o dobro
// para que uma nova execução não assuma o trabalho antes da anterior terminar.
const POST_PAYMENT_LEASE_MS = 10 * 60_000;

async function claimPostPaymentProcessing(id: string) {
  const leaseId = randomUUID();
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + POST_PAYMENT_LEASE_MS).toISOString();
  return financialDbAdmin.runTransaction(async (transaction) => {
    const ref = paymentRequestRef(id);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error("Solicitação de pagamento não encontrada.");
    const current = { id: snapshot.id, ...snapshot.data() } as BankPaymentRequest;
    if (current.status !== "paid" || current.postPaymentProcessingStatus === "completed") return null;
    const currentLease = current.postPaymentProcessingLeaseUntil
      ? new Date(current.postPaymentProcessingLeaseUntil)
      : null;
    if (currentLease && !Number.isNaN(currentLease.getTime()) && currentLease > now) return null;
    const attemptCount = (current.postPaymentProcessingAttemptCount ?? 0) + 1;
    const patch = {
      postPaymentProcessingStatus: "pending" as const,
      postPaymentProcessingAttemptCount: attemptCount,
      postPaymentProcessingLeaseId: leaseId,
      postPaymentProcessingLeaseUntil: leaseUntil,
      nextPostPaymentAttemptAt: leaseUntil,
      updatedAt: now.toISOString(),
    };
    transaction.set(ref, patch, { merge: true });
    return { leaseId, request: { ...current, ...patch } as BankPaymentRequest };
  });
}

async function releasePostPaymentProcessingAfterFailure(
  id: string,
  leaseId: string,
  attemptCount: number,
  error: unknown,
) {
  const now = new Date();
  const delayMinutes = Math.min(360, 5 * (2 ** Math.min(Math.max(attemptCount - 1, 0), 6)));
  const nextAttemptAt = new Date(now.getTime() + delayMinutes * 60_000).toISOString();
  const safeError = safeInterPaymentError(error, now.toISOString());
  await financialDbAdmin.runTransaction(async (transaction) => {
    const ref = paymentRequestRef(id);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.get("postPaymentProcessingLeaseId") !== leaseId) return;
    transaction.set(ref, {
      postPaymentProcessingStatus: "pending",
      postPaymentProcessingLeaseId: null,
      postPaymentProcessingLeaseUntil: null,
      nextPostPaymentAttemptAt: nextAttemptAt,
      lastPostPaymentError: safeError,
      updatedAt: now.toISOString(),
    }, { merge: true });
  });
}

async function completePostPaymentProcessingLease(
  current: BankPaymentRequest,
  leaseId: string,
) {
  return financialDbAdmin.runTransaction(async (transaction) => {
    const ref = paymentRequestRef(current.id);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.get("postPaymentProcessingLeaseId") !== leaseId) {
      throw new Error("A trava do pós-pagamento expirou antes da conclusão.");
    }
    const updatedAt = new Date().toISOString();
    const patch = {
      postPaymentProcessingStatus: "completed" as const,
      postPaymentProcessingLeaseId: null,
      postPaymentProcessingLeaseUntil: null,
      nextPostPaymentAttemptAt: null,
      lastPostPaymentError: null,
      updatedAt,
    };
    transaction.set(ref, patch, { merge: true });
    return { ...current, ...patch } as BankPaymentRequest;
  });
}

async function persistPostPaymentStep(params: {
  current: BankPaymentRequest;
  leaseId: string;
  patch: Record<string, unknown>;
  eventId: string;
  eventType: string;
  eventData?: Record<string, unknown>;
}) {
  return financialDbAdmin.runTransaction(async (transaction) => {
    const ref = paymentRequestRef(params.current.id);
    const snapshot = await transaction.get(ref);
    if (
      !snapshot.exists
      || snapshot.get("status") !== "paid"
      || snapshot.get("postPaymentProcessingLeaseId") !== params.leaseId
    ) {
      throw new Error("A trava do pós-pagamento não está mais válida.");
    }
    const updatedAt = new Date().toISOString();
    transaction.set(ref, { ...params.patch, updatedAt }, { merge: true });
    transaction.set(ref.collection("events").doc(params.eventId), {
      type: params.eventType,
      at: updatedAt,
      actorId: "system",
      actorEmail: null,
      ...params.eventData,
    }, { merge: true });
    return {
      ...params.current,
      ...snapshot.data(),
      ...params.patch,
      updatedAt,
    } as BankPaymentRequest;
  });
}

async function finishPaidPaymentRequest(request: BankPaymentRequest) {
  if (
    request.postPaymentProcessingStatus === "completed"
    && request.proofStoragePath
    && request.sourceCompletedAt
  ) return request;
  const claim = await claimPostPaymentProcessing(request.id);
  if (!claim) return request;
  let current = claim.request;
  try {
    if (!current.proofStoragePath) {
      const proofStoragePath = await createAndStoreConfirmedPaymentProof(current);
      current = await persistPostPaymentStep({
        current,
        leaseId: claim.leaseId,
        patch: { proofStoragePath },
        eventId: "post-payment-proof-stored-v1",
        eventType: "PAYMENT_PROOF_STORED",
        eventData: { proofStoragePath },
      });
    }
    if (current.sourceType === "financial_inbox") {
      await attachFinancialInboxProof(current);
    } else if (!current.sourceCompletedAt) {
      await completeSource(current);
    }
    if (!current.sourceCompletedAt) {
      const sourceCompletedAt = new Date().toISOString();
      current = await persistPostPaymentStep({
        current,
        leaseId: claim.leaseId,
        patch: { sourceCompletedAt },
        eventId: "post-payment-source-completed-v1",
        eventType: "SOURCE_COMPLETED_AFTER_PAYMENT",
        eventData: {
          sourceType: current.sourceType,
          sourceId: current.sourceId,
        },
      });
    }
    current = await completePostPaymentProcessingLease(current, claim.leaseId);
    return current;
  } catch (error) {
    await releasePostPaymentProcessingAfterFailure(
      current.id,
      claim.leaseId,
      current.postPaymentProcessingAttemptCount ?? 1,
      error,
    );
    throw error;
  }
}

export async function deferBankStatusRefreshAfterFailure(id: string, now = new Date()) {
  await financialDbAdmin.runTransaction(async (transaction) => {
    const ref = paymentRequestRef(id);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const status = snapshot.get("status") as BankPaymentRequestStatus;
    if (!["awaiting_bank_approval", "scheduled", "processing"].includes(status)) return;
    const failureCount = (Number(snapshot.get("bankStatusPollFailureCount")) || 0) + 1;
    const delayMinutes = Math.min(60, 5 * (2 ** Math.min(failureCount, 3)));
    transaction.set(ref, {
      bankStatusPollFailureCount: failureCount,
      nextBankStatusCheckAt: new Date(now.getTime() + delayMinutes * 60_000).toISOString(),
      updatedAt: now.toISOString(),
    }, { merge: true });
  });
}

export async function markStalePaymentSubmissionForReview(
  id: string,
  staleBefore: Date,
) {
  const eventId = randomUUID();
  return financialDbAdmin.runTransaction(async (transaction) => {
    const ref = paymentRequestRef(id);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.get("status") !== "submitting") return null;
    const startedAt = new Date(String(snapshot.get("submissionStartedAt") || snapshot.get("updatedAt") || ""));
    if (Number.isNaN(startedAt.getTime()) || startedAt > staleBefore) return null;
    const occurredAt = new Date().toISOString();
    const lastError = {
      code: "INTER_SUBMISSION_RESULT_UNKNOWN",
      safeMessage: "O envio ao banco foi interrompido antes da confirmação interna. Revise a solicitação; um novo envio usará a mesma chave idempotente ou recuperará o boleto no Inter.",
      occurredAt,
    };
    transaction.set(ref, {
      status: "failed",
      lastError,
      updatedAt: occurredAt,
    }, { merge: true });
    transaction.set(ref.collection("events").doc(eventId), {
      type: "INTER_SUBMISSION_RESULT_UNKNOWN",
      at: occurredAt,
      actorId: "system",
      actorEmail: null,
    });
    return { id, status: "failed" as const };
  });
}

async function persistBarcodeBankObservation(params: {
  id: string;
  nextStatus: BankPaymentRequestStatus;
  rawBankStatus?: string | null;
  scheduledFor: string;
  bankAuthentication?: string | null;
  bankNsu?: string | null;
  actor: PaymentActor | "system";
  observedAt: string;
}) {
  const eventId = randomUUID();
  return financialDbAdmin.runTransaction(async (transaction) => {
    const requestRef = paymentRequestRef(params.id);
    const snapshot = await transaction.get(requestRef);
    if (!snapshot.exists) throw new Error("Solicitação de pagamento não encontrada.");
    const current = { id: snapshot.id, ...snapshot.data() } as BankPaymentRequest;
    if (
      current.paymentRail !== "barcode"
      || current.sourceType !== "financial_inbox"
      || !["awaiting_bank_approval", "scheduled", "processing", "failed"].includes(current.status)
    ) return current;
    const observation = planBankStatusObservation({
      current,
      nextStatus: params.nextStatus,
      rawBankStatus: params.rawBankStatus,
      observedAt: params.observedAt,
      scheduledFor: params.scheduledFor,
    });
    if (!observation.changed) return current;
    const patch = {
      status: params.nextStatus,
      updatedAt: params.observedAt,
      bankStatusPollFailureCount: 0,
      ...observation.patch,
      ...(params.nextStatus === "awaiting_statement" ? { statementReconciliationStatus: "expected" as const } : {}),
    };
    transaction.set(requestRef, patch, { merge: true });
    if (observation.statusChanged || observation.bankStatusChanged) {
      transaction.set(financialDbAdmin.collection("expectedBankDebits").doc(`request_${params.id}`), {
        status: params.nextStatus === "awaiting_statement"
          ? "awaiting_statement"
          : ["rejected", "approval_expired"].includes(params.nextStatus)
            ? "cancelled"
            : "active",
        bankStatus: params.rawBankStatus ?? null,
        bankAuthentication: params.bankAuthentication ?? null,
        bankNsu: params.bankNsu ?? null,
        updatedAt: params.observedAt,
      }, { merge: true });
      transaction.set(financialDbAdmin.collection("financialInboxMessages").doc(current.sourceId), {
        status: params.nextStatus === "scheduled"
          ? "scheduled"
          : params.nextStatus === "awaiting_statement"
            ? "awaiting_statement"
            : "linked",
        bankState: params.nextStatus,
        updatedAt: params.observedAt,
      }, { merge: true });
    }
    if (observation.shouldWriteAuditEvent) {
      transaction.set(requestRef.collection("events").doc(eventId), {
        type: observation.approvalObserved ? "BANK_APPROVAL_OBSERVED" : "BANK_STATUS_RECONCILED",
        at: params.observedAt,
        actorId: params.actor === "system" ? "system" : params.actor.uid,
        actorEmail: params.actor === "system" ? null : params.actor.email ?? null,
        bankStatus: params.rawBankStatus ?? null,
        status: params.nextStatus,
        observedAt: params.observedAt,
        ...(observation.schedulingObserved ? { scheduledFor: params.scheduledFor } : {}),
      });
    }
    return { ...current, ...patch } as BankPaymentRequest;
  });
}

async function persistPixBankObservation(params: {
  id: string;
  nextStatus: BankPaymentRequestStatus;
  rawBankStatus: string;
  scheduledFor?: string | null;
  endToEndId?: string | null;
  paidAt?: string | null;
  actor: PaymentActor | "system";
  observedAt: string;
}) {
  const eventId = randomUUID();
  return financialDbAdmin.runTransaction(async (transaction) => {
    const requestRef = paymentRequestRef(params.id);
    const snapshot = await transaction.get(requestRef);
    if (!snapshot.exists) throw new Error("Solicitação de pagamento não encontrada.");
    const current = { id: snapshot.id, ...snapshot.data() } as BankPaymentRequest;
    if (
      current.paymentRail === "barcode"
      || !["awaiting_bank_approval", "scheduled", "processing", "failed", "rejected", "approval_expired"].includes(current.status)
    ) return current;
    const observation = planBankStatusObservation({
      current,
      nextStatus: params.nextStatus,
      rawBankStatus: params.rawBankStatus,
      observedAt: params.observedAt,
      scheduledFor: params.scheduledFor,
    });
    const patch: Record<string, unknown> = { ...observation.patch };
    if ((current.bankStatusPollFailureCount ?? 0) !== 0) patch.bankStatusPollFailureCount = 0;
    if ((current.endToEndId ?? null) !== (params.endToEndId ?? null)) {
      patch.endToEndId = params.endToEndId ?? null;
    }
    if (params.nextStatus === "paid") {
      patch.paidAt = params.paidAt ?? params.observedAt;
      patch.postPaymentProcessingStatus = "pending";
      patch.nextPostPaymentAttemptAt = params.observedAt;
    }
    if (!observation.changed && Object.keys(patch).length === 0) return current;
    const updatedAt = params.observedAt;
    transaction.set(requestRef, {
      status: params.nextStatus,
      updatedAt,
      ...patch,
    }, { merge: true });
    if (observation.shouldWriteAuditEvent) {
      transaction.set(requestRef.collection("events").doc(eventId), {
        type: observation.approvalObserved ? "BANK_APPROVAL_OBSERVED" : "BANK_STATUS_RECONCILED",
        at: updatedAt,
        actorId: params.actor === "system" ? "system" : params.actor.uid,
        actorEmail: params.actor === "system" ? null : params.actor.email ?? null,
        bankStatus: params.rawBankStatus,
        status: params.nextStatus,
        observedAt: updatedAt,
      });
    }
    return {
      ...current,
      status: params.nextStatus,
      updatedAt,
      ...patch,
    } as BankPaymentRequest;
  });
}

async function blockBankReconciliationDivergence(params: {
  id: string;
  actor: PaymentActor | "system";
  field: "amount" | "beneficiary_source" | "receiver";
  rawBankStatus?: string | null;
  safeMessage: string;
}) {
  const eventId = randomUUID();
  const observedAt = new Date().toISOString();
  await financialDbAdmin.runTransaction(async (transaction) => {
    const requestRef = paymentRequestRef(params.id);
    const snapshot = await transaction.get(requestRef);
    if (!snapshot.exists || snapshot.get("status") === "paid") return;
    const current = { id: snapshot.id, ...snapshot.data() } as BankPaymentRequest;
    const sameDivergenceAlreadyRecorded = current.status === "failed"
      && current.statementReconciliationStatus === "divergent"
      && current.lastError?.code === "BANK_RECONCILIATION_DIVERGENCE"
      && (current.bankStatus ?? null) === (params.rawBankStatus ?? null);
    if (sameDivergenceAlreadyRecorded) return;
    transaction.set(requestRef, {
      status: "failed",
      bankStatus: params.rawBankStatus ?? null,
      bankStatusPollFailureCount: 0,
      nextBankStatusCheckAt: null,
      statementReconciliationStatus: "divergent",
      bankReconciliationDivergenceField: params.field,
      lastError: {
        code: "BANK_RECONCILIATION_DIVERGENCE",
        safeMessage: params.safeMessage,
        occurredAt: observedAt,
      },
      updatedAt: observedAt,
    }, { merge: true });
    if (current.sourceType === "financial_inbox") {
      transaction.set(financialDbAdmin.collection("expectedBankDebits").doc(`request_${params.id}`), {
        status: "divergent",
        bankStatus: params.rawBankStatus ?? null,
        updatedAt: observedAt,
      }, { merge: true });
      transaction.set(financialDbAdmin.collection("financialInboxMessages").doc(current.sourceId), {
        status: "divergent",
        bankState: "divergent",
        updatedAt: observedAt,
      }, { merge: true });
    }
    transaction.set(requestRef.collection("events").doc(eventId), {
      type: "BANK_RECONCILIATION_DIVERGENCE",
      at: observedAt,
      actorId: params.actor === "system" ? "system" : params.actor.uid,
      actorEmail: params.actor === "system" ? null : params.actor.email ?? null,
      field: params.field,
      bankStatus: params.rawBankStatus ?? null,
    });
  });
}

export async function refreshPaymentRequest(id: string, actor: PaymentActor | "system") {
  let current = await getPaymentRequest(id);
  if (current.paymentRail === "barcode") {
    if (current.status === "paid") return finishPaidPaymentRequest(current);
    if (current.status === "awaiting_statement") return current;
    if (!current.interRequestId || !current.barcodeSnapshot) throw new Error("A solicitação ainda não foi enviada ao Banco Inter.");
    const bank = await getInterBarcodePayment(current.interRequestId);
    if (!bank) throw new Error("O Banco Inter ainda não retornou este pagamento.");
    const nextBank = mapInterBarcodeStatus(bank.statusPagamento, current.barcodeSnapshot.scheduledFor);
    if (bank.valorPago != null && Math.abs(Number(bank.valorPago) - current.amount) > 0.01) {
      const safeMessage = "O valor retornado pelo banco diverge da cobrança. A baixa foi bloqueada.";
      await blockBankReconciliationDivergence({
        id,
        actor,
        field: "amount",
        rawBankStatus: bank.statusPagamento,
        safeMessage,
      });
      throw new Error(safeMessage);
    }
    const next = nextBank === "paid" ? "awaiting_statement" as const : nextBank;
    const observedAt = new Date().toISOString();
    return persistBarcodeBankObservation({
      id,
      nextStatus: next,
      rawBankStatus: bank.statusPagamento,
      scheduledFor: current.barcodeSnapshot.scheduledFor,
      bankAuthentication: bank.autenticacao ? String(bank.autenticacao) : null,
      bankNsu: bank.nsu ?? null,
      actor,
      observedAt,
    });
  }
  if (current.status === "paid") {
    return finishPaidPaymentRequest(current);
  }
  if (!current.interRequestId) throw new Error("A solicitação ainda não foi enviada ao Banco Inter.");
  if (!current.beneficiaryReference || !current.beneficiarySnapshot) throw new Error("Os dados do favorecido não estão disponíveis.");
  const bank = await getInterPixStatus(current.interRequestId);
  const transaction = bank.transacaoPix ?? {};
  const rawStatus = String(transaction.status ?? "");
  const next = mapInterPixStatus(rawStatus, current.scheduledFor);
  if (Number(transaction.valor ?? 0).toFixed(2) !== Number(current.amount).toFixed(2)) {
    const safeMessage = "O valor confirmado pelo banco diverge da solicitação. O pagamento não foi baixado.";
    await blockBankReconciliationDivergence({ id, actor, field: "amount", rawBankStatus: rawStatus, safeMessage });
    throw new Error(safeMessage);
  }
  if (!current.beneficiarySnapshot.documentHash) {
    const beneficiary = await resolvePaymentBeneficiary(current.beneficiaryReference);
    if (beneficiary.sourceUpdatedAt !== current.beneficiarySnapshot.sourceUpdatedAt) {
      const safeMessage = "Os dados do favorecido mudaram após o envio. O pagamento exige conferência manual antes da baixa.";
      await blockBankReconciliationDivergence({
        id,
        actor,
        field: "beneficiary_source",
        rawBankStatus: rawStatus,
        safeMessage,
      });
      throw new Error(safeMessage);
    }
    const refreshedSnapshot = createBeneficiarySnapshot(beneficiary, current.beneficiarySnapshot.resolvedAt);
    if (!refreshedSnapshot.documentHash) {
      const safeMessage = "Não foi possível validar com segurança o documento do favorecido confirmado pelo banco.";
      await blockBankReconciliationDivergence({
        id,
        actor,
        field: "beneficiary_source",
        rawBankStatus: rawStatus,
        safeMessage,
      });
      throw new Error(safeMessage);
    }
    current = {
      ...current,
      beneficiarySnapshot: {
        ...current.beneficiarySnapshot,
        documentHash: refreshedSnapshot.documentHash,
      },
    };
    await paymentRequestRef(id).set({ beneficiarySnapshot: current.beneficiarySnapshot }, { merge: true });
    await addPaymentEvent(id, "BENEFICIARY_DOCUMENT_HASH_BACKFILLED", "system", { sourceType: current.beneficiaryReference.sourceType });
  }
  if (!paymentReceiverMatchesSnapshot({
    receiverDocument: transaction.recebedor?.cpfCnpj,
    snapshotDocument: current.beneficiarySnapshot.document,
    snapshotDocumentHash: current.beneficiarySnapshot.documentHash,
  })) {
    const safeMessage = "O favorecido confirmado pelo banco diverge da solicitação. O pagamento não foi baixado.";
    await blockBankReconciliationDivergence({ id, actor, field: "receiver", rawBankStatus: rawStatus, safeMessage });
    throw new Error(safeMessage);
  }
  const observedAt = new Date().toISOString();
  let updated = await persistPixBankObservation({
    id,
    nextStatus: next,
    rawBankStatus: rawStatus,
    scheduledFor: current.scheduledFor,
    endToEndId: transaction.endToEnd,
    paidAt: transaction.dataHoraMovimento,
    actor,
    observedAt,
  });
  if (next === "paid") updated = await finishPaidPaymentRequest(updated);
  return updated;
}
