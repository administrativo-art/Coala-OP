import { randomUUID } from "node:crypto";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { createBeneficiarySnapshot, resolvePaymentBeneficiary } from "../beneficiaries/resolver.server";
import type { PaymentBeneficiaryReference } from "../beneficiaries/types";
import { createAndStoreConfirmedPaymentProof } from "@/lib/integrations/inter/proof.server";
import { safeInterPaymentError } from "@/lib/integrations/inter/payment-error";
import { cancelInterBarcodePayment, findInterBarcodePaymentsByCode, getInterBarcodePayment, mapInterBarcodeStatus, submitInterBarcodePayment } from "@/lib/integrations/inter/barcode-payments.server";
import { getInterPixStatus, mapInterPixStatus, submitInterPix } from "@/lib/integrations/inter/pix-payments.server";
import { listInterStatementEntries } from "@/lib/integrations/inter/statements.server";
import { maskPaymentBarcode, normalizePaymentBarcode } from "@/features/financial/inbox/parser";
import { paymentBarcodeHash } from "@/features/financial/inbox/document-identity";
import { assertExpenseBoletoTarget, expenseBoletoAttachmentId, expenseBoletoSchema } from "./expense-boleto";
import { inboxBarcodePaymentPreparationSchema } from "./inbox-barcode";
import { assertSalaryPaymentTarget } from "./salary-payment";
import { assertExpenseComplementPaymentTarget } from "./expense-complement";
import { WORKSPACE_ID } from "@/lib/workspace";
import { addPaymentEvent, findPaymentRequestBySource, getPaymentRequest, paymentRequestRef, revalidatePaidPaymentBeneficiary, transitionPaymentRequest } from "./repository.server";
import {
  paymentSubmissionRequiresManualReconciliation,
  planBankStatusObservation,
} from "./bank-status-observation";
import {
  expectedBarcodeDebitAmountCents,
  interBarcodePaymentDate,
  interBarcodePaymentMatchesRequest,
  observeInterBarcodeAmounts,
} from "./barcode-amounts";
import { comparePaymentReceiverToSnapshot, findExactPixReceiverDocument } from "./reconciliation";
import type { BankPaymentRequest, BankPaymentRequestStatus, LegacyBankPaymentSourceType, PaymentActor, PaymentLegalEntitySnapshot, PixBankPaymentRequest } from "./types";
import { canCreateCorrectedPaymentRequest, canRetryDefinitivelyRejectedPayment, hasFreshClearBankPreflight, paymentSubmissionAttemptCount } from "./submission-retry";
import { assertFinancialInboxPaymentTarget, overdueBarcodeSettlementRevisionSchema, planOverdueBarcodeSettlementRevision, type OverdueBarcodeSettlementRevisionInput } from "./overdue-settlement";
import {
  FINANCIAL_SERVICE_APPROVAL_MAX_AMOUNT_CENTS,
  FINANCIAL_SERVICE_APPROVAL_POLICY,
  FINANCIAL_SERVICE_APPROVER_ID,
  financialServiceApprovalRejection,
} from "./service-approval-policy";
import {
  assertDuplicateChecksClear,
  expenseAndObligationDuplicateCheck,
  importedStatementDuplicateCheck,
  localRequestDuplicateCheck,
  sourceAndFingerprintDuplicateCheck,
} from "./inbox-deduplication";
import { barcodeBankPreflight } from "./barcode-bank-preflight";
import { planFinancialInboxPaymentProjection } from "@/features/financial/inbox/payment-projection";
import type { FinancialInboxMessage } from "@/features/financial/inbox/types";

export class FinancialServiceApprovalIneligibleError extends Error {}
export class PaymentRequestRecoveryError extends Error {}
export class PaymentRequestCancellationError extends Error {}

