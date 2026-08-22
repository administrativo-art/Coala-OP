import { createHash } from "node:crypto";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { dbAdmin } from "@/lib/firebase-admin";
import {
  consultExpenseProvision,
  expenseProvisionIdentity,
} from "@/features/financial/lib/expense-provisions";
import {
  queueMatchedBankPayment,
  queueReopenedBankPayment,
} from "@/features/financial/obligations/service.server";
import { calculateFinancialObligationSummary, moneyToCents } from "@/features/financial/obligations/calculations";

type RawRecord = Record<string, unknown>;
type ItemStatus = "pending" | "audited" | "ignored" | "completed";

type EffectuationResult = {
  itemId: string;
  status: ItemStatus;
  summary: ReturnType<typeof buildItemSummary>;
};

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function getItemStatus(item: RawRecord): ItemStatus {
  return item.status === "audited" || item.status === "ignored" || item.status === "completed"
    ? item.status
    : "pending";
}

function getItemId(item: RawRecord) {
  return asString(item.id);
}

function buildItemSummary(items: RawRecord[]) {
  return {
    total: items.length,
    pending: items.filter((item) => getItemStatus(item) === "pending").length,
    audited: items.filter((item) => getItemStatus(item) === "audited").length,
    ignored: items.filter((item) => getItemStatus(item) === "ignored").length,
    completed: items.filter((item) => getItemStatus(item) === "completed").length,
  };
}

function deterministicKey(sessionId: string, itemId: string) {
  return createHash("sha256").update(`${sessionId}:${itemId}`).digest("hex").slice(0, 24);
}

function transactionTimestamp(item: RawRecord) {
  const value = asString(item.date) || asString(asRecord(item.financialDraft).date);
  const date = new Date(`${value}T12:00:00-03:00`);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_ITEM_DATE");
  return Timestamp.fromDate(date);
}

function expenseDueTimestamp(value: unknown, fallback: Timestamp) {
  const raw = asString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fallback;
  const date = new Date(`${raw}T12:00:00-03:00`);
  return Number.isNaN(date.getTime()) ? fallback : Timestamp.fromDate(date);
}

function importedFrom(session: RawRecord) {
  return session.origin === "ai_assisted" ? "ai_assisted" : session.origin === "manual" ? "manual" : "bank_statement";
}

function isCardStatementSettlement(item: RawRecord) {
  const draft = asRecord(item.financialDraft);
  if (draft.paymentMethodId === "inter-card-statement-settlement") return true;
  const label = asString(draft.paymentMethodLabel)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("pt-BR");
  return /PAGAMENTO(?:\s+DE)?\s+FATURA|LIQUIDACAO(?:\s+DE)?\s+FATURA/.test(label);
}

function hasText(value: unknown, minLength = 1) {
  return asString(value).trim().length >= minLength;
}

function assertItemReadyForEffectuation(item: RawRecord) {
  const draft = asRecord(item.financialDraft);
  if (
    !hasText(draft.accountId) ||
    !hasText(draft.paymentMethodId) ||
    !hasText(item.date) ||
    !hasText(item.rawDescription, 3)
  ) {
    throw new Error("INCOMPLETE_FINANCIAL_MOVEMENT");
  }

  if (draft.movementKind === "transfer") {
    if (
      !hasText(draft.counterpartyAccountId) ||
      !hasText(draft.counterpartyPaymentMethodId) ||
      asString(draft.counterpartyAccountId) === asString(draft.accountId)
    ) {
      throw new Error("INCOMPLETE_TRANSFER");
    }
    return;
  }

  if (asNumber(item.amount) >= 0 || isCardStatementSettlement(item)) return;

  const expense = asRecord(item.expenseDraft);
  const mode = asString(expense.mode) || "new";
  if (mode === "existing") {
    if (!hasText(expense.linkedExpenseId)) throw new Error("INCOMPLETE_EXPENSE_LINK");
    const paymentTotal = Math.abs(asNumber(item.amount));
    const principal = asNumber(expense.settlementBaseValue) || paymentTotal;
    const interest = asNumber(expense.interest);
    const fine = asNumber(expense.fine);
    const discount = asNumber(expense.discount);
    const abatement = asNumber(expense.abatement);
    const classifiedCharges = Number((interest + fine).toFixed(2));
    const classifiedCredits = Number((discount + abatement).toFixed(2));
    if (
      principal <= 0 ||
      Math.abs(principal + classifiedCharges - classifiedCredits - paymentTotal) > 0.01 ||
      (classifiedCharges > 0.009 && !hasText(expense.chargesAccountPlanId))
    ) throw new Error("INCOMPLETE_PAYMENT_CHARGES");
    return;
  }
  if (mode === "purchase") {
    if (!hasText(expense.purchaseOrderId) || asNumber(expense.allocatedAmount) <= 0) {
      throw new Error("INCOMPLETE_PURCHASE_LINK");
    }
    return;
  }
  if (mode === "split") {
    const splits = asArray(expense.splitExpenses).map(asRecord);
    const total = splits.reduce((sum, split) => sum + asNumber(split.value), 0);
    const valid =
      splits.length > 1 &&
      Math.abs(total - Math.abs(asNumber(item.amount))) < 0.01 &&
      splits.every((split) =>
        hasText(split.description, 10) &&
        hasText(split.supplier, 3) &&
        hasText(split.accountPlanId) &&
        hasText(split.resultCenterId) &&
        hasText(split.competenceDate) &&
        hasText(split.dueDate) &&
        asNumber(split.value) > 0
      );
    if (!valid) throw new Error("INCOMPLETE_SPLIT_EXPENSE");
    return;
  }

  const apportionments = asArray(expense.apportionments).map(asRecord);
  const apportioned = expense.isApportioned === true;
  const apportionmentTotal = apportionments.reduce((sum, entry) => sum + asNumber(entry.percentage), 0);
  const allocationValid = apportioned
    ? apportionments.length > 0 &&
      apportionments.every((entry) => hasText(entry.resultCenterId) && asNumber(entry.percentage) > 0) &&
      Math.abs(apportionmentTotal - 100) < 0.01
    : hasText(expense.resultCenterId);
  const accountAllocations = asArray(expense.accountAllocations).map(asRecord);
  const accountAllocationIds = accountAllocations.map((entry) => asString(entry.accountPlanId)).filter(Boolean);
  const accountAllocationValid = expense.hasAccountAllocations !== true ||
    (accountAllocations.length >= 2 &&
      accountAllocations.every((entry) => hasText(entry.accountPlanId) && asNumber(entry.amount) > 0) &&
      accountAllocationIds.length === new Set(accountAllocationIds).size &&
      Math.abs(accountAllocations.reduce((sum, entry) => sum + asNumber(entry.amount), 0) - Math.abs(asNumber(item.amount))) < 0.01);
  const personAllocations = asArray(expense.personAllocations).map(asRecord);
  const expectedPersonAccounts = expense.hasAccountAllocations === true
    ? accountAllocations.map((entry) => ({
        accountPlanId: asString(entry.accountPlanId),
        amount: asNumber(entry.amount),
      }))
    : [{ accountPlanId: asString(expense.accountPlanId), amount: Math.abs(asNumber(item.amount)) }];
  const personAllocationValid = expense.hasPersonAllocations !== true ||
    (personAllocations.length > 0 &&
      personAllocations.every((entry) =>
        hasText(entry.accountPlanId) &&
        hasText(entry.employeeId) &&
        hasText(entry.employeeName) &&
        hasText(entry.resultCenterId) &&
        ["employer_cost", "employee_deduction", "informational"].includes(asString(entry.analysisType)) &&
        asNumber(entry.amount) > 0
      ) &&
      Math.abs(personAllocations.reduce((sum, entry) => sum + asNumber(entry.amount), 0) - Math.abs(asNumber(item.amount))) < 0.01 &&
      expectedPersonAccounts.every((expected) => {
        const allocated = personAllocations
          .filter((entry) => asString(entry.accountPlanId) === expected.accountPlanId)
          .reduce((sum, entry) => sum + asNumber(entry.amount), 0);
        return Math.abs(allocated - expected.amount) < 0.01;
      }) &&
      personAllocations.every((entry) =>
        expectedPersonAccounts.some((expected) => expected.accountPlanId === asString(entry.accountPlanId))
      ));
  const dueDate = asString(expense.dueDate) || asString(item.date) || asString(draft.date);
  if (
    !hasText(expense.description, 10) ||
    !hasText(expense.supplier, 3) ||
    !hasText(expense.accountPlanId) ||
    !accountAllocationValid ||
    !personAllocationValid ||
    !hasText(expense.competenceDate) ||
    !hasText(dueDate) ||
    !allocationValid
  ) {
    throw new Error("INCOMPLETE_EXPENSE");
  }
}

