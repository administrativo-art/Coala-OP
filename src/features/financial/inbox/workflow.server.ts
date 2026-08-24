import { Timestamp } from "firebase-admin/firestore";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { calculateFinancialObligationSummary } from "@/features/financial/obligations/calculations";
import type { PaymentActor } from "@/features/financial/payment-requests/types";
import { chooseProvisionSuggestion, type ProvisionCandidate } from "./provision-suggestions";
import { getFinancialInboxMessage } from "./repository.server";
import type { FinancialInboxMessage } from "./types";

const MAX_PROVISION_CANDIDATES = 10;
// Custo de triagem: no máximo 10 leituras por cobrança relevante. Com 300
// cobranças/mês, o teto esperado é 3.000 leituras/mês, além de reanálises manuais.

function money(value: unknown) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function dateTimestamp(value: string | null, fallback: Date) {
  if (!value) return Timestamp.fromDate(fallback);
  const date = new Date(`${value}T12:00:00-03:00`);
  return Timestamp.fromDate(Number.isNaN(date.getTime()) ? fallback : date);
}

function copyExpenseClassification(provision: Record<string, unknown>) {
  const fields = [
    "accountPlan", "accountId", "accountPlanName", "hasAccountAllocations", "accountAllocations",
    "hasPersonAllocations", "personAllocations", "isApportioned", "resultCenter", "resultCenterId",
    "apportionments", "rateioCriterion", "rateioEffectiveFrom", "rateioFirstMonthMode",
    "plannedPaymentMethodType", "plannedBankAccountId", "plannedBankAccountName",
    "plannedPaymentMethodId", "plannedPaymentMethodLabel", "provisionSeriesKey",
  ];
  return Object.fromEntries(fields.filter((field) => field in provision).map((field) => [field, provision[field]]));
}

export async function analyzeFinancialInboxMessage(id: string, expectedWorkspaceId?: string) {
  const message = await getFinancialInboxMessage(id);
  if (expectedWorkspaceId && message.workspaceId !== expectedWorkspaceId) {
    throw new Error("Cobrança recebida não encontrada.");
  }
  const checkedAt = new Date().toISOString();
  let candidates: ProvisionCandidate[] = [];
  if (message.classification.financeLikely && message.classification.competence) {
    const snapshot = await financialDbAdmin.collection("expenses")
      .where("provisionType", "==", "forecast")
      .where("status", "==", "provisioned")
      .where("provisionCompetence", "==", message.classification.competence)
      .limit(MAX_PROVISION_CANDIDATES)
      .get();
    candidates = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  }
  const suggestion = chooseProvisionSuggestion(message.classification, candidates, checkedAt);
  const nextStatus = suggestion.status === "suggested" ? "suggestion_available" : message.status;
  await financialDbAdmin.collection("financialInboxMessages").doc(id).set({
    provisionSuggestion: suggestion,
    status: ["pending_review", "document_pending", "suggestion_available"].includes(message.status)
      ? nextStatus
      : message.status,
    updatedAt: checkedAt,
  }, { merge: true });
  return { ...message, provisionSuggestion: suggestion, status: nextStatus } as FinancialInboxMessage;
}