const financialServiceApprover: PaymentActor = {
  uid: FINANCIAL_SERVICE_APPROVER_ID,
  email: null,
  name: "Aprovador financeiro do backend",
};

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
  const existing = await findPaymentRequestBySource(input.sourceType, input.sourceId, WORKSPACE_ID);
  if (existing) {
    if (existing.paymentRail === "barcode") throw new Error("A origem da solicitação bancária existente é incompatível.");
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
  if (input.sourceType === "salary") {
    const expenseId = input.expenseId ?? "";
    const employeeId = input.beneficiaryReference.sourceType === "employee"
      ? input.beneficiaryReference.sourceId
      : "";
    const [expense, employee] = await Promise.all([
      expenseId ? financialDbAdmin.collection("expenses").doc(expenseId).get() : null,
      employeeId ? hrDbAdmin.collection("employees").doc(employeeId).get() : null,
    ]);
    assertSalaryPaymentTarget(
      input,
      expense?.exists ? {
        workspaceId: expense.get("workspaceId"),
        status: expense.get("status"),
        provisionType: expense.get("provisionType"),
        payrollEarningType: expense.get("payrollEarningType"),
        employeeId: expense.get("employeeId"),
        totalValue: expense.get("totalValue"),
        description: expense.get("description"),
      } : null,
      employee?.exists ? {
        id: employee.id,
        authUid: employee.get("auth_uid"),
        sourceUserId: employee.get("source_user_id"),
      } : null,
      WORKSPACE_ID,
    );
  }
  if (input.sourceType === "expense_complement") {
    if (input.beneficiaryReference.sourceType !== "employee") {
      throw new Error("O complemento deve usar o colaborador favorecido da despesa.");
    }
    await assertExpenseComplementPaymentTarget({
      sourceId: input.sourceId,
      expenseId: input.expenseId ?? "",
      beneficiaryReference: input.beneficiaryReference,
      amount: input.amount,
      description: input.description,
      scheduledFor: input.scheduledFor,
    });
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
    workspaceId: WORKSPACE_ID,
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

function recoveryScheduledFor(value: string) {
  const today = todayInBelem();
  return isValidIsoDate(value) && value >= today ? value : today;
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
  beneficiaryDocument: string;
}, actor: PaymentActor) {
  const preparation = inboxBarcodePaymentPreparationSchema.parse({
    scheduledFor: input.scheduledFor,
    barcode: input.barcode,
    beneficiaryDocument: input.beneficiaryDocument,
  });
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
  if (!message.linkedExpenseId) throw new Error("Vincule a cobrança a uma despesa antes de preparar o pagamento.");
  const linkedExpenseSnapshot = await financialDbAdmin.collection("expenses").doc(String(message.linkedExpenseId)).get();
  if (!linkedExpenseSnapshot.exists || linkedExpenseSnapshot.get("workspaceId") !== input.workspaceId) {
    throw new Error("A despesa vinculada não pertence ao mesmo ambiente da cobrança.");
  }
  const code = normalizePaymentBarcode(String(preparation.barcode || message.classification?.barcode || ""));
  if (!code) throw new Error("A cobrança não possui uma linha digitável válida com 44, 46, 47 ou 48 dígitos.");
  const dueDate = String(message.classification?.dueDate || "");
  if (!isValidIsoDate(dueDate)) throw new Error("Confirme o vencimento antes de preparar o pagamento.");
  const scheduledFor = preparation.scheduledFor;
  const today = todayInBelem();
  if (!isValidIsoDate(scheduledFor) || scheduledFor < today) {
    throw new Error("A data do pagamento não pode estar no passado.");
  }
  if (dueDate >= today && scheduledFor > dueDate) {
    throw new Error("Escolha uma data até o vencimento da cobrança.");
  }
  const amountCents = Number(message.classification?.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Confirme o valor antes de preparar o pagamento.");
  const beneficiaryDocument = preparation.beneficiaryDocument;
  const existing = await findPaymentRequestBySource("financial_inbox", input.inboxMessageId, input.workspaceId);
  if (existing) {
    return assertMatchingInboxBarcodeRequest(existing, {
      workspaceId: input.workspaceId,
      inboxMessageId: input.inboxMessageId,
      expenseId: String(message.linkedExpenseId),
      code,
      dueDate,
      scheduledFor,
      beneficiaryDocument,
      amountCents,
    });
  }
  if (message.status !== "linked") {
    throw new Error("Somente a cobrança principal vinculada pode preparar um pagamento.");
  }

  const now = new Date().toISOString();
  const ref = paymentRequestRef(`inbox_${input.inboxMessageId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 170)}`);
  const request: BankPaymentRequest = {
    id: ref.id,
    workspaceId: input.workspaceId,
    sourceType: "financial_inbox",
    sourceId: input.inboxMessageId,
    expenseId: String(message.linkedExpenseId),
    installmentNumber: Number(message.linkedExpenseInstallmentNumber) > 0
      ? Number(message.linkedExpenseInstallmentNumber)
      : null,
    paymentRail: "barcode",
    barcodeSnapshot: {
      type: "barcode" as const,
      code,
      codeHash: paymentBarcodeHash(code),
      maskedCode: maskPaymentBarcode(code)!,
      dueDate,
      scheduledFor,
      beneficiaryDocument,
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
  const existingAtCommit = await financialDbAdmin.runTransaction(async (transaction) => {
    const expenseRef = financialDbAdmin.collection("expenses").doc(String(message.linkedExpenseId));
    const [currentMessageSnapshot, currentExpenseSnapshot, currentRequestSnapshot] = await Promise.all([
      transaction.get(messageRef),
      transaction.get(expenseRef),
      transaction.get(ref),
    ]);
    if (!currentMessageSnapshot.exists || currentMessageSnapshot.get("workspaceId") !== input.workspaceId) {
      throw new Error("Cobrança recebida não encontrada.");
    }
    if (currentMessageSnapshot.get("linkedExpenseId") !== message.linkedExpenseId
      || currentMessageSnapshot.get("existingSettlement.transactionId")
      || currentMessageSnapshot.get("existingBankPayment.transactionId")) {
      throw new Error("A cobrança mudou durante a preparação. Atualize e confira os dados novamente.");
    }
    if (!currentExpenseSnapshot.exists || currentExpenseSnapshot.get("workspaceId") !== input.workspaceId) {
      throw new Error("A despesa vinculada não pertence ao mesmo ambiente da cobrança.");
    }
    if (currentRequestSnapshot.exists) {
      const linkedRequestId = String(currentMessageSnapshot.get("paymentRequestId") || "").trim();
      if (linkedRequestId && linkedRequestId !== ref.id) {
        throw new Error("A cobrança passou a apontar para outra solicitação bancária.");
      }
      return { id: currentRequestSnapshot.id, ...currentRequestSnapshot.data() } as BankPaymentRequest;
    }
    if (currentMessageSnapshot.get("status") !== "linked") {
      throw new Error("A cobrança mudou durante a preparação. Atualize e confira os dados novamente.");
    }
    transaction.create(ref, Object.fromEntries(Object.entries(request).filter(([key]) => key !== "id")));
    transaction.set(messageRef, {
      status: "awaiting_authorization",
      bankState: "awaiting_authorization",
      paymentRequestId: ref.id,
      "resolution.status": "identified",
      "resolution.financialState": "payment_prepared",
      updatedAt: now,
    }, { merge: true });
    transaction.create(messageRef.collection("events").doc(), {
      type: "BANK_PAYMENT_PREPARED", at: now, actorId: actor.uid, actorEmail: actor.email ?? null,
      paymentRequestId: ref.id, scheduledFor, amountCents,
    });
    transaction.create(ref.collection("events").doc(), {
      type: "PAYMENT_REQUEST_CREATED", at: now, actorId: actor.uid, actorEmail: actor.email ?? null,
      status: request.status, sourceType: request.sourceType, sourceId: request.sourceId,
      amount: request.amount, paymentRail: "barcode", scheduledFor,
    });
    return null;
  });
  if (existingAtCommit) {
    return assertMatchingInboxBarcodeRequest(existingAtCommit, {
      workspaceId: input.workspaceId,
      inboxMessageId: input.inboxMessageId,
      expenseId: String(message.linkedExpenseId),
      code,
      dueDate,
      scheduledFor,
      beneficiaryDocument,
      amountCents,
    });
  }
  return request;
}

function assertMatchingInboxBarcodeRequest(existing: BankPaymentRequest, expected: {
  workspaceId: string;
  inboxMessageId: string;
  expenseId: string;
  code: string;
  dueDate: string;
  scheduledFor: string;
  beneficiaryDocument: string;
  amountCents: number;
}) {
  if (existing.workspaceId !== expected.workspaceId
    || existing.sourceType !== "financial_inbox"
    || existing.sourceId !== expected.inboxMessageId
    || existing.expenseId !== expected.expenseId
    || existing.paymentRail !== "barcode"
    || existing.barcodeSnapshot.code !== expected.code
    || existing.barcodeSnapshot.dueDate !== expected.dueDate
    || existing.barcodeSnapshot.scheduledFor !== expected.scheduledFor
    || existing.barcodeSnapshot.beneficiaryDocument !== expected.beneficiaryDocument
    || Math.round(existing.amount * 100) !== expected.amountCents) {
    throw new Error("A solicitação bancária existente diverge dos dados confirmados. Faça a conferência antes de continuar.");
  }
  return existing;
}

export async function createCorrectedInboxBarcodePaymentRequest(id: string, actor: PaymentActor) {
  const initial = await getPaymentRequest(id);
  if (!canCreateCorrectedPaymentRequest(initial) || initial.sourceType !== "financial_inbox" || initial.paymentRail !== "barcode") {
    throw new PaymentRequestRecoveryError("Esta solicitação não aceita uma nova versão. Consulte o motivo e a situação bancária atual.");
  }
  if (!initial.workspaceId) throw new PaymentRequestRecoveryError("A solicitação não possui ambiente financeiro confirmado.");
  if (!initial.expenseId) throw new PaymentRequestRecoveryError("A solicitação não possui despesa vinculada.");
  const messageRef = financialDbAdmin.collection("financialInboxMessages").doc(initial.sourceId);
  const expenseRef = financialDbAdmin.collection("expenses").doc(initial.expenseId);
  const [messageSnapshot, expenseSnapshot] = await Promise.all([messageRef.get(), expenseRef.get()]);
  if (!messageSnapshot.exists || !expenseSnapshot.exists) throw new PaymentRequestRecoveryError("A cobrança ou a despesa vinculada não foi encontrada.");
  if (messageSnapshot.get("workspaceId") !== initial.workspaceId || expenseSnapshot.get("workspaceId") !== initial.workspaceId) {
    throw new PaymentRequestRecoveryError("A cobrança, a despesa e a solicitação não pertencem ao mesmo ambiente financeiro.");
  }
  const revisedAt = new Date(String(messageSnapshot.get("updatedAt") || ""));
  const failedAt = new Date(String(initial.lastError?.occurredAt || initial.updatedAt));
  if (Number.isNaN(revisedAt.getTime()) || Number.isNaN(failedAt.getTime()) || revisedAt <= failedAt) {
    throw new PaymentRequestRecoveryError("Corrija os dados ou reprocesse o documento antes de criar uma nova tentativa.");
  }

  const code = normalizePaymentBarcode(String(messageSnapshot.get("classification.barcode") || initial.barcodeSnapshot.code));
  const dueDate = String(messageSnapshot.get("classification.dueDate") || initial.barcodeSnapshot.dueDate);
  const amountCents = Number(
    messageSnapshot.get("classification.amountCents") ?? Math.round(Number(initial.amount) * 100),
  );
  const beneficiaryDocument = String(
    messageSnapshot.get("classification.billingIdentity.supplierTaxId")
      || initial.barcodeSnapshot.beneficiaryDocument
      || "",
  ).replace(/\D/g, "");
  const scheduledFor = recoveryScheduledFor(initial.barcodeSnapshot.scheduledFor);
  if (!code) throw new PaymentRequestRecoveryError("A cobrança revisada não possui linha digitável válida.");
  if (!isValidIsoDate(dueDate) || !isValidIsoDate(scheduledFor)) {
    throw new PaymentRequestRecoveryError("Revise o vencimento e a data programada antes de criar a nova tentativa.");
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new PaymentRequestRecoveryError("Revise o valor da cobrança antes de criar a nova tentativa.");

  let bankCandidates: Awaited<ReturnType<typeof findInterBarcodePaymentsByCode>> = [];
  if (!hasFreshClearBankPreflight(initial)) {
    try {
      bankCandidates = await findInterBarcodePaymentsByCode(code);
    } catch (cause) {
      const safe = safeInterPaymentError(cause);
      throw new PaymentRequestRecoveryError(
        safe.code === "INTER_REQUEST_FAILED"
          ? "Não foi possível consultar o Banco Inter para validar a nova tentativa. Verifique a configuração da integração e tente novamente."
          : `Não foi possível consultar o Banco Inter para validar a nova tentativa. ${safe.safeMessage}`,
      );
    }
  }
  const activeBankPayment = bankCandidates.find((candidate) =>
    !["rejected", "approval_expired"].includes(mapInterBarcodeStatus(candidate.statusPagamento, scheduledFor)));
  if (activeBankPayment) {
    throw new PaymentRequestRecoveryError("O Banco Inter já possui um pagamento para esta linha digitável. Atualize a situação antes de tentar novamente.");
  }

  const barcodeHash = paymentBarcodeHash(code);
  const duplicates = await financialDbAdmin.collection("bankPaymentRequests")
    .where("workspaceId", "==", initial.workspaceId)
    .where("barcodeSnapshot.codeHash", "==", barcodeHash)
    .limit(26)
    .get();
  const conflicting = duplicates.docs.find((document) => document.id !== initial.id
    && !["failed", "rejected", "approval_expired", "cancelled"].includes(String(document.get("status") || "")));
  if (conflicting) throw new PaymentRequestRecoveryError("Já existe outra solicitação ativa para este boleto.");

  const now = new Date().toISOString();
  const replacementRef = paymentRequestRef(`${initial.id}_v${paymentSubmissionAttemptCount(initial) + 1}`);
  const replacement: BankPaymentRequest = {
    id: replacementRef.id,
    workspaceId: initial.workspaceId,
    sourceType: "financial_inbox",
    sourceId: initial.sourceId,
    expenseId: initial.expenseId,
    installmentNumber: initial.installmentNumber ?? null,
    paymentRail: "barcode",
    barcodeSnapshot: {
      type: "barcode" as const,
      code,
      codeHash: barcodeHash,
      maskedCode: maskPaymentBarcode(code)!,
      dueDate,
      scheduledFor,
      ...(beneficiaryDocument ? { beneficiaryDocument } : {}),
    },
    amount: amountCents / 100,
    description: initial.description,
    status: "awaiting_financial_authorization",
    idempotencyKey: randomUUID(),
    submissionAttemptCount: 0,
    lastError: null,
    statementReconciliationStatus: "not_expected",
    supersedesPaymentRequestId: initial.id,
    supersededByPaymentRequestId: null,
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
  };

  return financialDbAdmin.runTransaction(async (transaction) => {
    const [currentSnapshot, currentMessage, currentExpense, existingReplacement] = await Promise.all([
      transaction.get(paymentRequestRef(initial.id)),
      transaction.get(messageRef),
      transaction.get(expenseRef),
      transaction.get(replacementRef),
    ]);
    if (!currentSnapshot.exists) throw new PaymentRequestRecoveryError("A solicitação original não foi encontrada.");
    const current = { id: currentSnapshot.id, ...currentSnapshot.data() } as BankPaymentRequest;
    if (current.supersededByPaymentRequestId) {
      if (existingReplacement.exists && current.supersededByPaymentRequestId === existingReplacement.id) {
        return { id: existingReplacement.id, ...existingReplacement.data() } as BankPaymentRequest;
      }
      throw new PaymentRequestRecoveryError("A solicitação original já foi substituída por outra versão.");
    }
    if (!canCreateCorrectedPaymentRequest(current)) throw new PaymentRequestRecoveryError("A solicitação mudou durante a revisão.");
    if (!currentMessage.exists || !currentExpense.exists
      || currentMessage.get("paymentRequestId") !== current.id
      || currentExpense.get("paymentRequestId") !== current.id) {
      throw new PaymentRequestRecoveryError("O vínculo entre cobrança, despesa e solicitação mudou durante a revisão.");
    }
    if (existingReplacement.exists) return { id: existingReplacement.id, ...existingReplacement.data() } as BankPaymentRequest;
    transaction.create(replacementRef, Object.fromEntries(Object.entries(replacement).filter(([key, value]) => key !== "id" && value !== undefined)));
    transaction.set(paymentRequestRef(initial.id), { supersededByPaymentRequestId: replacement.id, updatedAt: now }, { merge: true });
    transaction.set(messageRef, {
      paymentRequestId: replacement.id,
      status: "awaiting_authorization",
      bankState: "awaiting_authorization",
      "resolution.status": "identified",
      "resolution.financialState": "payment_prepared",
      updatedAt: now,
    }, { merge: true });
    transaction.set(expenseRef, { paymentRequestId: replacement.id, updatedAt: now }, { merge: true });
    transaction.create(paymentRequestRef(initial.id).collection("events").doc(), {
      type: "PAYMENT_REQUEST_SUPERSEDED", at: now, actorId: actor.uid,
      actorEmail: actor.email ?? null, replacementPaymentRequestId: replacement.id,
    });
    transaction.create(replacementRef.collection("events").doc(), {
      type: "PAYMENT_REQUEST_RECREATED_AFTER_REVIEW", at: now, actorId: actor.uid,
      actorEmail: actor.email ?? null, supersedesPaymentRequestId: initial.id,
    });
    transaction.create(messageRef.collection("events").doc(), {
      type: "BANK_PAYMENT_REQUEST_RECREATED", at: now, actorId: actor.uid,
      actorEmail: actor.email ?? null, paymentRequestId: replacement.id,
      supersedesPaymentRequestId: initial.id,
    });
    return replacement;
  });
}

function cancelledInterBarcodeStatus(status: unknown) {
  return String(status ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase() === "CANCELADO";
}

function assertExpenseBoletoCancellationTarget(request: BankPaymentRequest, replacementScheduledFor: string) {
  if (request.sourceType !== "expense_boleto" || request.paymentRail !== "barcode") {
    throw new PaymentRequestCancellationError("Somente boleto anexado à despesa aceita esta correção de data.");
  }
  if (!["awaiting_bank_approval", "scheduled"].includes(request.status)
    && !(request.bankCancellation?.status === "pending" && cancelledInterBarcodeStatus(request.bankStatus))) {
    throw new PaymentRequestCancellationError("A solicitação não está pendente de aprovação nem agendada no banco.");
  }
  if (!request.interRequestId) {
    throw new PaymentRequestCancellationError("A solicitação não possui código bancário para cancelamento.");
  }
  const today = todayInBelem();
  if (!isValidIsoDate(replacementScheduledFor)
    || replacementScheduledFor < today
    || replacementScheduledFor > request.barcodeSnapshot.dueDate) {
    throw new PaymentRequestCancellationError("A nova data deve estar entre hoje e o vencimento do boleto.");
  }
  if (request.supersededByPaymentRequestId) {
    throw new PaymentRequestCancellationError("A solicitação já foi substituída por outra versão.");
  }
}

export async function cancelAndReplaceExpenseBoletoPaymentRequest(
  id: string,
  replacementScheduledFor: string,
  actor: PaymentActor,
) {
  const initial = await getPaymentRequest(id);
  if (initial.workspaceId !== WORKSPACE_ID) throw new PaymentRequestCancellationError("A solicitação não pertence ao ambiente financeiro ativo.");
  if (initial.status === "cancelled" && initial.supersededByPaymentRequestId) {
    if (initial.bankCancellation?.status !== "confirmed"
      || initial.bankCancellation.replacementScheduledFor !== replacementScheduledFor) {
      throw new PaymentRequestCancellationError("A solicitação já foi cancelada com outra substituição.");
    }
    const existing = await getPaymentRequest(initial.supersededByPaymentRequestId).catch(() => null);
    if (!existing || existing.supersedesPaymentRequestId !== initial.id) {
      throw new PaymentRequestCancellationError("A versão substituta não corresponde à solicitação cancelada.");
    }
    return existing;
  }
  assertExpenseBoletoCancellationTarget(initial, replacementScheduledFor);

  const requestRef = paymentRequestRef(initial.id);
  const expenseRef = financialDbAdmin.collection("expenses").doc(initial.sourceId);
  const expectedDebitRef = financialDbAdmin.collection("expectedBankDebits").doc(`request_${initial.id}`);
  const startedAt = new Date().toISOString();
  const cancellationEventId = randomUUID();
  const bankTransactionCode = initial.interRequestId!;

  const claimedCancellation = await financialDbAdmin.runTransaction(async (transaction) => {
    const [snapshot, expense, expectedDebit] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(expenseRef),
      transaction.get(expectedDebitRef),
    ]);
    if (!snapshot.exists || !expense.exists) {
      throw new PaymentRequestCancellationError("A solicitação ou a despesa vinculada não foi encontrada.");
    }
    const current = { id: snapshot.id, ...snapshot.data() } as BankPaymentRequest;
    const installments = expense.get("installments");
    const attachment = await transaction.get(financialDbAdmin.collection("expenseBoletoAttachments").doc(
      expenseBoletoAttachmentId(current.sourceId,
        Array.isArray(installments) && installments.length > 1 ? current.installmentNumber ?? undefined : undefined),
    ));
    assertExpenseBoletoCancellationTarget(current, replacementScheduledFor);
    if (current.workspaceId !== initial.workspaceId || expense.get("workspaceId") !== initial.workspaceId) {
      throw new PaymentRequestCancellationError("A solicitação e a despesa não pertencem ao mesmo ambiente financeiro.");
    }
    if (current.interRequestId !== bankTransactionCode || current.installmentNumber !== initial.installmentNumber) {
      throw new PaymentRequestCancellationError("O código bancário mudou durante a conferência.");
    }
    const targetInstallment = Array.isArray(installments) && installments.length > 1
      ? installments.find((item: Record<string, unknown>, index: number) => Number(item.number ?? index + 1) === current.installmentNumber)
      : null;
    if ((targetInstallment ? targetInstallment.paymentRequestId : expense.get("paymentRequestId")) !== current.id) {
      throw new PaymentRequestCancellationError("O vínculo entre despesa e solicitação mudou durante a conferência.");
    }
    if (!["pending", "provisioned"].includes(String(expense.get("status")))
      || expense.get("paymentState") === "paid" || expense.get("paidAt") || expense.get("linkedBankTransactionId")
      || (targetInstallment && (!["pending", "provisioned"].includes(String(targetInstallment.status))
        || targetInstallment.paidAt || targetInstallment.linkedBankTransactionId))
      || Math.round(Number(targetInstallment ? targetInstallment.value : expense.get("totalValue")) * 100) !== Math.round(current.amount * 100)
      || current.statementReconciliationStatus === "matched" || current.statementTransactionId
      || (expectedDebit.exists && (expectedDebit.get("workspaceId") !== current.workspaceId
        || expectedDebit.get("paymentRequestId") !== current.id
        || expectedDebit.get("expenseId") !== current.expenseId
        || expectedDebit.get("bankTransactionCode") !== bankTransactionCode
        || ["matched", "divergent"].includes(String(expectedDebit.get("status")))
        || expectedDebit.get("matchedAt") || expectedDebit.get("statementTransactionId")))) {
      throw new PaymentRequestCancellationError("A despesa ou o débito bancário exige reconciliação antes do cancelamento.");
    }
    if (!attachment.exists || attachment.get("workspaceId") !== current.workspaceId
      || attachment.get("barcode") !== current.barcodeSnapshot!.code
      || attachment.get("dueDate") !== current.barcodeSnapshot!.dueDate
      || attachment.get("beneficiaryDocument") !== current.barcodeSnapshot!.beneficiaryDocument
      || Number(attachment.get("amountCents")) !== Math.round(current.amount * 100)) {
      throw new PaymentRequestCancellationError("O anexo do boleto mudou após o envio.");
    }
    const currentCancellation = current.bankCancellation;
    if (currentCancellation) {
      if (currentCancellation.status === "confirmed"
        || currentCancellation.replacementScheduledFor !== replacementScheduledFor
        || currentCancellation.bankTransactionCode !== bankTransactionCode) {
        throw new PaymentRequestCancellationError("Já existe outro cancelamento em conferência para esta solicitação.");
      }
      return false;
    }
    transaction.set(requestRef, {
      bankCancellation: {
        status: "pending",
        requestedAt: startedAt,
        requestedBy: actor.uid,
        requestedByEmail: actor.email ?? null,
        bankTransactionCode,
        replacementScheduledFor,
      },
      updatedAt: startedAt,
    }, { merge: true });
    transaction.create(requestRef.collection("events").doc(cancellationEventId), {
      type: "INTER_BARCODE_CANCELLATION_STARTED",
      at: startedAt,
      actorId: actor.uid,
      actorEmail: actor.email ?? null,
      interRequestId: bankTransactionCode,
      replacementScheduledFor,
    });
    return true;
  });

  let cancellationConfirmed = false;
  if (claimedCancellation) {
    try {
      await cancelInterBarcodePayment(bankTransactionCode);
      cancellationConfirmed = true;
    } catch {
      const observed = await getInterBarcodePayment(bankTransactionCode).catch(() => null);
      cancellationConfirmed = cancelledInterBarcodeStatus(observed?.statusPagamento);
      if (!cancellationConfirmed) {
        throw new PaymentRequestCancellationError("O cancelamento bancário ainda não foi confirmado. Consulte o Inter antes de retomar.");
      }
    }
  } else {
    const observed = await getInterBarcodePayment(bankTransactionCode).catch(() => null);
    cancellationConfirmed = cancelledInterBarcodeStatus(observed?.statusPagamento);
    if (!cancellationConfirmed) {
      throw new PaymentRequestCancellationError("Já existe um cancelamento em conferência. Aguarde a confirmação do Inter.");
    }
  }

  if (!cancellationConfirmed) {
    throw new PaymentRequestCancellationError("O Banco Inter não confirmou o cancelamento.");
  }

  const confirmedAt = new Date().toISOString();
  return financialDbAdmin.runTransaction(async (transaction) => {
    const [snapshot, expense, expectedDebit] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(expenseRef),
      transaction.get(expectedDebitRef),
    ]);
    if (!snapshot.exists || !expense.exists) {
      throw new PaymentRequestCancellationError("O cancelamento foi confirmado pelo banco, mas a solicitação local exige reconciliação.");
    }
    const current = { id: snapshot.id, ...snapshot.data() } as BankPaymentRequest;
    const installments = expense.get("installments");
    const attachment = await transaction.get(financialDbAdmin.collection("expenseBoletoAttachments").doc(
      expenseBoletoAttachmentId(current.sourceId,
        Array.isArray(installments) && installments.length > 1 ? current.installmentNumber ?? undefined : undefined),
    ));
    if (current.supersededByPaymentRequestId) {
      const existingReplacement = await transaction.get(paymentRequestRef(current.supersededByPaymentRequestId));
      if (existingReplacement.exists) {
        return { id: existingReplacement.id, ...existingReplacement.data() } as BankPaymentRequest;
      }
      throw new PaymentRequestCancellationError("O cancelamento foi confirmado, mas a versão substituta não foi encontrada.");
    }
    if (current.interRequestId !== bankTransactionCode || current.paymentRail !== "barcode" || current.sourceType !== "expense_boleto"
      || current.workspaceId !== initial.workspaceId || expense.get("workspaceId") !== current.workspaceId
      || current.amount !== initial.amount
      || current.installmentNumber !== initial.installmentNumber
      || current.barcodeSnapshot.code !== initial.barcodeSnapshot!.code
      || current.barcodeSnapshot.dueDate !== initial.barcodeSnapshot!.dueDate
      || current.barcodeSnapshot.scheduledFor !== initial.barcodeSnapshot!.scheduledFor
      || current.barcodeSnapshot.beneficiaryDocument !== initial.barcodeSnapshot!.beneficiaryDocument
      || current.bankCancellation?.status !== "pending"
      || current.bankCancellation.bankTransactionCode !== bankTransactionCode
      || current.bankCancellation.replacementScheduledFor !== replacementScheduledFor
      || (!["awaiting_bank_approval", "scheduled"].includes(current.status)
        && !(current.status === "rejected" && cancelledInterBarcodeStatus(current.bankStatus)))
      || current.statementReconciliationStatus === "matched" || current.statementTransactionId) {
      throw new PaymentRequestCancellationError("O cancelamento foi confirmado, mas a solicitação mudou e exige reconciliação.");
    }
    const targetInstallment = Array.isArray(installments) && installments.length > 1
      ? installments.find((item: Record<string, unknown>, index: number) => Number(item.number ?? index + 1) === current.installmentNumber)
      : null;
    if ((targetInstallment ? targetInstallment.paymentRequestId : expense.get("paymentRequestId")) !== current.id) {
      throw new PaymentRequestCancellationError("O cancelamento foi confirmado, mas o vínculo da despesa mudou e exige reconciliação.");
    }
    if (!["pending", "provisioned"].includes(String(expense.get("status")))
      || expense.get("paymentState") === "paid" || expense.get("paidAt") || expense.get("linkedBankTransactionId")
      || (targetInstallment && (!["pending", "provisioned"].includes(String(targetInstallment.status))
        || targetInstallment.paidAt || targetInstallment.linkedBankTransactionId))
      || Math.round(Number(targetInstallment ? targetInstallment.value : expense.get("totalValue")) * 100) !== Math.round(current.amount * 100)) {
      throw new PaymentRequestCancellationError("O cancelamento foi confirmado, mas a despesa foi liquidada ou alterada.");
    }
    if (!attachment.exists || attachment.get("workspaceId") !== current.workspaceId
      || attachment.get("barcode") !== current.barcodeSnapshot.code
      || attachment.get("dueDate") !== current.barcodeSnapshot.dueDate
      || attachment.get("beneficiaryDocument") !== current.barcodeSnapshot.beneficiaryDocument
      || Number(attachment.get("amountCents")) !== Math.round(current.amount * 100)) {
      throw new PaymentRequestCancellationError("O cancelamento foi confirmado, mas o anexo do boleto mudou.");
    }
    if (expectedDebit.exists && (expectedDebit.get("workspaceId") !== current.workspaceId
      || expectedDebit.get("paymentRequestId") !== current.id
      || expectedDebit.get("expenseId") !== current.expenseId
      || expectedDebit.get("bankTransactionCode") !== bankTransactionCode
      || ["matched", "divergent"].includes(String(expectedDebit.get("status")))
      || expectedDebit.get("matchedAt") || expectedDebit.get("statementTransactionId"))) {
      throw new PaymentRequestCancellationError("O cancelamento foi confirmado, mas o débito bancário exige reconciliação.");
    }

    const replacementRef = paymentRequestRef(`${current.id}_v${paymentSubmissionAttemptCount(current) + 1}`);
    const existingReplacement = await transaction.get(replacementRef);
    if (existingReplacement.exists) {
      return { id: existingReplacement.id, ...existingReplacement.data() } as BankPaymentRequest;
    }
    const replacement: BankPaymentRequest = {
      id: replacementRef.id,
      workspaceId: current.workspaceId,
      sourceType: "expense_boleto",
      sourceId: current.sourceId,
      expenseId: current.expenseId,
      installmentNumber: current.installmentNumber ?? null,
      paymentRail: "barcode",
      barcodeSnapshot: { ...current.barcodeSnapshot, scheduledFor: replacementScheduledFor },
      amount: current.amount,
      description: current.description,
      status: "awaiting_financial_authorization",
      idempotencyKey: randomUUID(),
      submissionAttemptCount: 0,
      lastError: null,
      statementReconciliationStatus: "not_expected",
      supersedesPaymentRequestId: current.id,
      supersededByPaymentRequestId: null,
      createdAt: confirmedAt,
      createdBy: actor.uid,
      updatedAt: confirmedAt,
    };

    transaction.create(replacementRef, Object.fromEntries(Object.entries(replacement).filter(([key, value]) => key !== "id" && value !== undefined)));
    transaction.set(requestRef, {
      status: "cancelled",
      bankStatus: "CANCELADO",
      bankCancellation: {
        ...current.bankCancellation,
        status: "confirmed",
        confirmedAt,
        bankTransactionCode,
        replacementScheduledFor,
      },
      cancelledAt: confirmedAt,
      cancelledBy: actor.uid,
      statementReconciliationStatus: "not_expected",
      nextBankStatusCheckAt: null,
      supersededByPaymentRequestId: replacement.id,
      lastError: null,
      updatedAt: confirmedAt,
    }, { merge: true });
    if (expectedDebit.exists) transaction.set(expectedDebitRef, {
        status: "cancelled",
        bankStatus: "CANCELADO",
        updatedAt: confirmedAt,
      }, { merge: true });
    if (targetInstallment) {
      transaction.set(expenseRef, {
        installments: installments.map((item: Record<string, unknown>, index: number) => Number(item.number ?? index + 1) === current.installmentNumber
          ? { ...item, paymentRequestId: replacement.id }
          : item),
        updatedAt: confirmedAt,
        updatedBy: actor.uid,
      }, { merge: true });
    } else {
      transaction.set(expenseRef, { paymentRequestId: replacement.id, updatedAt: confirmedAt, updatedBy: actor.uid }, { merge: true });
    }
    transaction.create(requestRef.collection("events").doc(), {
      type: "INTER_BARCODE_PAYMENT_CANCELLED_AND_REPLACED",
      at: confirmedAt,
      actorId: actor.uid,
      actorEmail: actor.email ?? null,
      interRequestId: bankTransactionCode,
      replacementPaymentRequestId: replacement.id,
      replacementScheduledFor,
    });
    transaction.create(replacementRef.collection("events").doc(), {
      type: "PAYMENT_REQUEST_RECREATED_AFTER_BANK_CANCELLATION",
      at: confirmedAt,
      actorId: actor.uid,
      actorEmail: actor.email ?? null,
      supersedesPaymentRequestId: current.id,
      scheduledFor: replacementScheduledFor,
    });
    transaction.create(expenseRef.collection("events").doc(), {
      type: "EXPENSE_BOLETO_PAYMENT_RESCHEDULED",
      at: confirmedAt,
      actorId: actor.uid,
      previousPaymentRequestId: current.id,
      paymentRequestId: replacement.id,
      scheduledFor: replacementScheduledFor,
    });
    return replacement;
  });
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

export async function authorizeAndSubmitServiceApprovedPayment(id: string, allowedSourceIds: ReadonlySet<string>) {
  let request = await getPaymentRequest(id);
  const messageSnapshot = request.sourceType === "financial_inbox"
    ? await financialDbAdmin.collection("financialInboxMessages").doc(request.sourceId).get()
    : null;
  const rejection = financialServiceApprovalRejection({
    request,
    inboxMessageId: messageSnapshot?.id ?? "",
    inboxMessage: messageSnapshot?.exists ? messageSnapshot.data() ?? null : null,
    allowedSourceIds,
    workspaceId: WORKSPACE_ID,
    today: todayInBelem(),
  });
  if (rejection) throw new FinancialServiceApprovalIneligibleError(rejection);
  if (request.status === "awaiting_financial_authorization") {
    request = await authorizePaymentRequest(id, financialServiceApprover);
    await addPaymentEvent(id, "FINANCIAL_SERVICE_APPROVAL_POLICY_APPLIED", financialServiceApprover, {
      policy: FINANCIAL_SERVICE_APPROVAL_POLICY,
      maxAmountCents: FINANCIAL_SERVICE_APPROVAL_MAX_AMOUNT_CENTS,
    });
  }
  return submitPaymentRequest(request.id, financialServiceApprover);
}

export async function reviseAndAuthorizeOverdueBarcodePaymentRequest(
  id: string,
  rawInput: OverdueBarcodeSettlementRevisionInput,
  actor: PaymentActor,
) {
  const input = overdueBarcodeSettlementRevisionSchema.parse(rawInput);
  const initial = await getPaymentRequest(id);
  if (initial.sourceType !== "financial_inbox" || initial.paymentRail !== "barcode") {
    throw new Error("Somente boleto vencido originado na caixa financeira pode ser revisado por este fluxo.");
  }
  const activeBankPayments = (await findInterBarcodePaymentsByCode(initial.barcodeSnapshot.code))
    .filter((candidate) => !["REJEITADO", "RECUSADO", "CANCELADO"].includes(String(candidate.statusPagamento || "").toUpperCase()));
  if (activeBankPayments.length > 0) {
    throw new Error("O Banco Inter já possui pagamento para esta linha digitável. Confira o Internet Banking antes de continuar.");
  }
  const now = new Date().toISOString();
  const ref = paymentRequestRef(id);
  const messageRef = financialDbAdmin.collection("financialInboxMessages").doc(initial.sourceId);
  if (!initial.expenseId) throw new Error("A solicitação não possui despesa vinculada.");
  const expenseRef = financialDbAdmin.collection("expenses").doc(initial.expenseId);
  return financialDbAdmin.runTransaction(async (transaction) => {
    const [requestSnapshot, messageSnapshot, expenseSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(messageRef),
      transaction.get(expenseRef),
    ]);
    if (!requestSnapshot.exists || !messageSnapshot.exists || !expenseSnapshot.exists) throw new Error("Solicitação, cobrança ou despesa vinculada não encontrada.");
    const current = { id: requestSnapshot.id, ...requestSnapshot.data() } as BankPaymentRequest;
    const message = { id: messageSnapshot.id, ...messageSnapshot.data() };
    const expense = { id: expenseSnapshot.id, ...expenseSnapshot.data() };
    const patch = planOverdueBarcodeSettlementRevision({
      request: current,
      message: message as Parameters<typeof planOverdueBarcodeSettlementRevision>[0]["message"],
      expense,
      input,
      actor,
      now,
      today: todayInBelem(),
    });
    transaction.set(ref, patch, { merge: true });
    transaction.set(expenseRef, { paymentRequestId: id, updatedAt: now }, { merge: true });
    transaction.create(ref.collection("events").doc(), {
      type: "OVERDUE_BARCODE_SETTLEMENT_REAUTHORIZED",
      at: now,
      actorId: actor.uid,
      actorEmail: actor.email ?? null,
      sourceAttachmentId: input.sourceAttachmentId,
      principalAmountCents: input.principalAmountCents,
      settlementAmountCents: input.settlementAmountCents,
      lateChargeAmountCents: input.lateChargeAmountCents,
      scheduledFor: input.scheduledFor,
      previousSubmissionAttemptCount: paymentSubmissionAttemptCount(current),
    });
    return { ...current, ...patch } as BankPaymentRequest;
  });
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
    const retryingDefinitiveRejection = canRetryDefinitivelyRejectedPayment(current);
    if (current.status === "failed" && !retryingDefinitiveRejection) {
      throw new Error("Envio anterior exige conferência manual antes de outra tentativa.");
    }
    if (paymentSubmissionRequiresManualReconciliation(current)) {
      throw new Error("A solicitação possui divergência bancária e exige revisão manual; o reenvio foi bloqueado.");
    }
    if (current.sourceType === "financial_inbox") {
      if (!current.expenseId) throw new Error("A solicitação não possui despesa vinculada.");
      const workspaceId = String(current.workspaceId || "").trim();
      if (!workspaceId) throw new Error("A solicitação não possui ambiente financeiro confirmado.");
      const messageRef = financialDbAdmin.collection("financialInboxMessages").doc(current.sourceId);
      const expenseRef = financialDbAdmin.collection("expenses").doc(current.expenseId);
      const [messageSnapshot, expenseSnapshot] = await Promise.all([
        transaction.get(messageRef),
        transaction.get(expenseRef),
      ]);
      if (!messageSnapshot.exists || !expenseSnapshot.exists) throw new Error("A cobrança ou a despesa vinculada não foi encontrada.");
      assertFinancialInboxPaymentTarget({
        request: current,
        message: { id: messageSnapshot.id, ...messageSnapshot.data() },
        expense: { id: expenseSnapshot.id, ...expenseSnapshot.data() },
        today: todayInBelem(),
      });
      if (messageSnapshot.get("workspaceId") !== workspaceId || expenseSnapshot.get("workspaceId") !== workspaceId) {
        throw new Error("A cobrança, a despesa e a solicitação não pertencem ao mesmo ambiente financeiro.");
      }
      if (messageSnapshot.get("paymentRequestId") !== current.id) {
        throw new Error("A cobrança não aponta para esta solicitação bancária.");
      }
      const barcodeHash = current.barcodeSnapshot.codeHash || paymentBarcodeHash(current.barcodeSnapshot.code);
      if (!barcodeHash) throw new Error("A linha digitável não possui impressão digital válida.");
      const rawSha256 = String(messageSnapshot.get("rawSha256") || "").trim() || null;
      const obligationId = String(expenseSnapshot.get("obligationId") || messageSnapshot.get("obligationId") || "").trim();
      const statementAmount = current.requestedSettlementAmount ?? current.amount;
      const dueDate = new Date(`${current.barcodeSnapshot.dueDate}T12:00:00-03:00`);
      const scheduledDate = new Date(`${current.barcodeSnapshot.scheduledFor}T12:00:00-03:00`);
      if (Number.isNaN(dueDate.getTime()) || Number.isNaN(scheduledDate.getTime())) {
        throw new Error("A cobrança não possui datas válidas para a verificação do extrato.");
      }
      const statementStart = new Date(dueDate.getTime() - 21 * 86_400_000);
      const statementEnd = new Date(Math.max(dueDate.getTime(), scheduledDate.getTime()) + 2 * 86_400_000);
      const requestHashQuery = financialDbAdmin.collection("bankPaymentRequests")
        .where("workspaceId", "==", workspaceId)
        .where("barcodeSnapshot.codeHash", "==", barcodeHash)
        .limit(26);
      const requestCodeQuery = financialDbAdmin.collection("bankPaymentRequests")
        .where("workspaceId", "==", workspaceId)
        .where("barcodeSnapshot.code", "==", current.barcodeSnapshot.code)
        .limit(26);
      const requestSourceQuery = financialDbAdmin.collection("bankPaymentRequests")
        .where("workspaceId", "==", workspaceId)
        .where("sourceType", "==", "financial_inbox")
        .where("sourceId", "==", current.sourceId)
        .limit(3);
      const fingerprintQuery = rawSha256
        ? financialDbAdmin.collection("financialInboxMessages")
          .where("workspaceId", "==", workspaceId)
          .where("rawSha256", "==", rawSha256)
          .limit(3)
        : null;
      const paymentsQuery = financialDbAdmin.collection("payments")
        .where("workspaceId", "==", workspaceId)
        .where("expenseId", "==", current.expenseId)
        .limit(26);
      const paymentLinksQuery = obligationId
        ? financialDbAdmin.collection("obligationPaymentLinks").where("obligationId", "==", obligationId).limit(26)
        : null;
      const statementQuery = financialDbAdmin.collection("bankStatementEvents")
        .where("provider", "==", "inter")
        .where("direction", "==", "out")
        .where("amount", "==", statementAmount)
        .where("date", ">=", statementStart)
        .where("date", "<=", statementEnd)
        .limit(26);
      // Keep these reads explicit. Besides making the fail-closed contract easier
      // to audit, it avoids an expensive inferred union across optional Firestore
      // query/document snapshots during TypeScript compilation.
      const hashRequests = await transaction.get(requestHashQuery);
      const codeRequests = await transaction.get(requestCodeQuery);
      const sourceRequests = await transaction.get(requestSourceQuery);
      const fingerprintMessages = fingerprintQuery ? await transaction.get(fingerprintQuery) : null;
      const payments = await transaction.get(paymentsQuery);
      const paymentLinks = paymentLinksQuery ? await transaction.get(paymentLinksQuery) : null;
      const obligation = obligationId
        ? await transaction.get(financialDbAdmin.collection("financialObligations").doc(obligationId))
        : null;
      const statementEvents = await transaction.get(statementQuery);
      const requestDocuments = new Map([
        ...hashRequests.docs,
        ...codeRequests.docs,
        ...sourceRequests.docs,
      ].map((document) => [document.id, document]));
      assertDuplicateChecksClear([
        localRequestDuplicateCheck({
          currentRequestId: current.id,
          requests: [...requestDocuments.values()].map((document) => ({ id: document.id, data: document.data() })),
          truncated: hashRequests.size > 25 || codeRequests.size > 25 || sourceRequests.size > 2,
        }),
        sourceAndFingerprintDuplicateCheck({
          currentMessageId: current.sourceId,
          messages: (fingerprintMessages?.docs ?? []).map((document) => ({ id: document.id, data: document.data() })),
          rawSha256,
          truncated: Boolean(fingerprintMessages && fingerprintMessages.size > 2),
        }),
        expenseAndObligationDuplicateCheck({
          expense: expenseSnapshot.data() ?? null,
          obligation: obligation?.exists ? obligation.data() ?? null : null,
          payments: payments.docs.map((document) => document.data()),
          paymentLinks: paymentLinks?.docs.map((document) => document.data()) ?? [],
          truncated: payments.size > 25 || Boolean(paymentLinks && paymentLinks.size > 25),
        }),
        importedStatementDuplicateCheck({
          events: statementEvents.docs.map((document) => document.data()),
          barcode: current.barcodeSnapshot.code,
          supplierTaxId: messageSnapshot.get("classification.billingIdentity.supplierTaxId"),
          supplierName: messageSnapshot.get("classification.supplierName"),
          truncated: statementEvents.size > 25,
        }),
      ]);
    }
    if (current.sourceType === "expense_boleto") {
      if (current.interRequestId || (current.submissionStartedAt && !retryingDefinitiveRejection)) throw new Error("Envio anterior exige conferência manual antes de outra tentativa.");
      const expense = await transaction.get(financialDbAdmin.collection("expenses").doc(current.sourceId));
      const data = expense.data();
      const targetInstallment = data && Array.isArray(data.installments) && data.installments.length > 1
        ? data.installments.find((item: Record<string, unknown>, index: number) => Number(item.number ?? index + 1) === current.installmentNumber)
        : null;
      if (!data || (targetInstallment ? targetInstallment.paymentRequestId : data.paymentRequestId) !== id) throw new Error("A despesa mudou após a preparação.");
      const stored = await transaction.get(financialDbAdmin.collection("expenseBoletoAttachments").doc(expenseBoletoAttachmentId(current.sourceId, targetInstallment ? current.installmentNumber ?? undefined : undefined)));
      if (!stored.exists || stored.get("workspaceId") !== WORKSPACE_ID) throw new Error("Anexo não encontrado.");
      const input = expenseBoletoSchema.parse(Object.fromEntries(Object.keys(expenseBoletoSchema.shape).map(key => [key, stored.data()?.[key]])));
      assertExpenseBoletoTarget(data, input, WORKSPACE_ID);
      if (current.barcodeSnapshot.scheduledFor < todayInBelem() || current.barcodeSnapshot.scheduledFor > input.dueDate) throw new Error("Confira a data programada antes do envio.");
      if (input.barcode !== current.barcodeSnapshot.code || input.beneficiaryDocument !== current.barcodeSnapshot.beneficiaryDocument || input.amountCents !== Math.round(current.amount * 100)) throw new Error("O boleto mudou após a preparação.");
    }
    const patch = {
      status: "submitting" as const,
      lastError: null,
      submissionStartedAt,
      submissionAttemptCount: paymentSubmissionAttemptCount(current) + 1,
      ...(current.sourceType === "financial_inbox" ? {
        duplicateCheck: {
          checkedAt: submissionStartedAt,
          localRequests: "clear",
          expenseAndObligation: "clear",
          importedStatement: "clear",
          documentFingerprint: "clear",
          sourceIdentity: "clear",
          interSchedulesAndPayments: "pending",
          exclusiveLockId: submissionEventId,
        },
      } : {}),
      updatedAt: submissionStartedAt,
    };
    transaction.set(requestRef, patch, { merge: true });
    transaction.set(requestRef.collection("events").doc(submissionEventId), {
      type: retryingDefinitiveRejection ? "INTER_SUBMISSION_RETRY_STARTED" : "INTER_SUBMISSION_STARTED",
      at: submissionStartedAt,
      actorId: actor === "system" ? "system" : actor.uid,
      actorEmail: actor === "system" ? null : actor.email ?? null,
    });
    return { ...current, ...patch } as BankPaymentRequest;
  });
  try {
    if (pending.paymentRail === "barcode") {
      if (!pending.barcodeSnapshot) throw new Error("Os dados da linha digitável não estão disponíveis.");
      const bankCandidates = (await findInterBarcodePaymentsByCode(pending.barcodeSnapshot.code))
        .filter((candidate) => !["REJEITADO", "RECUSADO", "CANCELADO"].includes(String(candidate.statusPagamento || "").toUpperCase()));
      if (pending.sourceType === "financial_inbox" && bankCandidates.some((candidate) =>
        mapInterBarcodeStatus(candidate.statusPagamento, pending.barcodeSnapshot.scheduledFor) === "paid")) {
        throw new Error("O Inter já registra pagamento realizado para esta linha digitável. Envio bloqueado para revisão.");
      }
      if (bankCandidates.length > 1) {
        throw new Error("O Banco Inter retornou mais de um pagamento para esta linha digitável. Confira no Internet Banking antes de continuar.");
      }
      const previous = bankCandidates.filter((candidate) => interBarcodePaymentMatchesRequest({
        payment: candidate,
        requestedAmount: pending.amount,
        dueDate: pending.barcodeSnapshot.dueDate,
        scheduledFor: pending.barcodeSnapshot.scheduledFor,
      }));
      if (bankCandidates.length > 0 && previous.length === 0) {
        throw new Error("O Banco Inter já possui pagamento para esta linha digitável com valores incompatíveis. Confira no Internet Banking antes de continuar.");
      }
      const recovered = previous[0] ?? null;
      const result = recovered ? {
        quantidadeAprovadores: recovered.aprovacoesNecessarias,
        dataAgendamento: recovered.dataPagamento,
        statusPagamento: recovered.statusPagamento,
        codigoTransacao: recovered.codigoTransacao,
      } : await submitInterBarcodePayment({
          code: pending.barcodeSnapshot.code,
          amount: pending.requestedSettlementAmount ?? pending.amount,
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
      const recoveredAmounts = recovered ? observeInterBarcodeAmounts({
        requestedAmount: pending.amount,
        dueDate: pending.barcodeSnapshot.dueDate,
        paymentDate: interBarcodePaymentDate(recovered, pending.barcodeSnapshot.scheduledFor),
        nominalAmount: recovered.valorNominal,
        paidAmount: recovered.valorPago,
      }) : null;
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
        bankScheduledFor: result.dataAgendamento?.slice(0, 10) ?? null,
        ...(recoveredAmounts?.nominalAmountCents != null
          ? { bankNominalAmount: recoveredAmounts.nominalAmountCents / 100 }
          : {}),
        ...(recoveredAmounts?.settlementAmountCents != null
          ? { bankSettlementAmount: recoveredAmounts.settlementAmountCents / 100 }
          : {}),
        ...(recoveredAmounts && recoveredAmounts.lateChargeAmountCents > 0
          ? { bankLateChargeAmount: recoveredAmounts.lateChargeAmountCents / 100 }
          : {}),
        ...observation.patch,
        statementReconciliationStatus: "expected" as const,
        ...(pending.sourceType === "financial_inbox" ? {
          duplicateCheck: {
            ...pending.duplicateCheck,
            interSchedulesAndPayments: recovered ? "existing_recovered" : "clear",
            completedAt: submittedAt,
          },
        } : {}),
        ...(next === "awaiting_statement" && recoveredAmounts?.settlementAmountCents == null
          ? { nextBankStatusCheckAt: new Date(new Date(submittedAt).getTime() + 5 * 60_000).toISOString() }
          : {}),
      };
      const requestRef = paymentRequestRef(id);
      const expectedDebitRef = financialDbAdmin.collection("expectedBankDebits").doc(`request_${id}`);
      const messageRef = financialDbAdmin.collection("financialInboxMessages").doc(pending.sourceId);
      const expectedStatus = next === "awaiting_statement" ? "awaiting_statement" : "active";
      const requestEventId = randomUUID();
      const messageEventId = randomUUID();
      const request = await financialDbAdmin.runTransaction(async (transaction) => {
        const [currentSnapshot, currentMessageSnapshot] = await Promise.all([
          transaction.get(requestRef),
          pending.sourceType === "financial_inbox" ? transaction.get(messageRef) : Promise.resolve(null),
        ]);
        if (!currentSnapshot.exists || currentSnapshot.get("status") !== "submitting") {
          throw new Error("A solicitação mudou enquanto o Banco Inter processava o envio.");
        }
        if (pending.sourceType === "financial_inbox" && !currentMessageSnapshot?.exists) {
          throw new Error("A cobrança vinculada não foi encontrada após o envio ao banco.");
        }
        transaction.set(requestRef, requestPatch, { merge: true });
        transaction.set(expectedDebitRef, {
          workspaceId: WORKSPACE_ID,
          status: expectedStatus,
          paymentRequestId: id,
          financialInboxMessageId: pending.sourceType === "financial_inbox" ? pending.sourceId : null,
          sourceType: pending.sourceType,
          expenseId: pending.expenseId,
          amountCents: expectedBarcodeDebitAmountCents({
            requestedAmount: pending.amount,
            requestedSettlementAmount: pending.requestedSettlementAmount,
            observedSettlementAmountCents: recoveredAmounts?.settlementAmountCents,
          }),
          principalAmountCents: Math.round(pending.amount * 100),
          expectedDate: pending.barcodeSnapshot.scheduledFor,
          dueDate: pending.barcodeSnapshot.dueDate,
          bankTransactionCode: interRequestId,
          barcodeLastDigits: pending.barcodeSnapshot.code.slice(-8),
          counterpartyName: pending.sourceType === "financial_inbox"
            ? String(currentMessageSnapshot?.get("classification.supplierName") || "").trim() || null
            : null,
          createdAt: submittedAt,
          updatedAt: submittedAt,
        }, { merge: true });
        const projectionPlan = pending.sourceType === "financial_inbox" && currentMessageSnapshot?.exists
          ? planFinancialInboxPaymentProjection({
              message: { id: currentMessageSnapshot.id, ...currentMessageSnapshot.data() } as FinancialInboxMessage,
              request: { ...pending, ...requestPatch },
              observedAt: submittedAt,
            })
          : null;
        if (projectionPlan) transaction.set(messageRef, projectionPlan.patch, { merge: true });
        if (pending.sourceType === "financial_inbox") transaction.set(messageRef.collection("events").doc(messageEventId), {
          type: "INTER_BARCODE_PAYMENT_ACCEPTED",
          at: submittedAt,
          actorId: actor === "system" ? "system" : actor.uid,
          interRequestId,
          bankStatus: result.statusPagamento ?? null,
          scheduledFor: pending.barcodeSnapshot.scheduledFor,
        });
        if (projectionPlan?.transition === "archive") transaction.set(messageRef.collection("events").doc(), {
          type: "MESSAGE_ARCHIVED_AFTER_FINANCIAL_HANDOFF",
          at: submittedAt,
          actorId: "system:financial-inbox-handoff",
          paymentRequestId: id,
          interRequestId,
          previousStatus: currentMessageSnapshot?.get("status") ?? null,
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
    const failedAt = new Date().toISOString();
    await financialDbAdmin.runTransaction(async (transaction) => {
      const requestRef = paymentRequestRef(id);
      const snapshot = await transaction.get(requestRef);
      if (!snapshot.exists || snapshot.get("status") !== "submitting") {
        throw new Error("A solicitação mudou enquanto a falha bancária era registrada.");
      }
      const current = { id: snapshot.id, ...snapshot.data() } as BankPaymentRequest;
      const messageRef = current.sourceType === "financial_inbox"
        ? financialDbAdmin.collection("financialInboxMessages").doc(current.sourceId)
        : null;
      const messageSnapshot = messageRef ? await transaction.get(messageRef) : null;
      const failedRequest = { ...current, status: "failed" as const, lastError, updatedAt: failedAt };
      transaction.set(requestRef, { status: "failed", lastError, updatedAt: failedAt }, { merge: true });
      transaction.set(requestRef.collection("events").doc(), {
        type: "INTER_SUBMISSION_FAILED",
        at: failedAt,
        actorId: actor === "system" ? "system" : actor.uid,
        actorEmail: actor === "system" ? null : actor.email ?? null,
        code: lastError.code,
        responseDetails: lastError.details ?? null,
      });
      if (messageRef && messageSnapshot?.exists) {
        const plan = planFinancialInboxPaymentProjection({
          message: { id: messageSnapshot.id, ...messageSnapshot.data() } as FinancialInboxMessage,
          request: failedRequest,
          observedAt: failedAt,
        });
        transaction.set(messageRef, plan.patch, { merge: true });
        transaction.set(messageRef.collection("events").doc(), {
          type: "BANK_PAYMENT_ACTION_REQUIRED",
          at: failedAt,
          actorId: "system:financial-inbox",
          paymentRequestId: id,
          reasonCode: lastError.code,
        });
      }
    });
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
    const paymentMethodLabel = request.paymentRail === "barcode" ? "Boleto Banco Inter" : "Pix Banco Inter";
    const expenseRef = financialDbAdmin.collection("expenses").doc(request.expenseId);
    const paymentRef = financialDbAdmin.collection("payments").doc(`inter_${request.id}`);
    await financialDbAdmin.runTransaction(async (transaction) => {
      const expense = await transaction.get(expenseRef);
      if (!expense.exists) throw new Error("A despesa vinculada à solicitação não foi encontrada.");
      transaction.set(paymentRef, {
        workspaceId: request.workspaceId ?? WORKSPACE_ID,
        expenseId: request.expenseId, installmentNumber: request.installmentNumber ?? null, paymentRequestId: request.id, paidAt: request.paidAt,
        totalPaid: request.amount, paymentMethodLabel, proofStoragePath: request.proofStoragePath,
        createdAt: now, createdBy: "bank-reconciliation",
      }, { merge: false });
      const expenseData = expense.data()!;
      const installments = Array.isArray(expenseData.installments) ? expenseData.installments : [];
      const isInstallmentBoleto = request.sourceType === "expense_boleto" && installments.length > 1 && request.installmentNumber != null;
      if (isInstallmentBoleto) {
        const nextInstallments = installments.map((item: Record<string, unknown>, index: number) => Number(item.number ?? index + 1) === request.installmentNumber
          ? { ...item, status: "paid", paidAt: request.paidAt, paymentRequestId: request.id, paymentProofStoragePath: request.proofStoragePath ?? null }
          : item);
        const allPaid = nextInstallments.every((item: Record<string, unknown>) => item.status === "paid" || Boolean(item.paidAt));
        transaction.set(expenseRef, {
          installments: nextInstallments,
          status: allPaid ? "paid" : expenseData.status,
          ...(allPaid ? { paidAt: request.paidAt } : {}),
          updatedAt: now,
        }, { merge: true });
      } else {
        transaction.set(expenseRef, { status: "paid", paidAt: request.paidAt, paymentRequestId: request.id, paymentProofStoragePath: request.proofStoragePath, updatedAt: now }, { merge: true });
      }
      transaction.set(financialDbAdmin.collection("transactions").doc(`inter_${request.id}`), {
        type: "expense", expenseId: request.expenseId, installmentNumber: request.installmentNumber ?? null, paymentRequestId: request.id,
        description: request.description, amount: request.amount, date: request.paidAt,
        paymentMethodLabel, createdAt: now, createdBy: "bank-reconciliation",
      }, { merge: false });
    });
  }
  if (request.sourceType === "generated_receipt") {
    await financialDbAdmin.collection("generatedReceipts").doc(request.sourceId).set({ status: "paid", paidAt: request.paidAt, paymentRequestId: request.id, paymentProofStoragePath: request.proofStoragePath, updatedAt: new Date().toISOString() }, { merge: true });
  }
}

async function attachFinancialInboxProof(request: BankPaymentRequest) {
  if (request.paymentRail !== "barcode" || !request.proofStoragePath) return;
  const now = new Date().toISOString();
  const batch = financialDbAdmin.batch();
  if (request.sourceType === "financial_inbox") batch.set(financialDbAdmin.collection("financialInboxMessages").doc(request.sourceId), {
    paymentProofStoragePath: request.proofStoragePath,
    updatedAt: now,
  }, { merge: true });
  if (request.expenseId && !(request.sourceType === "expense_boleto" && request.installmentNumber != null)) {
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
  request = await revalidatePaidPaymentBeneficiary(request);
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
    if (current.paymentRail === "barcode") {
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
    if (!["awaiting_bank_approval", "scheduled", "processing", "awaiting_statement"].includes(status)) return;
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
    const current = { id: snapshot.id, ...snapshot.data() } as BankPaymentRequest;
    const messageRef = current.sourceType === "financial_inbox"
      ? financialDbAdmin.collection("financialInboxMessages").doc(current.sourceId)
      : null;
    const messageSnapshot = messageRef ? await transaction.get(messageRef) : null;
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
    if (messageRef && messageSnapshot?.exists) {
      const plan = planFinancialInboxPaymentProjection({
        message: { id: messageSnapshot.id, ...messageSnapshot.data() } as FinancialInboxMessage,
        request: { ...current, status: "failed", lastError, updatedAt: occurredAt } as BankPaymentRequest,
        observedAt: occurredAt,
      });
      transaction.set(messageRef, plan.patch, { merge: true });
      transaction.set(messageRef.collection("events").doc(), {
        type: "BANK_PAYMENT_ACTION_REQUIRED",
        at: occurredAt,
        actorId: "system:financial-inbox",
        paymentRequestId: id,
        reasonCode: lastError.code,
      });
    }
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
  bankNominalAmountCents?: number | null;
  bankSettlementAmountCents?: number | null;
  bankLateChargeAmountCents?: number;
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
      || !["awaiting_bank_approval", "scheduled", "processing", "awaiting_statement", "failed"].includes(current.status)
    ) return current;
    if (current.bankCancellation?.status === "pending" && cancelledInterBarcodeStatus(params.rawBankStatus)) return current;
    const messageRef = current.sourceType === "financial_inbox"
      ? financialDbAdmin.collection("financialInboxMessages").doc(current.sourceId)
      : null;
    const messageSnapshot = messageRef ? await transaction.get(messageRef) : null;
    const observation = planBankStatusObservation({
      current,
      nextStatus: params.nextStatus,
      rawBankStatus: params.rawBankStatus,
      observedAt: params.observedAt,
      scheduledFor: params.scheduledFor,
    });
    const amountChanged = (
      params.bankNominalAmountCents != null
      && Math.round(Number(current.bankNominalAmount ?? -1) * 100) !== params.bankNominalAmountCents
    ) || (
      params.bankSettlementAmountCents != null
      && Math.round(Number(current.bankSettlementAmount ?? -1) * 100) !== params.bankSettlementAmountCents
    ) || (
      params.bankSettlementAmountCents != null
      && Math.round(Number(current.bankLateChargeAmount ?? 0) * 100) !== (params.bankLateChargeAmountCents ?? 0)
    );
    if (!observation.changed && !amountChanged) return current;
    const settlementKnown = params.bankSettlementAmountCents != null || current.bankSettlementAmount != null;
    const patch = {
      status: params.nextStatus,
      updatedAt: params.observedAt,
      bankStatusPollFailureCount: 0,
      ...observation.patch,
      ...(params.bankNominalAmountCents != null
        ? { bankNominalAmount: params.bankNominalAmountCents / 100 }
        : {}),
      ...(params.bankSettlementAmountCents != null
        ? { bankSettlementAmount: params.bankSettlementAmountCents / 100 }
        : {}),
      ...(params.bankSettlementAmountCents != null
        ? { bankLateChargeAmount: (params.bankLateChargeAmountCents ?? 0) / 100 }
        : {}),
      ...(params.nextStatus === "awaiting_statement" ? { statementReconciliationStatus: "expected" as const } : {}),
      ...(params.nextStatus === "awaiting_statement" && !settlementKnown
        ? { nextBankStatusCheckAt: new Date(new Date(params.observedAt).getTime() + 5 * 60_000).toISOString() }
        : {}),
    };
    transaction.set(requestRef, patch, { merge: true });
    if (observation.statusChanged || observation.bankStatusChanged || amountChanged) {
      transaction.set(financialDbAdmin.collection("expectedBankDebits").doc(`request_${params.id}`), {
        workspaceId: current.workspaceId ?? WORKSPACE_ID,
        status: params.nextStatus === "awaiting_statement"
          ? "awaiting_statement"
          : ["rejected", "approval_expired"].includes(params.nextStatus)
            ? "cancelled"
            : "active",
        paymentRequestId: current.id,
        financialInboxMessageId: current.sourceType === "financial_inbox" ? current.sourceId : null,
        sourceType: current.sourceType,
        expenseId: current.expenseId ?? null,
        bankStatus: params.rawBankStatus ?? null,
        bankAuthentication: params.bankAuthentication ?? null,
        bankNsu: params.bankNsu ?? null,
        amountCents: expectedBarcodeDebitAmountCents({
          requestedAmount: current.amount,
          requestedSettlementAmount: current.requestedSettlementAmount,
          currentSettlementAmount: current.bankSettlementAmount,
          observedSettlementAmountCents: params.bankSettlementAmountCents,
        }),
        principalAmountCents: Math.round(current.amount * 100),
        expectedDate: current.barcodeSnapshot.scheduledFor,
        dueDate: current.barcodeSnapshot.dueDate,
        bankTransactionCode: current.interRequestId ?? null,
        barcodeLastDigits: current.barcodeSnapshot.code.slice(-8),
        counterpartyName: current.sourceType === "financial_inbox"
          ? String(messageSnapshot?.get("classification.supplierName") || "").trim() || null
          : null,
        createdAt: current.submittedAt ?? current.createdAt,
        updatedAt: params.observedAt,
      }, { merge: true });
      if (messageRef && messageSnapshot?.exists) {
        const plan = planFinancialInboxPaymentProjection({
          message: { id: messageSnapshot.id, ...messageSnapshot.data() } as FinancialInboxMessage,
          request: { ...current, ...patch, status: params.nextStatus },
          observedAt: params.observedAt,
        });
        transaction.set(messageRef, plan.patch, { merge: true });
        if (plan.transition === "archive") transaction.set(messageRef.collection("events").doc(), {
          type: "MESSAGE_ARCHIVED_AFTER_FINANCIAL_HANDOFF",
          at: params.observedAt,
          actorId: "system:financial-inbox-handoff",
          paymentRequestId: current.id,
          interRequestId: current.interRequestId ?? null,
          previousStatus: messageSnapshot.get("status") ?? null,
        });
        if (plan.transition === "action_required") transaction.set(messageRef.collection("events").doc(), {
          type: "BANK_PAYMENT_ACTION_REQUIRED",
          at: params.observedAt,
          actorId: "system:financial-inbox",
          paymentRequestId: current.id,
          reasonCode: params.nextStatus,
        });
      }
    }
    if (observation.shouldWriteAuditEvent || amountChanged) {
      transaction.set(requestRef.collection("events").doc(eventId), {
        type: observation.approvalObserved
          ? "BANK_APPROVAL_OBSERVED"
          : amountChanged
            ? "BANK_SETTLEMENT_AMOUNT_OBSERVED"
            : "BANK_STATUS_RECONCILED",
        at: params.observedAt,
        actorId: params.actor === "system" ? "system" : params.actor.uid,
        actorEmail: params.actor === "system" ? null : params.actor.email ?? null,
        bankStatus: params.rawBankStatus ?? null,
        status: params.nextStatus,
        observedAt: params.observedAt,
        ...(params.bankSettlementAmountCents != null
          ? { settlementAmountCents: params.bankSettlementAmountCents }
          : {}),
        ...(params.bankSettlementAmountCents != null
          ? { lateChargeAmountCents: params.bankLateChargeAmountCents ?? 0 }
          : {}),
        ...(observation.schedulingObserved ? { scheduledFor: params.scheduledFor } : {}),
      });
    }
    return { ...current, ...patch } as BankPaymentRequest;
  });
}

async function preflightUnidentifiedInboxBarcodeRequest(
  current: BankPaymentRequest,
  actor: PaymentActor | "system",
) {
  if (
    current.sourceType !== "financial_inbox"
    || current.paymentRail !== "barcode"
    || current.status !== "failed"
    || current.interRequestId
  ) return current;

  const preflight = barcodeBankPreflight({
    candidates: await findInterBarcodePaymentsByCode(current.barcodeSnapshot.code),
    requestedAmount: current.amount,
    dueDate: current.barcodeSnapshot.dueDate,
    scheduledFor: current.barcodeSnapshot.scheduledFor,
    beneficiaryDocument: current.barcodeSnapshot.beneficiaryDocument,
  });
  if (preflight.kind === "blocked") throw new Error(preflight.reason);
  const observedAt = new Date().toISOString();
  if (preflight.kind === "clear") {
    const eventId = randomUUID();
    return financialDbAdmin.runTransaction(async (transaction) => {
      const ref = paymentRequestRef(current.id);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("Solicitação de pagamento não encontrada.");
      const latest = { id: snapshot.id, ...snapshot.data() } as BankPaymentRequest;
      if (latest.interRequestId || latest.status !== "failed") return latest;
      const messageRef = financialDbAdmin.collection("financialInboxMessages").doc(latest.sourceId);
      const messageSnapshot = await transaction.get(messageRef);
      const bankPreflight = { checkedAt: observedAt, outcome: "clear" as const, bankTransactionCode: null };
      transaction.set(ref, { bankPreflight, updatedAt: observedAt }, { merge: true });
      transaction.set(ref.collection("events").doc(eventId), {
        type: "INTER_BANK_PREFLIGHT_CLEAR",
        at: observedAt,
        actorId: actor === "system" ? "system" : actor.uid,
        actorEmail: actor === "system" ? null : actor.email ?? null,
      });
      if (messageSnapshot.exists) {
        const plan = planFinancialInboxPaymentProjection({
          message: { id: messageSnapshot.id, ...messageSnapshot.data() } as FinancialInboxMessage,
          request: latest,
          observedAt,
        });
        transaction.set(messageRef, plan.patch, { merge: true });
        transaction.set(messageRef.collection("events").doc("payment-failure-projection-v1"), {
          type: "BANK_PAYMENT_ACTION_REQUIRED",
          at: observedAt,
          actorId: "system:financial-inbox",
          paymentRequestId: latest.id,
          reasonCode: latest.lastError?.code ?? "PAYMENT_REQUEST_FAILED",
        }, { merge: true });
      }
      return { ...latest, bankPreflight, updatedAt: observedAt } as BankPaymentRequest;
    });
  }
  const { payment: candidate, bankTransactionCode } = preflight;
  const eventId = randomUUID();
  await financialDbAdmin.runTransaction(async (transaction) => {
    const ref = paymentRequestRef(current.id);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error("Solicitação de pagamento não encontrada.");
    const latest = { id: snapshot.id, ...snapshot.data() } as BankPaymentRequest;
    if (latest.interRequestId && latest.interRequestId !== bankTransactionCode) {
      throw new Error("A solicitação passou a apontar para outra transação bancária. Atualize antes de continuar.");
    }
    if (latest.status !== "failed" && !latest.interRequestId) {
      throw new Error("A solicitação mudou durante a consulta ao banco. Atualize antes de continuar.");
    }
    const bankPreflight = {
      checkedAt: observedAt,
      outcome: "existing_recovered" as const,
      bankTransactionCode,
    };
    transaction.set(ref, {
      interRequestId: bankTransactionCode,
      submittedAt: latest.submittedAt ?? candidate.dataInclusao ?? observedAt,
      bankScheduledFor: candidate.dataPagamento?.slice(0, 10) ?? null,
      bankPreflight,
      updatedAt: observedAt,
    }, { merge: true });
    transaction.set(ref.collection("events").doc(eventId), {
      type: "INTER_BANK_PAYMENT_RECOVERED",
      at: observedAt,
      actorId: actor === "system" ? "system" : actor.uid,
      actorEmail: actor === "system" ? null : actor.email ?? null,
      interRequestId: bankTransactionCode,
      bankStatus: candidate.statusPagamento ?? null,
    });
  });
  return getPaymentRequest(current.id);
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
  beneficiaryVerificationStatus?: "verified" | "unavailable";
  beneficiaryVerificationWarning?: string | null;
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
      patch.beneficiaryVerificationStatus = params.beneficiaryVerificationStatus ?? "unavailable";
      patch.beneficiaryVerificationWarning = params.beneficiaryVerificationWarning ?? null;
      patch.beneficiaryVerificationObservedAt = params.observedAt;
      // A prior false divergence caused by a masked document must not survive a
      // later successful bank observation. A complete mismatch is blocked
      // before this function is called.
      patch.bankReconciliationDivergenceField = null;
      patch.statementReconciliationStatus = "not_expected";
      patch.lastError = null;
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
    if (current.paymentRail === "barcode") {
      transaction.set(financialDbAdmin.collection("expectedBankDebits").doc(`request_${params.id}`), {
        status: "divergent",
        bankStatus: params.rawBankStatus ?? null,
        updatedAt: observedAt,
      }, { merge: true });
      if (current.sourceType === "financial_inbox") transaction.set(financialDbAdmin.collection("financialInboxMessages").doc(current.sourceId), {
        status: "divergent",
        bankState: "divergent",
        "resolution.status": "identified",
        "resolution.financialState": "scheduled",
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
    if (!current.interRequestId && current.sourceType === "financial_inbox" && current.status === "failed") {
      current = await preflightUnidentifiedInboxBarcodeRequest(current, actor);
      if (!current.interRequestId) return current;
    }
    if (!current.interRequestId || !current.barcodeSnapshot) throw new Error("A solicitação ainda não foi enviada ao Banco Inter.");
    const bank = await getInterBarcodePayment(current.interRequestId);
    if (!bank) throw new Error("O Banco Inter ainda não retornou este pagamento.");
    if (current.bankCancellation?.status === "pending" && cancelledInterBarcodeStatus(bank.statusPagamento)) return current;
    const approvalRequired = Number(bank.aprovacoesRealizadas || 0) < Number(bank.aprovacoesNecessarias || 0);
    const nextBank = approvalRequired
      ? "awaiting_bank_approval" as const
      : mapInterBarcodeStatus(bank.statusPagamento, current.barcodeSnapshot.scheduledFor);
    const amounts = observeInterBarcodeAmounts({
      requestedAmount: current.amount,
      dueDate: current.barcodeSnapshot.dueDate,
      paymentDate: interBarcodePaymentDate(bank, current.barcodeSnapshot.scheduledFor),
      nominalAmount: bank.valorNominal,
      paidAmount: bank.valorPago,
    });
    if (amounts.divergence) {
      const safeMessage = amounts.divergence === "nominal"
        ? "O principal retornado pelo banco diverge da cobrança. A baixa foi bloqueada."
        : "O valor liquidado retornado pelo banco não é compatível com o principal e o vencimento. A baixa foi bloqueada.";
      await blockBankReconciliationDivergence({
        id,
        actor,
        field: "amount",
        rawBankStatus: bank.statusPagamento,
        safeMessage,
      });
      throw new Error(safeMessage);
    }
    const next = current.status === "awaiting_statement"
      ? "awaiting_statement" as const
      : nextBank === "paid" ? "awaiting_statement" as const : nextBank;
    const observedAt = new Date().toISOString();
    return persistBarcodeBankObservation({
      id,
      nextStatus: next,
      rawBankStatus: bank.statusPagamento,
      scheduledFor: current.barcodeSnapshot.scheduledFor,
      bankAuthentication: bank.autenticacao ? String(bank.autenticacao) : null,
      bankNsu: bank.nsu ?? null,
      bankNominalAmountCents: amounts.nominalAmountCents,
      bankSettlementAmountCents: amounts.settlementAmountCents,
      bankLateChargeAmountCents: amounts.lateChargeAmountCents,
      actor,
      observedAt,
    });
  }
  if (current.status === "paid") {
    return finishPaidPaymentRequest(current);
  }
  if (!current.interRequestId) throw new Error("A solicitação ainda não foi enviada ao Banco Inter.");
  const interRequestId = current.interRequestId;
  if (!current.beneficiaryReference || !current.beneficiarySnapshot) throw new Error("Os dados do favorecido não estão disponíveis.");
  const bank = await getInterPixStatus(interRequestId);
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
  let receiverComparison = comparePaymentReceiverToSnapshot({
    receiverDocument: transaction.recebedor?.cpfCnpj,
    snapshotDocument: current.beneficiarySnapshot.document,
    snapshotDocumentHash: current.beneficiarySnapshot.documentHash,
  });
  if (receiverComparison === "unavailable" && next === "paid") {
    try {
      const movementDate = String(transaction.dataHoraMovimento ?? "").slice(0, 10);
      const baseDate = /^\d{4}-\d{2}-\d{2}$/.test(movementDate)
        ? new Date(`${movementDate}T12:00:00.000Z`)
        : new Date();
      const startDate = new Date(baseDate);
      const endDate = new Date(baseDate);
      startDate.setUTCDate(startDate.getUTCDate() - 1);
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      const receiverDocument = findExactPixReceiverDocument(
        await listInterStatementEntries(startDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10)),
        {
          interRequestId,
          endToEndId: transaction.endToEnd,
          amount: current.amount,
        },
      );
      if (receiverDocument) receiverComparison = comparePaymentReceiverToSnapshot({
        receiverDocument,
        snapshotDocument: current.beneficiarySnapshot.document,
        snapshotDocumentHash: current.beneficiarySnapshot.documentHash,
      });
    } catch {
      // The status remains authoritative for payment state. Missing statement
      // evidence keeps identity pending and never creates a divergence.
    }
  }
  if (receiverComparison === "divergent") {
    const safeMessage = "O favorecido confirmado pelo banco diverge da solicitação. O pagamento não foi baixado.";
    await blockBankReconciliationDivergence({ id, actor, field: "receiver", rawBankStatus: rawStatus, safeMessage });
    throw new Error(safeMessage);
  }
  if (
    receiverComparison === "unavailable"
    && current.lastError?.code === "BANK_RECONCILIATION_DIVERGENCE"
  ) {
    // Never erase a previously recorded full-document divergence using a
    // later masked response. Exact statement evidence is required to recover.
    return current;
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
    beneficiaryVerificationStatus: receiverComparison === "matched" ? "verified" : "unavailable",
    beneficiaryVerificationWarning: receiverComparison === "matched"
      ? null
      : "O Inter confirmou o pagamento, mas mascarou o CPF/CNPJ neste retorno. A identidade será confirmada pelo extrato completo; isso não indica divergência.",
  });
  if (next === "paid") updated = await finishPaidPaymentRequest(updated);
  return updated;
}