function appendAuditHistory(item: RawRecord, entry: RawRecord) {
  return [...asArray(item.auditHistory), entry].slice(-50);
}

function withoutPaymentFields(installment: unknown) {
  const current = asRecord(installment);
  const { paidAt: _paidAt, linkedBankTransactionId: _linked, ...rest } = current;
  return { ...rest, status: "pending" };
}

async function applyPurchaseAllocation(params: {
  orderId: string;
  effectuationId: string;
  linkMode: string;
  amount: number;
}) {
  const snapshot = await dbAdmin.collection("purchase_financials")
    .where("purchaseOrderId", "==", params.orderId)
    .limit(1)
    .get();
  const financial = snapshot.docs[0];
  if (!financial) throw new Error("PURCHASE_FINANCIAL_NOT_FOUND");

  return dbAdmin.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(financial.ref);
    const current = currentSnapshot.data() ?? {};
    const history = asArray(current.auditEffectuations).map(asRecord);
    const existingIndex = history.findIndex((entry) => entry.id === params.effectuationId);
    const existing = existingIndex >= 0 ? history[existingIndex] : null;
    if (existing && !existing.reversedAt) {
      return {
        financialId: financial.id,
        goodsAmount: asNumber(existing.goodsAmount),
        freightAmount: asNumber(existing.freightAmount),
      };
    }

    const goodsPaid = asNumber(current.goodsAmountPaid);
    const freightPaid = asNumber(current.freightAmountPaid);
    const goodsPending = Math.max(asNumber(current.goodsAmountEstimated) - goodsPaid, 0);
    const freightPending = Math.max(asNumber(current.freightAmountEstimated) - freightPaid, 0);
    const goodsAmount = existing ? asNumber(existing.goodsAmount) : params.linkMode === "goods"
      ? params.amount
      : params.linkMode === "freight"
      ? 0
      : Math.min(params.amount, goodsPending);
    const freightAmount = existing ? asNumber(existing.freightAmount) : params.linkMode === "freight"
      ? params.amount
      : params.linkMode === "goods"
      ? 0
      : Math.max(params.amount - goodsAmount, 0);
    const nextGoodsPaid = goodsPaid + goodsAmount;
    const nextFreightPaid = freightPaid + freightAmount;
    const fullyPaid =
      nextGoodsPaid >= asNumber(current.goodsAmountEstimated) - 0.01 &&
      nextFreightPaid >= asNumber(current.freightAmountEstimated) - 0.01;
    const effect = existing
      ? {
          ...existing,
          reversedAt: null,
          reappliedAt: new Date().toISOString(),
        }
      : {
          id: params.effectuationId,
          goodsAmount,
          freightAmount,
          previousStatus: asString(current.status),
          appliedAt: new Date().toISOString(),
        };

    transaction.update(financial.ref, {
      goodsAmountPaid: nextGoodsPaid,
      freightAmountPaid: nextFreightPaid,
      auditEffectuations: existingIndex >= 0
        ? history.map((entry, index) => index === existingIndex ? effect : entry)
        : [...history, effect],
      ...(fullyPaid ? { status: "paid", paidAt: new Date().toISOString() } : {}),
      updatedAt: new Date().toISOString(),
    });
    return { financialId: financial.id, goodsAmount, freightAmount };
  });
}

async function reversePurchaseAllocation(params: {
  financialId: string;
  effectuationId: string;
  goodsAmount: number;
  freightAmount: number;
}) {
  if (!params.financialId) return;
  const ref = dbAdmin.collection("purchase_financials").doc(params.financialId);
  await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error("PURCHASE_FINANCIAL_NOT_FOUND");
    const current = snapshot.data() ?? {};
    const history = asArray(current.auditEffectuations).map(asRecord);
    const effectIndex = history.findIndex((entry) => entry.id === params.effectuationId);
    const effect = effectIndex >= 0 ? history[effectIndex] : {};
    if (effect.reversedAt) return;

    const goodsAmount = effectIndex >= 0 ? asNumber(effect.goodsAmount) : params.goodsAmount;
    const freightAmount = effectIndex >= 0 ? asNumber(effect.freightAmount) : params.freightAmount;
    const nextHistory = effectIndex >= 0
      ? history.map((entry, index) => index === effectIndex ? { ...entry, reversedAt: new Date().toISOString() } : entry)
      : [...history, {
          id: params.effectuationId,
          goodsAmount,
          freightAmount,
          legacyReversal: true,
          reversedAt: new Date().toISOString(),
        }];

    transaction.update(ref, {
      goodsAmountPaid: Math.max(asNumber(current.goodsAmountPaid) - goodsAmount, 0),
      freightAmountPaid: Math.max(asNumber(current.freightAmountPaid) - freightAmount, 0),
      auditEffectuations: nextHistory,
      status: asString(effect.previousStatus) || (current.status === "paid" ? "confirmed" : current.status),
      paidAt: current.status === "paid" ? FieldValue.delete() : current.paidAt,
      updatedAt: new Date().toISOString(),
    });
  });
}

