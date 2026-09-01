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
  await ref.create(Object.fromEntries(Object.entries(request).filter(([key]) => key !== "id")));
  await addPaymentEvent(ref.id, "PAYMENT_REQUEST_CREATED", actor, { status, sourceType: input.sourceType, sourceId: input.sourceId, amount: request.amount });
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
  const pending = await transitionPaymentRequest(id, ["ready_to_submit", "failed"], "submitting", { lastError: null });
  await addPaymentEvent(id, "INTER_SUBMISSION_STARTED", actor);
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
      const request = await transitionPaymentRequest(id, ["submitting"], next, {
        interRequestId,
        submittedAt,
        bankStatus: result.statusPagamento ?? null,
        statementReconciliationStatus: "expected",
      });
      const expectedDebitRef = financialDbAdmin.collection("expectedBankDebits").doc(`request_${id}`);
      const messageRef = financialDbAdmin.collection("financialInboxMessages").doc(pending.sourceId);
      const expectedStatus = next === "awaiting_statement" ? "awaiting_statement" : "active";
      const batch = financialDbAdmin.batch();
      batch.set(expectedDebitRef, {
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
      batch.set(messageRef, {
        status: next === "scheduled" ? "scheduled" : next === "awaiting_statement" ? "awaiting_statement" : "linked",
        bankState: next,
        updatedAt: submittedAt,
      }, { merge: true });
      batch.create(messageRef.collection("events").doc(), {
        type: "INTER_BARCODE_PAYMENT_ACCEPTED", at: submittedAt,
        actorId: actor === "system" ? "system" : actor.uid,
        interRequestId, bankStatus: result.statusPagamento ?? null, scheduledFor: pending.barcodeSnapshot.scheduledFor,
      });
      await batch.commit();
      await addPaymentEvent(id, approvalRequired ? "BANK_APPROVAL_REQUIRED" : "INTER_SUBMISSION_ACCEPTED", actor, {
        interRequestId, bankStatus: result.statusPagamento ?? null, scheduledFor: pending.barcodeSnapshot.scheduledFor,
        recoveredFromBankPreflight: Boolean(recovered),
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
    const request = await transitionPaymentRequest(id, ["submitting"], next, { interRequestId, submittedAt: new Date().toISOString(), bankStatus: result.tipoRetorno ?? null });
    await addPaymentEvent(id, approval ? "BANK_APPROVAL_REQUIRED" : "INTER_SUBMISSION_ACCEPTED", actor, { interRequestId, bankReturnType: result.tipoRetorno ?? null });
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

export async function refreshPaymentRequest(id: string, actor: PaymentActor | "system") {
  let current = await getPaymentRequest(id);
  if (current.paymentRail === "barcode") {
    if (current.status === "awaiting_statement" || current.status === "paid") return current;
    if (!current.interRequestId || !current.barcodeSnapshot) throw new Error("A solicitação ainda não foi enviada ao Banco Inter.");
    const bank = await getInterBarcodePayment(current.interRequestId);
    if (!bank) throw new Error("O Banco Inter ainda não retornou este pagamento.");
    const nextBank = mapInterBarcodeStatus(bank.statusPagamento, current.barcodeSnapshot.scheduledFor);
    if (bank.valorPago != null && Math.abs(Number(bank.valorPago) - current.amount) > 0.01) {
      await addPaymentEvent(id, "BANK_RECONCILIATION_DIVERGENCE", actor, { field: "amount", bankStatus: bank.statusPagamento ?? null });
      await transitionPaymentRequest(id, ["awaiting_bank_approval", "scheduled", "processing", "failed"], "failed", {
        bankStatus: bank.statusPagamento ?? null,
        statementReconciliationStatus: "divergent",
      });
      throw new Error("O valor retornado pelo banco diverge da cobrança. A baixa foi bloqueada.");
    }
    const next = nextBank === "paid" ? "awaiting_statement" as const : nextBank;
    const updatedAt = new Date().toISOString();
    const updated = await transitionPaymentRequest(id, ["awaiting_bank_approval", "scheduled", "processing", "failed"], next, {
      bankStatus: bank.statusPagamento ?? null,
      ...(next === "awaiting_statement" ? { statementReconciliationStatus: "expected" } : {}),
    });
    const batch = financialDbAdmin.batch();
    batch.set(financialDbAdmin.collection("expectedBankDebits").doc(`request_${id}`), {
      status: next === "awaiting_statement" ? "awaiting_statement" : ["rejected", "approval_expired"].includes(next) ? "cancelled" : "active",
      bankStatus: bank.statusPagamento ?? null,
      bankAuthentication: bank.autenticacao ? String(bank.autenticacao) : null,
      bankNsu: bank.nsu ?? null,
      updatedAt,
    }, { merge: true });
    batch.set(financialDbAdmin.collection("financialInboxMessages").doc(current.sourceId), {
      status: next === "scheduled" ? "scheduled" : next === "awaiting_statement" ? "awaiting_statement" : "linked",
      bankState: next,
      updatedAt,
    }, { merge: true });
    await batch.commit();
    await addPaymentEvent(id, "BANK_STATUS_RECONCILED", actor, { bankStatus: bank.statusPagamento ?? null, status: next });
    return updated;
  }
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
  if (!current.beneficiaryReference || !current.beneficiarySnapshot) throw new Error("Os dados do favorecido não estão disponíveis.");
  const bank = await getInterPixStatus(current.interRequestId);
  const transaction = bank.transacaoPix ?? {};
  const rawStatus = String(transaction.status ?? "");
  const next = mapInterPixStatus(rawStatus, current.scheduledFor);
  if (Number(transaction.valor ?? 0).toFixed(2) !== Number(current.amount).toFixed(2)) {
    await addPaymentEvent(id, "BANK_RECONCILIATION_DIVERGENCE", actor, { field: "amount", bankStatus: rawStatus });
    throw new Error("O valor confirmado pelo banco diverge da solicitação. O pagamento não foi baixado.");
  }
  if (!current.beneficiarySnapshot.documentHash) {
    const beneficiary = await resolvePaymentBeneficiary(current.beneficiaryReference);
    if (beneficiary.sourceUpdatedAt !== current.beneficiarySnapshot.sourceUpdatedAt) {
      await addPaymentEvent(id, "BANK_RECONCILIATION_DIVERGENCE", actor, { field: "beneficiary_source", bankStatus: rawStatus });
      throw new Error("Os dados do favorecido mudaram após o envio. O pagamento exige conferência manual antes da baixa.");
    }
    const refreshedSnapshot = createBeneficiarySnapshot(beneficiary, current.beneficiarySnapshot.resolvedAt);
    if (!refreshedSnapshot.documentHash) {
      throw new Error("Não foi possível validar com segurança o documento do favorecido confirmado pelo banco.");
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
    await addPaymentEvent(id, "BANK_RECONCILIATION_DIVERGENCE", actor, { field: "receiver", bankStatus: rawStatus });
    throw new Error("O favorecido confirmado pelo banco diverge da solicitação. O pagamento não foi baixado.");
  }
  const patch: Record<string, unknown> = { bankStatus: rawStatus, endToEndId: transaction.endToEnd ?? null };
  if (next === "paid") patch.paidAt = transaction.dataHoraMovimento ?? new Date().toISOString();
  let updated = await transitionPaymentRequest(id, ["awaiting_bank_approval", "scheduled", "processing", "failed", "rejected", "approval_expired"], next, patch);
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