export async function linkSuggestedInboxCharge(id: string, actor: PaymentActor, expectedWorkspaceId: string) {
  const messageRef = financialDbAdmin.collection("financialInboxMessages").doc(id);
  const actualRef = financialDbAdmin.collection("expenses").doc(`inbox_${id}`);
  const now = Timestamp.now();
  const nowIso = now.toDate().toISOString();

  return financialDbAdmin.runTransaction(async (transaction) => {
    const messageSnapshot = await transaction.get(messageRef);
    if (!messageSnapshot.exists) throw new Error("Cobrança recebida não encontrada.");
    const message = { id: messageSnapshot.id, ...messageSnapshot.data() } as FinancialInboxMessage;
    if (message.workspaceId !== expectedWorkspaceId) throw new Error("Cobrança recebida não encontrada.");
    if (message.linkedExpenseId) return { message, expenseId: message.linkedExpenseId, duplicate: true };
    const provisionId = message.provisionSuggestion?.status === "suggested"
      ? message.provisionSuggestion.provisionExpenseId
      : null;
    if (!provisionId) throw new Error("A cobrança não possui uma sugestão única de provisionamento.");
    if (message.classification.amountCents == null || message.classification.amountCents <= 0) {
      throw new Error("Confirme o valor da cobrança antes de vinculá-la.");
    }
    const provisionRef = financialDbAdmin.collection("expenses").doc(provisionId);
    const provisionSnapshot = await transaction.get(provisionRef);
    if (!provisionSnapshot.exists) throw new Error("O provisionamento sugerido não existe mais.");
    const provision = provisionSnapshot.data() as Record<string, unknown>;
    if (provision.provisionType !== "forecast" || provision.status !== "provisioned") {
      throw new Error("O provisionamento sugerido já foi tratado. Analise novamente a cobrança.");
    }
    if (provision.provisionCompetence !== message.classification.competence) {
      throw new Error("A competência da cobrança diverge do provisionamento.");
    }

    const actualValue = money(message.classification.amountCents / 100);
    const provisionedValue = money(provision.totalValue);
    const variance = money(actualValue - provisionedValue);
    const obligationId = String(provision.obligationId || `obl_${provisionId}`);
    const dueDate = dateTimestamp(message.classification.dueDate, now.toDate());
    const competenceDate = dateTimestamp(
      message.classification.competence ? `${message.classification.competence}-01` : null,
      dueDate.toDate(),
    );
    const description = String(provision.description || message.subject).trim();
    const supplier = message.classification.supplierName || String(provision.supplier || "");
    const actual = {
      ...copyExpenseClassification(provision),
      workspaceId: WORKSPACE_ID,
      description,
      supplier,
      notes: `Cobrança recebida por e-mail: ${message.subject}`,
      totalValue: actualValue,
      competenceDate,
      dueDate,
      paymentMethod: "single",
      installments: [{ number: 1, dueDate, value: actualValue, status: "pending" }],
      provisionType: "actual",
      provisionCompetence: message.classification.competence,
      obligationId,
      reconciledProvisionId: provisionId,
      provisionReconciliationStatus: "reconciled",
      provisionedValue,
      provisionVariance: variance,
      provisionReconciledAt: now,
      provisionReconciledBy: actor.uid,
      originModule: "financial_inbox",
      financialInboxMessageId: id,
      status: "pending",
      createdAt: now,
      createdBy: actor.uid,
      updatedAt: now,
    };
    const summary = calculateFinancialObligationSummary({
      forecastAmountCents: Math.round(provisionedValue * 100),
      actualAmountCents: message.classification.amountCents,
      settlementAmountCents: message.classification.amountCents,
    });
    transaction.create(actualRef, actual);
    transaction.set(provisionRef, {
      obligationId,
      status: "reconciled",
      replacedByExpenseId: actualRef.id,
      actualValue,
      provisionVariance: variance,
      provisionReconciliationStatus: "reconciled",
      provisionReconciledAt: now,
      provisionReconciledBy: actor.uid,
      updatedAt: now,
    }, { merge: true });
    transaction.set(financialDbAdmin.collection("financialObligations").doc(obligationId), {
      seriesKey: provision.provisionSeriesKey || null,
      competenceKey: message.classification.competence,
      sourceType: "financial_inbox",
      sourceId: id,
      supplierName: supplier || null,
      status: summary.obligationStatus,
      reconciliationStatus: summary.reconciliationStatus,
      summary,
      forecastExpenseId: provisionId,
      actualExpenseId: actualRef.id,
      createdAt: provision.createdAt || now,
      updatedAt: now,
    }, { merge: true });
    transaction.set(messageRef, {
      status: "linked",
      linkedExpenseId: actualRef.id,
      linkedProvisionId: provisionId,
      obligationId,
      "provisionSuggestion.status": "linked",
      reviewedAt: nowIso,
      reviewedBy: actor.uid,
      updatedAt: nowIso,
    }, { merge: true });
    transaction.create(messageRef.collection("events").doc(), {
      type: "CHARGE_LINKED_TO_PROVISION",
      at: nowIso,
      actorId: actor.uid,
      actorEmail: actor.email ?? null,
      expenseId: actualRef.id,
      provisionExpenseId: provisionId,
      obligationId,
      actualValue,
      provisionedValue,
      variance,
    });
    return { message: { ...message, linkedExpenseId: actualRef.id }, expenseId: actualRef.id, duplicate: false };
  });
}