async function updateSessionItem(params: {
  sessionId: string;
  itemId: string;
  status: ItemStatus;
  actorId: string;
  actorName: string;
  effectuation: RawRecord;
  historyAction: "effectuated" | "reopened";
  historyReason?: string;
}) {
  const sessionRef = financialDbAdmin.collection("importDrafts").doc(params.sessionId);
  return financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(sessionRef);
    if (!snapshot.exists) throw new Error("NOT_FOUND");
    const session = snapshot.data() ?? {};
    if (session.status !== "open") throw new Error("SESSION_CLOSED");
    const items = asArray(session.items).map(asRecord);
    let found = false;
    const now = new Date().toISOString();
    const nextItems = items.map((item) => {
      if (getItemId(item) !== params.itemId) return item;
      found = true;
      return {
        ...item,
        status: params.status,
        effectuation: params.effectuation,
        auditHistory: appendAuditHistory(item, {
          action: params.historyAction,
          actorId: params.actorId,
          actorName: params.actorName,
          at: now,
          ...(params.historyReason ? { reason: params.historyReason } : {}),
        }),
      };
    });
    if (!found) throw new Error("ITEM_NOT_FOUND");
    const summary = buildItemSummary(nextItems);
    transaction.update(sessionRef, {
      items: nextItems,
      summary,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return summary;
  });
}

export async function effectuateImportSessionItem(params: {
  sessionId: string;
  itemId: string;
  actorId: string;
  actorName: string;
}): Promise<EffectuationResult> {
  const sessionRef = financialDbAdmin.collection("importDrafts").doc(params.sessionId);
  const sessionSnapshot = await sessionRef.get();
  if (!sessionSnapshot.exists) throw new Error("NOT_FOUND");
  const session = sessionSnapshot.data() ?? {};
  if (session.status !== "open") throw new Error("SESSION_CLOSED");
  const items = asArray(session.items).map(asRecord);
  const item = items.find((entry) => getItemId(entry) === params.itemId);
  if (!item) throw new Error("ITEM_NOT_FOUND");
  if (getItemStatus(item) === "completed") {
    return { itemId: params.itemId, status: "completed", summary: buildItemSummary(items) };
  }
  if (getItemStatus(item) !== "audited") throw new Error("ITEM_NOT_AUDITED");

  const effectuationId = deterministicKey(params.sessionId, params.itemId);
  const draft = asRecord(item.financialDraft);
  const expenseDraft = asRecord(item.expenseDraft);
  assertItemReadyForEffectuation(item);
  const amount = Math.abs(asNumber(item.amount));
  const date = transactionTimestamp(item);
  const now = Timestamp.now();
  const imported = importedFrom(session);
  const linkedTransactionId = asString(item.linkedBankTransactionId);
  const primaryTransactionId = linkedTransactionId || `audit_tx_${effectuationId}`;
  const transactionIds: string[] = [primaryTransactionId];
  const expenseIds: string[] = [];
  const createdExpenseIds: string[] = [];
  const batch = financialDbAdmin.batch();
  let purchaseEffect: Awaited<ReturnType<typeof applyPurchaseAllocation>> | null = null;
  let bankPaymentMatch: Awaited<ReturnType<typeof queueMatchedBankPayment>> | null = null;
  const bankPaymentMatches: Awaited<ReturnType<typeof queueMatchedBankPayment>>[] = [];

  async function queueProvisionReconciliation(expenseId: string, expense: RawRecord) {
    const identity = expenseProvisionIdentity(expense);
    if (!identity?.provisionSeriesKey || !identity.provisionCompetence) return {};
    const provisionSnapshot = await financialDbAdmin.collection("expenses")
      .where("provisionSeriesKey", "==", identity.provisionSeriesKey)
      .get();
    const related = provisionSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    const consultation = consultExpenseProvision({ id: expenseId, ...expense, ...identity }, related);
    if (consultation.status === "ambiguous") throw new Error("AMBIGUOUS_EXPENSE_PROVISION");
    if (consultation.status !== "matched" || !consultation.provision.id) {
      return {
        ...identity,
        provisionReconciliationStatus: "forecast_not_found",
      };
    }
    const obligationId = asString((consultation.provision as RawRecord).obligationId) || `obl_${consultation.provision.id}`;
    batch.update(financialDbAdmin.collection("expenses").doc(consultation.provision.id), {
      obligationId,
      status: "reconciled",
      replacedByExpenseId: expenseId,
      actualValue: consultation.actualValue,
      provisionVariance: consultation.variance,
      provisionReconciliationStatus: "reconciled",
      provisionReconciledAt: now,
      provisionReconciledBy: params.actorId,
      updatedAt: now,
    });
    return {
      ...identity,
      obligationId,
      reconciledProvisionId: consultation.provision.id,
      provisionReconciliationStatus: "reconciled",
      provisionedValue: consultation.provisionedValue,
      provisionVariance: consultation.variance,
      provisionReconciledAt: now,
      provisionReconciledBy: params.actorId,
    };
  }

  const baseTransaction = {
    amount,
    date,
    description: asString(item.rawDescription) || asString(draft.description),
    notes: asString(draft.notes),
    accountId: asString(draft.accountId),
    accountName: asString(draft.accountName),
    paymentMethodId: asString(draft.paymentMethodId),
    paymentMethodLabel: asString(draft.paymentMethodLabel),
    importedFrom: imported,
    rawBankDescription: asString(item.rawDescription),
    auditStatus: "resolved",
    auditedBy: params.actorId,
    auditedAt: now,
    importSessionId: params.sessionId,
    importSessionItemId: params.itemId,
    effectuationId,
    effectuationStatus: "active",
    reversed: false,
  };

  if (draft.movementKind === "transfer") {
    const originIsCurrent = asNumber(item.amount) < 0;
    const from = originIsCurrent
      ? { accountId: asString(draft.accountId), accountName: asString(draft.accountName), methodId: asString(draft.paymentMethodId), methodLabel: asString(draft.paymentMethodLabel) }
      : { accountId: asString(draft.counterpartyAccountId), accountName: asString(draft.counterpartyAccountName), methodId: asString(draft.counterpartyPaymentMethodId), methodLabel: asString(draft.counterpartyPaymentMethodLabel) };
    const to = originIsCurrent
      ? { accountId: asString(draft.counterpartyAccountId), accountName: asString(draft.counterpartyAccountName), methodId: asString(draft.counterpartyPaymentMethodId), methodLabel: asString(draft.counterpartyPaymentMethodLabel) }
      : { accountId: asString(draft.accountId), accountName: asString(draft.accountName), methodId: asString(draft.paymentMethodId), methodLabel: asString(draft.paymentMethodLabel) };
    const outPayload = { ...baseTransaction, type: "transfer_out", direction: "out", accountId: from.accountId, accountName: from.accountName, paymentMethodId: from.methodId, paymentMethodLabel: from.methodLabel, toAccountId: to.accountId, toAccountName: to.accountName, toPaymentMethodId: to.methodId, toPaymentMethodLabel: to.methodLabel };
    const inPayload = { ...baseTransaction, type: "transfer_in", direction: "in", accountId: to.accountId, accountName: to.accountName, paymentMethodId: to.methodId, paymentMethodLabel: to.methodLabel, toAccountId: from.accountId, toAccountName: from.accountName, toPaymentMethodId: from.methodId, toPaymentMethodLabel: from.methodLabel };
    const counterpartId = `audit_transfer_${effectuationId}`;
    transactionIds.push(counterpartId);
    batch.set(financialDbAdmin.collection("transactions").doc(primaryTransactionId), originIsCurrent ? outPayload : inPayload, { merge: true });
    batch.set(financialDbAdmin.collection("transactions").doc(counterpartId), {
      ...(originIsCurrent ? inPayload : outPayload),
      sourceBankTransactionId: linkedTransactionId || primaryTransactionId,
      createdBy: params.actorId,
      createdAt: now,
    }, { merge: true });
  } else if (asNumber(item.amount) < 0 && isCardStatementSettlement(item)) {
    batch.set(financialDbAdmin.collection("transactions").doc(primaryTransactionId), {
      ...baseTransaction,
      type: "card_statement_payment",
      direction: "out",
      accountPlanId: null,
      accountPlanName: null,
      resultCenterId: null,
      resultCenterName: null,
      supplier: null,
      expenseId: null,
      linkedExpenseId: null,
      awaitingCardStatementReconciliation: true,
      ...(linkedTransactionId ? {} : { createdBy: params.actorId, createdAt: now }),
    }, { merge: true });
  } else if (asNumber(item.amount) < 0) {
    const mode = asString(expenseDraft.mode) || "new";
    const splitExpenses = asArray(expenseDraft.splitExpenses).map(asRecord);
    const principal = mode === "existing" ? asNumber(expenseDraft.settlementBaseValue) || amount : amount;
    const interest = mode === "existing" ? asNumber(expenseDraft.interest) : 0;
    const fine = mode === "existing" ? asNumber(expenseDraft.fine) : 0;
    const discount = mode === "existing" ? asNumber(expenseDraft.discount) : 0;
    const abatement = mode === "existing" ? asNumber(expenseDraft.abatement) : 0;
    const charges = Number((interest + fine).toFixed(2));
    const settlementCredits = Number((discount + abatement).toFixed(2));
    const principalPaid = Number(Math.max(amount - charges, 0).toFixed(2));
    let chargeExpenseId = "";
    let expenseId = asString(expenseDraft.linkedExpenseId);

    if (mode === "split") {
      for (const [index, split] of splitExpenses.entries()) {
        const id = `audit_exp_${effectuationId}_${index + 1}`;
        const dueDate = expenseDueTimestamp(split.dueDate, date);
        const competenceDate = Timestamp.fromDate(new Date(`${asString(split.competenceDate)}T12:00:00-03:00`));
        const provisionFields = await queueProvisionReconciliation(id, {
          description: asString(split.description),
          accountPlanName: asString(split.accountPlanName),
          competenceDate,
          totalValue: asNumber(split.value),
          provisionType: "actual",
        });
        const splitPaymentMatch = await queueMatchedBankPayment({
          batch,
          expenseId: id,
          expense: {
            obligationId: `obl_${id}`,
            description: asString(split.description),
            supplier: asString(split.supplier),
            totalValue: asNumber(split.value),
            competenceDate,
            dueDate,
            provisionType: "actual",
            ...provisionFields,
          },
          bankTransactionId: primaryTransactionId,
          principalAmount: asNumber(split.value),
          cashAmount: asNumber(split.value),
          paidAt: date,
          actor: { uid: params.actorId, name: params.actorName },
        });
        bankPaymentMatches.push(splitPaymentMatch);
        expenseIds.push(id);
        createdExpenseIds.push(id);
        batch.set(financialDbAdmin.collection("expenses").doc(id), {
          accountPlan: asString(split.accountPlanId),
          accountId: asString(split.accountPlanId),
          accountPlanName: asString(split.accountPlanName),
          description: asString(split.description),
          supplier: asString(split.supplier),
          notes: asString(expenseDraft.notes) || asString(item.rawDescription),
          totalValue: asNumber(split.value),
          competenceDate,
          dueDate,
          paymentMethod: "single",
          hasAccountAllocations: false,
          accountAllocations: null,
          hasPersonAllocations: false,
          personAllocations: null,
          isApportioned: false,
          resultCenter: asString(split.resultCenterName) || null,
          installments: [{ number: 1, dueDate, value: asNumber(split.value), status: "paid", paidAt: date, linkedBankTransactionId: primaryTransactionId }],
          status: "paid",
          paidAt: date,
          paidByImport: true,
          linkedBankTransactionId: primaryTransactionId,
          importedFrom: imported,
          rawBankDescription: asString(item.rawDescription),
          importSessionId: params.sessionId,
          importSessionItemId: params.itemId,
          effectuationId,
          ...provisionFields,
          ...splitPaymentMatch.expensePatch,
          createdBy: params.actorId,
          createdAt: now,
          updatedAt: now,
        }, { merge: true });
      }
      expenseId = expenseIds[0] || "";
    } else if (mode === "new") {
      expenseId = `audit_exp_${effectuationId}`;
      const dueDate = expenseDueTimestamp(expenseDraft.dueDate, date);
      const competenceDate = Timestamp.fromDate(new Date(`${asString(expenseDraft.competenceDate)}T12:00:00-03:00`));
      const provisionFields = await queueProvisionReconciliation(expenseId, {
        description: asString(expenseDraft.description),
        accountPlanName: asString(expenseDraft.accountPlanName),
        competenceDate,
        totalValue: amount,
        provisionType: "actual",
      });
      bankPaymentMatch = await queueMatchedBankPayment({
        batch,
        expenseId,
        expense: {
          obligationId: `obl_${expenseId}`,
          description: asString(expenseDraft.description),
          supplier: asString(expenseDraft.supplier),
          totalValue: amount,
          competenceDate,
          dueDate,
          provisionType: "actual",
          ...provisionFields,
        },
        bankTransactionId: primaryTransactionId,
        principalAmount: amount,
        cashAmount: amount,
        paidAt: date,
        actor: { uid: params.actorId, name: params.actorName },
      });
      bankPaymentMatches.push(bankPaymentMatch);
      expenseIds.push(expenseId);
      createdExpenseIds.push(expenseId);
      batch.set(financialDbAdmin.collection("expenses").doc(expenseId), {
        accountPlan: asString(expenseDraft.accountPlanId),
        accountId: asString(expenseDraft.accountPlanId),
        accountPlanName: asString(expenseDraft.accountPlanName),
        description: asString(expenseDraft.description),
        supplier: asString(expenseDraft.supplier),
        notes: asString(expenseDraft.notes),
        totalValue: amount,
        competenceDate,
        dueDate,
        paymentMethod: "single",
        hasAccountAllocations: expenseDraft.hasAccountAllocations === true,
        accountAllocations: expenseDraft.hasAccountAllocations === true
          ? asArray(expenseDraft.accountAllocations).map((entry) => ({
              accountPlanId: asString(asRecord(entry).accountPlanId),
              accountPlanName: asString(asRecord(entry).accountPlanName),
              amount: asNumber(asRecord(entry).amount),
            }))
          : null,
        hasPersonAllocations: expenseDraft.hasPersonAllocations === true,
        personAllocations: expenseDraft.hasPersonAllocations === true
          ? asArray(expenseDraft.personAllocations).map((entry) => {
              const allocation = asRecord(entry);
              return {
                id: asString(allocation.id),
                accountPlanId: asString(allocation.accountPlanId),
                accountPlanName: asString(allocation.accountPlanName),
                employeeId: asString(allocation.employeeId),
                employeeName: asString(allocation.employeeName),
                analysisType: asString(allocation.analysisType) || "informational",
                amount: asNumber(allocation.amount),
                resultCenterId: asString(allocation.resultCenterId),
                resultCenter: asString(allocation.resultCenterName),
                payrollDocumentId: asString(allocation.payrollDocumentId) || null,
                contractReference: asString(allocation.contractReference) || null,
                creditorName: asString(allocation.creditorName) || null,
              };
            })
          : null,
        isApportioned: expenseDraft.isApportioned === true,
        resultCenter: expenseDraft.isApportioned === true ? null : asString(expenseDraft.resultCenterName) || null,
        apportionments: expenseDraft.isApportioned === true ? asArray(expenseDraft.apportionments).map((entry) => ({ resultCenter: asString(asRecord(entry).resultCenterName), percentage: asNumber(asRecord(entry).percentage) })) : null,
        installments: [{ number: 1, dueDate, value: amount, status: "paid", paidAt: date, linkedBankTransactionId: primaryTransactionId }],
        status: "paid",
        paidAt: date,
        paidByImport: true,
        linkedBankTransactionId: primaryTransactionId,
        importedFrom: imported,
        rawBankDescription: asString(item.rawDescription),
        importSessionId: params.sessionId,
        importSessionItemId: params.itemId,
        effectuationId,
        ...provisionFields,
        ...bankPaymentMatch.expensePatch,
        createdBy: params.actorId,
        createdAt: now,
        updatedAt: now,
      }, { merge: true });
    } else if (expenseId) {
      expenseIds.push(expenseId);
      const expenseRef = financialDbAdmin.collection("expenses").doc(expenseId);
      const expenseSnapshot = await expenseRef.get();
      if (!expenseSnapshot.exists) throw new Error("EXPENSE_NOT_FOUND");
      const expense = expenseSnapshot.data() ?? {};
      const installmentNumber = asNumber(expenseDraft.settlementInstallmentNumber) || asNumber(item.suggestedInstallmentNumber);
      const installments = asArray(expense.installments).map(asRecord);
      const targetInstallment = installmentNumber > 0
        ? installments.find((installment, index) => (asNumber(installment.number) || index + 1) === installmentNumber)
        : null;
      const reportedPaymentId = asString(expenseDraft.reportedPaymentId);
      const reportedLinkId = asString(expenseDraft.reportedLinkId);
      const reportedPaymentSnapshot = reportedPaymentId
        ? await financialDbAdmin.collection("payments").doc(reportedPaymentId).get()
        : null;
      const reportedPayment = reportedPaymentSnapshot?.data() ?? null;
      if (reportedPaymentId && (
        !reportedPaymentSnapshot?.exists ||
        asString(reportedPayment?.expenseId) !== expenseId ||
        asString(reportedPayment?.status) !== "REPORTED" ||
        (reportedLinkId && asString(reportedPayment?.linkId) !== reportedLinkId)
      )) {
        throw new Error("REPORTED_PAYMENT_CHANGED");
      }
      const outstandingBalance = Number(expense.settlementSummary?.balanceAmountCents) / 100;
      const availablePrincipal = reportedPayment
        ? Number(reportedPayment.principalAmountCents) / 100 || asNumber(reportedPayment.baseValue)
        : targetInstallment
          ? asNumber(targetInstallment.value)
          : outstandingBalance > 0
            ? outstandingBalance
            : asNumber(expense.totalValue);
      if (
        principal <= 0 ||
        principal - availablePrincipal > 0.01 ||
        (reportedPayment && Math.abs(availablePrincipal - principalPaid) > 0.01)
      ) {
        throw new Error("EXPENSE_VALUE_CHANGED");
      }
      if (Math.abs(principalPaid + settlementCredits - principal) > 0.01) throw new Error("INCOMPLETE_PAYMENT_ADJUSTMENTS");
      const nextInstallments = installmentNumber > 0
        ? installments.map((installment, index) => (asNumber(installment.number) || index + 1) === installmentNumber
            ? principal >= asNumber(installment.value) - 0.01
              ? { ...installment, status: "paid", paidAt: date, linkedBankTransactionId: primaryTransactionId }
              : {
                  ...installment,
                  status: "partially_paid",
                  paidValue: Number((asNumber(installment.paidValue) + principalPaid).toFixed(2)),
                  settlementCreditValue: Number((asNumber(installment.settlementCreditValue) + settlementCredits).toFixed(2)),
                  lastPaymentAt: date,
                  linkedBankTransactionId: primaryTransactionId,
                }
            : installment)
        : installments;
      const fullyPaid = nextInstallments.length === 0 || nextInstallments.every((installment) => installment.status === "paid" || installment.status === "cancelled");
      if (charges > 0.009) {
        const chargeAccountRef = financialDbAdmin.collection("accounts").doc(asString(expenseDraft.chargesAccountPlanId));
        const chargeAccountSnapshot = await chargeAccountRef.get();
        const chargeAccount = chargeAccountSnapshot.data() ?? {};
        if (!chargeAccountSnapshot.exists || chargeAccount.active === false || chargeAccount.isGroup === true) {
          throw new Error("INVALID_PAYMENT_CHARGE_ACCOUNT");
        }
        const existingManualChargeExpenseId =
          asString(reportedPayment?.manualChargeExpenseId) ||
          asString(expense.manualChargesExpenseId);
        chargeExpenseId = existingManualChargeExpenseId || `audit_charge_${effectuationId}`;
        expenseIds.push(chargeExpenseId);
        if (!existingManualChargeExpenseId) createdExpenseIds.push(chargeExpenseId);
        const chargeRef = financialDbAdmin.collection("expenses").doc(chargeExpenseId);
        batch.set(chargeRef, {
          accountPlan: asString(expenseDraft.chargesAccountPlanId),
          accountId: asString(expenseDraft.chargesAccountPlanId),
          accountPlanId: asString(expenseDraft.chargesAccountPlanId),
          accountPlanName: asString(chargeAccount.name) || asString(expenseDraft.chargesAccountPlanName),
          description: `Juros e multa | ${asString(expense.description) || asString(expenseDraft.description)}`,
          supplier: asString(expense.supplier) || asString(expenseDraft.supplier),
          notes: `Encargos identificados na conciliação do extrato. Principal: ${principal.toFixed(2)}.`,
          totalValue: charges,
          competenceDate: date,
          dueDate: date,
          paymentMethod: "single",
          type: "encargo",
          originExpenseId: expenseId,
          interest,
          fine,
          hasAccountAllocations: false,
          accountAllocations: null,
          hasPersonAllocations: false,
          personAllocations: null,
          isApportioned: expense.isApportioned === true,
          resultCenter: expense.isApportioned === true ? null : asString(expense.resultCenter) || asString(expense.resultCenterName) || null,
          resultCenterId: expense.isApportioned === true ? null : asString(expense.resultCenterId) || null,
          resultCenterName: expense.isApportioned === true ? null : asString(expense.resultCenterName) || asString(expense.resultCenter) || null,
          apportionments: expense.isApportioned === true ? expense.apportionments || null : null,
          installments: [{ number: 1, dueDate: date, value: charges, status: "paid", paidAt: date, linkedBankTransactionId: primaryTransactionId }],
          status: "paid",
          paymentState: "paid",
          paidAt: date,
          paidByImport: true,
          evidenceSource: "BANK_STATEMENT",
          obligationId: asString(expense.obligationId) || null,
          linkedBankTransactionId: primaryTransactionId,
          importedFrom: imported,
          rawBankDescription: asString(item.rawDescription),
          importSessionId: params.sessionId,
          importSessionItemId: params.itemId,
          effectuationId,
          ...(existingManualChargeExpenseId ? {} : { createdBy: params.actorId, createdAt: now }),
          updatedAt: now,
        }, { merge: true });
      }

      bankPaymentMatch = await queueMatchedBankPayment({
        batch,
        expenseId,
        expense,
        bankTransactionId: primaryTransactionId,
        reportedPaymentId: reportedPaymentId || null,
        reportedLinkId: reportedLinkId || null,
        principalAmount: principalPaid,
        cashAmount: amount,
        interest,
        fine,
        discount,
        abatement,
        paidAt: date,
        actor: { uid: params.actorId, name: params.actorName },
        chargesAccountPlanId: asString(expenseDraft.chargesAccountPlanId) || null,
        chargesAccountPlanName: asString(expenseDraft.chargesAccountPlanName) || null,
        chargeExpenseId: chargeExpenseId || null,
      });
      bankPaymentMatches.push(bankPaymentMatch);
      batch.set(expenseRef, {
        ...(nextInstallments.length > 0 ? { installments: nextInstallments } : {}),
        linkedBankTransactionId: primaryTransactionId,
        linkedBankTransactionIds: FieldValue.arrayUnion(primaryTransactionId),
        lastPaymentAt: date,
        paidByImport: true,
        updatedAt: now,
        ...(fullyPaid ? { status: "paid", paidAt: date } : {}),
        ...bankPaymentMatch.expensePatch,
      }, { merge: true });
    }

    if (mode === "purchase") {
      purchaseEffect = await applyPurchaseAllocation({
        orderId: asString(expenseDraft.purchaseOrderId),
        effectuationId,
        linkMode: asString(expenseDraft.purchaseLinkMode),
        amount: asNumber(expenseDraft.allocatedAmount) || amount,
      });
    }

    batch.set(financialDbAdmin.collection("transactions").doc(primaryTransactionId), {
      ...baseTransaction,
      type: "expense_payment",
      direction: "out",
      accountPlanId: asString(expenseDraft.accountPlanId) || null,
      accountPlanName: asString(expenseDraft.accountPlanName) || null,
      hasAccountAllocations: expenseDraft.hasAccountAllocations === true,
      accountAllocations: expenseDraft.hasAccountAllocations === true
        ? asArray(expenseDraft.accountAllocations).map((entry) => ({
            accountPlanId: asString(asRecord(entry).accountPlanId),
            accountPlanName: asString(asRecord(entry).accountPlanName),
            amount: asNumber(asRecord(entry).amount),
          }))
        : null,
      hasPersonAllocations: expenseDraft.hasPersonAllocations === true,
      personAllocations: expenseDraft.hasPersonAllocations === true
        ? asArray(expenseDraft.personAllocations).map((entry) => {
            const allocation = asRecord(entry);
            return {
              id: asString(allocation.id),
              accountPlanId: asString(allocation.accountPlanId),
              accountPlanName: asString(allocation.accountPlanName),
              employeeId: asString(allocation.employeeId),
              employeeName: asString(allocation.employeeName),
              analysisType: asString(allocation.analysisType) || "informational",
              amount: asNumber(allocation.amount),
              resultCenterId: asString(allocation.resultCenterId),
              resultCenter: asString(allocation.resultCenterName),
              payrollDocumentId: asString(allocation.payrollDocumentId) || null,
              contractReference: asString(allocation.contractReference) || null,
              creditorName: asString(allocation.creditorName) || null,
            };
          })
        : null,
      resultCenterId: asString(expenseDraft.resultCenterId) || null,
      resultCenterName: asString(expenseDraft.resultCenterName) || null,
      supplier: asString(expenseDraft.supplier) || null,
      expenseId: expenseId || null,
      linkedExpenseId: expenseId || null,
      splitExpenseIds: mode === "split" && expenseIds.length > 1 ? expenseIds : null,
      purchaseOrderId: asString(expenseDraft.purchaseOrderId) || null,
      purchaseLinkMode: mode === "purchase" ? asString(expenseDraft.purchaseLinkMode) : null,
      allocatedAmount: mode === "purchase" ? asNumber(expenseDraft.allocatedAmount) || amount : null,
      baseValue: principal,
      principalPaid,
      interest,
      fine,
      discount,
      abatement,
      charges,
      chargeExpenseId: chargeExpenseId || null,
      obligationId: bankPaymentMatches.length === 1 ? bankPaymentMatches[0].obligationId : null,
      obligationPaymentLinkId: bankPaymentMatches.length === 1 ? bankPaymentMatches[0].linkId : null,
      obligationPaymentId: bankPaymentMatches.length === 1 ? bankPaymentMatches[0].paymentId : null,
      obligationAllocations: bankPaymentMatches.map((entry, index) => ({
        obligationId: entry.obligationId,
        linkId: entry.linkId,
        paymentId: entry.paymentId,
        expenseId: expenseIds[index] || null,
        principalAmount: entry.matchedPrincipalAmountCents / 100,
        cashAmount: entry.matchedCashAmountCents / 100,
      })),
      ...(linkedTransactionId ? {} : { createdBy: params.actorId, createdAt: now }),
    }, { merge: true });
  } else {
    batch.set(financialDbAdmin.collection("transactions").doc(primaryTransactionId), {
      ...baseTransaction,
      type: "revenue",
      direction: "in",
      revenueCategory: "other",
      revenueSource: imported,
      ...(linkedTransactionId ? {} : { createdBy: params.actorId, createdAt: now }),
    }, { merge: true });
  }

  await batch.commit();
  const effectuation = {
    id: effectuationId,
    status: "active",
    transactionIds,
    expenseIds,
    createdExpenseIds,
    purchaseFinancialId: purchaseEffect?.financialId || null,
    purchaseGoodsAmount: purchaseEffect?.goodsAmount || 0,
    purchaseFreightAmount: purchaseEffect?.freightAmount || 0,
    effectuatedAt: new Date().toISOString(),
    effectuatedBy: params.actorId,
  };
  const summary = await updateSessionItem({
    sessionId: params.sessionId,
    itemId: params.itemId,
    status: "completed",
    actorId: params.actorId,
    actorName: params.actorName,
    effectuation,
    historyAction: "effectuated",
  });
  return { itemId: params.itemId, status: "completed", summary };
}