export async function linkInboxChargeToExistingExpense(id: string, expenseId: string, actor: PaymentActor, expectedWorkspaceId: string) {
  const messageRef = financialDbAdmin.collection("financialInboxMessages").doc(id);
  const expenseRef = financialDbAdmin.collection("expenses").doc(expenseId);
  const now = new Date().toISOString();
  return financialDbAdmin.runTransaction(async (transaction) => {
    const [messageSnapshot, expenseSnapshot] = await Promise.all([
      transaction.get(messageRef),
      transaction.get(expenseRef),
    ]);
    if (!messageSnapshot.exists) throw new Error("Cobrança recebida não encontrada.");
    if (!expenseSnapshot.exists) throw new Error("Despesa não encontrada.");
    const message = { id: messageSnapshot.id, ...messageSnapshot.data() } as FinancialInboxMessage;
    if (message.workspaceId !== expectedWorkspaceId) throw new Error("Cobrança recebida não encontrada.");
    const expense = expenseSnapshot.data() || {};
    if (message.linkedExpenseId && message.linkedExpenseId !== expenseId) {
      throw new Error("A cobrança já está vinculada a outra despesa.");
    }
    if (expense.provisionType === "forecast") throw new Error("A cobrança deve ser vinculada à despesa real, não à previsão.");
    if (expense.financialInboxMessageId && expense.financialInboxMessageId !== id) {
      throw new Error("A despesa já está vinculada a outra cobrança recebida.");
    }
    const obligationId = String(expense.obligationId || `obl_${expenseId}`);
    const expenseDateKey = (value: unknown, competence = false) => {
      const date = value && typeof (value as { toDate?: unknown }).toDate === "function"
        ? (value as { toDate: () => Date }).toDate()
        : value ? new Date(value as string | number | Date) : null;
      if (!date || Number.isNaN(date.getTime())) return null;
      const iso = date.toISOString().slice(0, 10);
      return competence ? iso.slice(0, 7) : iso;
    };
    const classification = {
      ...message.classification,
      amountCents: message.classification.amountCents == null && Number(expense.totalValue) > 0
        ? Math.round(Number(expense.totalValue) * 100)
        : message.classification.amountCents,
      dueDate: message.classification.dueDate || expenseDateKey(expense.dueDate),
      competence: message.classification.competence || expenseDateKey(expense.competenceDate, true),
    };
    transaction.set(expenseRef, { financialInboxMessageId: id, updatedAt: Timestamp.now() }, { merge: true });
    transaction.set(messageRef, {
      status: "linked",
      linkedExpenseId: expenseId,
      linkedProvisionId: expense.reconciledProvisionId || null,
      obligationId,
      classification,
      reviewedAt: now,
      reviewedBy: actor.uid,
      updatedAt: now,
    }, { merge: true });
    transaction.create(messageRef.collection("events").doc(), {
      type: "CHARGE_LINKED_MANUALLY",
      at: now,
      actorId: actor.uid,
      actorEmail: actor.email ?? null,
      expenseId,
      obligationId,
    });
    return { message: { ...message, linkedExpenseId: expenseId }, expenseId, duplicate: message.linkedExpenseId === expenseId };
  });
}