export async function reopenImportSessionItem(params: {
  sessionId: string;
  itemId: string;
  actorId: string;
  actorName: string;
  reason: string;
}): Promise<EffectuationResult> {
  const sessionRef = financialDbAdmin.collection("importDrafts").doc(params.sessionId);
  const sessionSnapshot = await sessionRef.get();
  if (!sessionSnapshot.exists) throw new Error("NOT_FOUND");
  const session = sessionSnapshot.data() ?? {};
  if (session.status !== "open") throw new Error("SESSION_CLOSED");
  const items = asArray(session.items).map(asRecord);
  const item = items.find((entry) => getItemId(entry) === params.itemId);
  if (!item) throw new Error("ITEM_NOT_FOUND");
  if (getItemStatus(item) !== "completed") throw new Error("ITEM_NOT_COMPLETED");

  const effect = asRecord(item.effectuation);
  const effectuationId = asString(effect.id) || deterministicKey(params.sessionId, params.itemId);
  const linkedTransactionId = asString(item.linkedBankTransactionId);
  const transactionIds = asArray(effect.transactionIds).map(asString).filter(Boolean);
  const primaryTransactionId = linkedTransactionId || transactionIds[0] || `audit_tx_${effectuationId}`;
  const primaryRef = financialDbAdmin.collection("transactions").doc(primaryTransactionId);
  const primarySnapshot = await primaryRef.get();
  const primary = primarySnapshot.data() ?? {};
  const expenseDraft = asRecord(item.expenseDraft);
  const mode = asString(expenseDraft.mode) || "new";
  const expenseIds = asArray(effect.expenseIds).map(asString).filter(Boolean);
  if (expenseIds.length === 0) {
    const transactionExpenseIds = [primary.expenseId, ...asArray(primary.splitExpenseIds)].map(asString).filter(Boolean);
    expenseIds.push(...new Set(transactionExpenseIds));
  }
  const now = Timestamp.now();
  const batch = financialDbAdmin.batch();

  if (linkedTransactionId) {
    batch.set(primaryRef, {
      auditStatus: "pending",
      effectuationStatus: "reopened",
      reopenedAt: now,
      reopenedBy: params.actorId,
      reopenReason: params.reason,
      auditedAt: FieldValue.delete(),
      auditedBy: FieldValue.delete(),
      accountPlanId: null,
      accountPlanName: null,
      resultCenterId: null,
      resultCenterName: null,
      supplier: null,
      expenseId: null,
      linkedExpenseId: null,
      splitExpenseIds: null,
      purchaseOrderId: null,
      purchaseLinkMode: null,
      allocatedAmount: null,
      awaitingCardStatementReconciliation: false,
      cardStatementId: FieldValue.delete(),
      obligationId: FieldValue.delete(),
      obligationPaymentLinkId: FieldValue.delete(),
      obligationPaymentId: FieldValue.delete(),
      obligationAllocations: FieldValue.delete(),
      description: asString(item.rawDescription),
    }, { merge: true });
  } else if (primarySnapshot.exists) {
    batch.set(primaryRef, {
      auditStatus: "reversed",
      effectuationStatus: "reopened",
      reversed: true,
      reversedAt: now,
      reversedBy: params.actorId,
      reversalReason: params.reason,
    }, { merge: true });
  }

  for (const transactionId of transactionIds.filter((id) => id !== primaryTransactionId)) {
    batch.set(financialDbAdmin.collection("transactions").doc(transactionId), {
      auditStatus: "reversed",
      effectuationStatus: "reopened",
      reversed: true,
      reversedAt: now,
      reversedBy: params.actorId,
      reversalReason: params.reason,
    }, { merge: true });
  }

  const reconciledCardStatementId = asString(primary.cardStatementId);
  if (reconciledCardStatementId) {
    const statementRef = financialDbAdmin.collection("cardStatements").doc(reconciledCardStatementId);
    const statementSnapshot = await statementRef.get();
    const statement = statementSnapshot.data() ?? {};
    const obligationId = asString(primary.obligationId) || asString(statement.obligationId);
    const linkId = asString(primary.obligationPaymentLinkId);
    const paymentId = asString(primary.obligationPaymentId);
    const allocations = asArray(statement.allocations).map(asRecord);
    const cardExpenseIds = [...new Set(allocations.map((allocation) => asString(allocation.expenseId)).filter(Boolean))];
    for (const cardExpenseId of cardExpenseIds) {
      const cardExpenseRef = financialDbAdmin.collection("expenses").doc(cardExpenseId);
      const cardExpenseSnapshot = await cardExpenseRef.get();
      if (!cardExpenseSnapshot.exists) continue;
      const cardExpense = cardExpenseSnapshot.data() ?? {};
      const nextInstallments: RawRecord[] = asArray(cardExpense.installments).map(asRecord).map((installment): RawRecord =>
        asString(installment.linkedBankTransactionId) === primaryTransactionId
          ? withoutPaymentFields(installment) as RawRecord
          : installment
      );
      const paidPrincipalCents = nextInstallments
        .filter((installment) => installment.status === "paid")
        .reduce((total, installment) => total + moneyToCents(installment.value), 0);
      const actualAmountCents = moneyToCents(cardExpense.totalValue);
      const cardSummary = calculateFinancialObligationSummary({
        forecastAmountCents: cardExpense.provisionedValue == null ? null : moneyToCents(cardExpense.provisionedValue),
        actualAmountCents,
        paymentAllocations: paidPrincipalCents > 0 ? [{
          principalAmountCents: paidPrincipalCents,
          cashAmountCents: paidPrincipalCents,
          status: "MATCHED",
        }] : [],
      });
      batch.set(cardExpenseRef, {
        installments: nextInstallments,
        status: cardSummary.obligationStatus === "PARTIALLY_PAID" ? "partially_paid" : "pending",
        paymentState: cardSummary.obligationStatus === "PARTIALLY_PAID" ? "partially_paid" : "open",
        settlementSummary: cardSummary,
        paidAt: FieldValue.delete(),
        linkedBankTransactionId: FieldValue.delete(),
        linkedBankTransactionIds: FieldValue.arrayRemove(primaryTransactionId),
        cardStatementObligationIds: obligationId ? FieldValue.arrayRemove(obligationId) : [],
        latestCardStatementObligationId: FieldValue.delete(),
        updatedAt: now,
      }, { merge: true });
    }
    if (statementSnapshot.exists) {
      batch.set(statementRef, {
        status: "closed",
        linkedBankTransactionId: FieldValue.delete(),
        linkedBankTransactionIds: FieldValue.arrayRemove(primaryTransactionId),
        settlements: asArray(statement.settlements).filter((settlement) => asString(asRecord(settlement).transactionId) !== primaryTransactionId),
        paidAt: FieldValue.delete(),
        paidBy: FieldValue.delete(),
        settlementSummary: FieldValue.delete(),
        reopenedAt: now,
        reopenedBy: params.actorId,
        updatedAt: now,
      }, { merge: true });
    }
    if (linkId) batch.set(financialDbAdmin.collection("obligationPaymentLinks").doc(linkId), { status: "VOIDED", voidReason: "BANK_AUDIT_REOPENED", updatedAt: now }, { merge: true });
    if (paymentId) batch.set(financialDbAdmin.collection("payments").doc(paymentId), { status: "REVERSED", reconciliationStatus: "NOT_FOUND", updatedAt: now }, { merge: true });
    if (obligationId) {
      const reopenedSummary = calculateFinancialObligationSummary({
        forecastAmountCents: Number(statement.provisionedTotal) > 0 ? moneyToCents(statement.provisionedTotal) : moneyToCents(statement.projectedTotal) || null,
        actualAmountCents: moneyToCents(statement.officialTotal),
      });
      const obligationRef = financialDbAdmin.collection("financialObligations").doc(obligationId);
      batch.set(obligationRef, { status: reopenedSummary.obligationStatus, reconciliationStatus: reopenedSummary.reconciliationStatus, summary: reopenedSummary, updatedAt: now }, { merge: true });
      batch.set(obligationRef.collection("events").doc(`reopen_card_${deterministicKey(reconciledCardStatementId, primaryTransactionId)}`), {
        type: "CARD_STATEMENT_PAYMENT_REOPENED",
        obligationId,
        cardStatementId: reconciledCardStatementId,
        bankTransactionId: primaryTransactionId,
        actor: { uid: params.actorId, name: params.actorName },
        occurredAt: now,
      }, { merge: true });
    }
  }

  for (const expenseId of expenseIds) {
    const expenseRef = financialDbAdmin.collection("expenses").doc(expenseId);
    const expenseSnapshot = await expenseRef.get();
    if (!expenseSnapshot.exists) continue;
    const expense = expenseSnapshot.data() ?? {};
    const reopenedPayment = await queueReopenedBankPayment({
      batch,
      expenseId,
      expense,
      bankTransactionId: primaryTransactionId,
      actor: { uid: params.actorId, name: params.actorName },
    });
    const reconciledProvisionId = asString(expense.reconciledProvisionId);
    if (reconciledProvisionId) {
      batch.set(financialDbAdmin.collection("expenses").doc(reconciledProvisionId), {
        status: "provisioned",
        replacedByExpenseId: FieldValue.delete(),
        actualValue: FieldValue.delete(),
        provisionVariance: FieldValue.delete(),
        provisionReconciliationStatus: "awaiting_actual",
        provisionReconciledAt: FieldValue.delete(),
        provisionReconciledBy: FieldValue.delete(),
        updatedAt: now,
      }, { merge: true });
    }
    const installments = asArray(expense.installments).map(asRecord);
    const targetInstallment = asNumber(item.suggestedInstallmentNumber);
    const nextInstallments = installments.map((installment, index) => {
      const number = asNumber(installment.number) || index + 1;
      const belongsToItem = asString(installment.linkedBankTransactionId) === primaryTransactionId || (targetInstallment > 0 && number === targetInstallment);
      return belongsToItem ? withoutPaymentFields(installment) : installment;
    });
    const restoreManualAdjustment =
      expense.isPaymentAdjustment === true &&
      asString(expense.paymentId).startsWith("manual_");
    batch.set(expenseRef, {
      status: "pending",
      auditStatus: "pending",
      installments: nextInstallments,
      paidAt: FieldValue.delete(),
      paidByImport: false,
      linkedBankTransactionId: FieldValue.delete(),
      linkedBankTransactionIds: FieldValue.arrayRemove(primaryTransactionId),
      reconciledProvisionId: FieldValue.delete(),
      provisionedValue: FieldValue.delete(),
      provisionVariance: FieldValue.delete(),
      provisionReconciliationStatus: expense.provisionSeriesKey ? "forecast_not_found" : FieldValue.delete(),
      provisionReconciledAt: FieldValue.delete(),
      provisionReconciledBy: FieldValue.delete(),
      reopenedAt: now,
      reopenedBy: params.actorId,
      ...(reopenedPayment?.expensePatch || {}),
      ...(restoreManualAdjustment ? {
        status: "paid",
        paymentState: "reported_paid",
        evidenceSource: "MANUAL",
        paidAt: expense.paidAt || expense.competenceDate || now,
      } : {}),
      reopenReason: params.reason,
      updatedAt: now,
    }, { merge: true });
  }

  await batch.commit();

  const purchaseFinancialId = asString(effect.purchaseFinancialId);
  if (mode === "purchase" && purchaseFinancialId) {
    await reversePurchaseAllocation({
      financialId: purchaseFinancialId,
      effectuationId,
      goodsAmount: asNumber(effect.purchaseGoodsAmount),
      freightAmount: asNumber(effect.purchaseFreightAmount),
    });
  }

  const nextEffect = {
    ...effect,
    id: effectuationId,
    status: "reopened",
    reopenedAt: new Date().toISOString(),
    reopenedBy: params.actorId,
    reopenReason: params.reason,
  };
  const summary = await updateSessionItem({
    sessionId: params.sessionId,
    itemId: params.itemId,
    status: "pending",
    actorId: params.actorId,
    actorName: params.actorName,
    effectuation: nextEffect,
    historyAction: "reopened",
    historyReason: params.reason,
  });
  return { itemId: params.itemId, status: "pending", summary };
}

export function buildStatementClosure(items: RawRecord[]) {
  const entries = items.filter((item) => asNumber(item.amount) > 0).reduce((total, item) => total + asNumber(item.amount), 0);
  const exits = items.filter((item) => asNumber(item.amount) < 0).reduce((total, item) => total + Math.abs(asNumber(item.amount)), 0);
  const completedItems = items.filter((item) => getItemStatus(item) === "completed");
  const ignoredItems = items.filter((item) => getItemStatus(item) === "ignored");
  return {
    itemCount: items.length,
    completedCount: completedItems.length,
    ignoredCount: ignoredItems.length,
    entries,
    exits,
    balance: entries - exits,
    completedAmount: completedItems.reduce((total, item) => total + Math.abs(asNumber(item.amount)), 0),
    ignoredAmount: ignoredItems.reduce((total, item) => total + Math.abs(asNumber(item.amount)), 0),
  };
}

export async function closeImportStatement(params: {
  sessionId: string;
  actorId: string;
  actorName: string;
}) {
  const sessionRef = financialDbAdmin.collection("importDrafts").doc(params.sessionId);
  return financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(sessionRef);
    if (!snapshot.exists) throw new Error("NOT_FOUND");
    const session = snapshot.data() ?? {};
    if (session.status !== "open") throw new Error("SESSION_CLOSED");
    const items = asArray(session.items).map(asRecord);
    const summary = buildItemSummary(items);
    if (summary.pending > 0 || summary.audited > 0) throw new Error("STATEMENT_HAS_PENDING_ITEMS");
    const closure = buildStatementClosure(items);
    const closureHash = createHash("sha256").update(JSON.stringify(items.map((item) => ({
      id: item.id,
      date: item.date,
      amount: item.amount,
      status: item.status,
      expenseDraft: item.expenseDraft,
      financialDraft: item.financialDraft,
    })))).digest("hex");
    transaction.update(sessionRef, {
      status: "completed",
      summary,
      closure,
      closureHash,
      closedBy: params.actorId,
      closedByName: params.actorName,
      closedAt: FieldValue.serverTimestamp(),
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      statementOutdated: false,
    });
    return { status: "completed" as const, summary, closure, closureHash };
  });
}
