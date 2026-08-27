import { createHash } from "node:crypto";
import { FieldValue, Timestamp, type WriteBatch } from "firebase-admin/firestore";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { consultExpenseProvision } from "@/features/financial/lib/expense-provisions";
import { calculateFinancialObligationSummary, moneyToCents } from "./calculations";
import type { RegisterReportedPaymentInput } from "./schemas";
import type {
  ObligationPaymentAdjustment,
  ObligationPaymentAllocation,
} from "./types";

type FinancialActor = {
  uid: string;
  name?: string | null;
  email?: string | null;
};

type RawRecord = Record<string, any>;

export type MatchedBankPaymentResult = {
  obligationId: string;
  linkId: string;
  paymentId: string;
  matchedPrincipalAmountCents: number;
  matchedCashAmountCents: number;
  summary: ReturnType<typeof calculateFinancialObligationSummary>;
  expensePatch: RawRecord;
};

function safeKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function centsFromStored(value: unknown, fallbackMoney?: unknown) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  return moneyToCents(fallbackMoney);
}

function settlementAmountCentsForExpense(expense: RawRecord, actualAmountCents: number | null) {
  if (actualAmountCents == null) return null;
  const netPayableValue = moneyToCents(expense.netPayableValue);
  return netPayableValue > 0 ? netPayableValue : actualAmountCents;
}

function competenceKey(expense: RawRecord) {
  const stored = String(expense.provisionCompetence || "").trim();
  if (/^\d{4}-\d{2}$/.test(stored)) return stored;
  const value = expense.competenceDate;
  const date = value && typeof value.toDate === "function" ? value.toDate() : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function paymentAllocationFromData(data: RawRecord): ObligationPaymentAllocation {
  return {
    id: data.id,
    paymentId: data.paymentId || null,
    bankTransactionId: data.bankTransactionId || null,
    expenseId: data.expenseId || null,
    installmentId: data.installmentId || null,
    principalAmountCents: centsFromStored(data.principalAmountCents, data.principalAmount),
    cashAmountCents: centsFromStored(data.cashAmountCents, data.cashAmount),
    status: ["REPORTED", "SUGGESTED", "MATCHED", "VOIDED"].includes(data.status)
      ? data.status
      : "REPORTED",
  };
}

function paymentAdjustmentFromData(data: RawRecord): ObligationPaymentAdjustment {
  return {
    id: data.id,
    linkId: data.linkId || null,
    bankTransactionId: data.bankTransactionId || null,
    type: data.type,
    effect: data.effect,
    amountCents: centsFromStored(data.amountCents, data.amount),
    status: ["PENDING", "CLASSIFIED", "VOIDED"].includes(data.status)
      ? data.status
      : "PENDING",
  };
}

function paymentStateLabel(summary: ReturnType<typeof calculateFinancialObligationSummary>) {
  if (summary.reconciliationStatus === "PENDING_DOCUMENT") return "payment_found_pending_document";
  if (summary.reconciliationStatus === "DIVERGENT") return "paid_divergent";
  if (summary.paymentEvidenceStatus === "REPORTED" && summary.obligationStatus === "PAID") return "reported_paid";
  if (summary.obligationStatus === "PARTIALLY_PAID") return "partially_paid";
  if (summary.obligationStatus === "PAID") return "paid";
  return "open";
}

/**
 * Adds the authoritative bank evidence to an effectuation batch. A previous
 * manual report for the same expense is superseded, not counted a second time.
 */
export async function queueMatchedBankPayment(params: {
  batch: WriteBatch;
  expenseId: string;
  expense: RawRecord;
  bankTransactionId: string;
  reportedPaymentId?: string | null;
  reportedLinkId?: string | null;
  principalAmount: number;
  cashAmount: number;
  interest?: number;
  fine?: number;
  discount?: number;
  abatement?: number;
  paidAt: Timestamp;
  actor: FinancialActor;
  chargesAccountPlanId?: string | null;
  chargesAccountPlanName?: string | null;
  chargeExpenseId?: string | null;
}): Promise<MatchedBankPaymentResult> {
  const actualAmountCents = params.expense.provisionType === "forecast"
    ? null
    : moneyToCents(params.expense.totalValue);
  const settlementAmountCents = settlementAmountCentsForExpense(params.expense, actualAmountCents);
  const forecastAmountCents = params.expense.provisionedValue != null
    ? moneyToCents(params.expense.provisionedValue)
    : params.expense.provisionType === "forecast"
      ? moneyToCents(params.expense.totalValue)
      : null;
  const obligationId = String(
    params.expense.obligationId ||
    `obl_${safeKey(params.expense.reconciledProvisionId || params.expenseId)}`,
  );
  const [linksSnapshot, adjustmentsSnapshot] = await Promise.all([
    financialDbAdmin.collection("obligationPaymentLinks")
      .where("obligationId", "==", obligationId)
      .limit(500)
      .get(),
    financialDbAdmin.collection("paymentAdjustments")
      .where("obligationId", "==", obligationId)
      .limit(500)
      .get(),
  ]);
  const links = linksSnapshot.docs.map((document) => paymentAllocationFromData({
    id: document.id,
    ...document.data(),
  }));
  const adjustments = adjustmentsSnapshot.docs.map((document) => paymentAdjustmentFromData({
    id: document.id,
    ...document.data(),
  }));
  const existingBankLink = links.find(
    (link) => link.bankTransactionId === params.bankTransactionId && link.status === "MATCHED",
  );
  const reportedLinks = links.filter(
    (link) => link.expenseId === params.expenseId && link.status === "REPORTED",
  );
  const principalAmountCents = moneyToCents(params.principalAmount);
  const cashAmountCents = moneyToCents(params.cashAmount);
  const interestAmountCents = moneyToCents(params.interest);
  const fineAmountCents = moneyToCents(params.fine);
  const discountAmountCents = moneyToCents(params.discount);
  const abatementAmountCents = moneyToCents(params.abatement);
  const explicitReportedLink = params.reportedLinkId
    ? reportedLinks.find((link) => link.id === params.reportedLinkId)
    : params.reportedPaymentId
      ? reportedLinks.find((link) => link.paymentId === params.reportedPaymentId)
      : null;
  if ((params.reportedLinkId || params.reportedPaymentId) && !existingBankLink && !explicitReportedLink) {
    throw new Error("O pagamento informado selecionado não está mais disponível para conciliação.");
  }
  const amountCompatibleReportedLinks = reportedLinks.filter((link) =>
    Math.abs(link.principalAmountCents - principalAmountCents) <= 1 &&
    (
      Math.abs(link.cashAmountCents - cashAmountCents) <= 1 ||
      Math.abs(link.cashAmountCents + interestAmountCents + fineAmountCents - cashAmountCents) <= 1
    )
  );
  if (
    !existingBankLink &&
    !explicitReportedLink &&
    amountCompatibleReportedLinks.length > 1
  ) {
    throw new Error("Há mais de um pagamento informado compatível. Selecione o pagamento correto na auditoria.");
  }
  const targetLink = existingBankLink || explicitReportedLink || amountCompatibleReportedLinks[0] || null;
  const linkId = targetLink?.id || `link_${safeKey(`${obligationId}:${params.bankTransactionId}:${params.expenseId}`)}`;
  const paymentId = targetLink?.paymentId || `bank_${safeKey(`${params.bankTransactionId}:${params.expenseId}`)}`;
  const now = Timestamp.now();
  const actorPayload = { uid: params.actor.uid, name: params.actor.name || null, email: params.actor.email || null };

  const matchedAllocation: ObligationPaymentAllocation = {
    id: linkId,
    paymentId,
    bankTransactionId: params.bankTransactionId,
    expenseId: params.expenseId,
    installmentId: targetLink?.installmentId || null,
    principalAmountCents,
    cashAmountCents,
    status: "MATCHED",
  };
  const nextAllocations = links
    .filter((link) => link.id !== linkId)
    .concat(matchedAllocation);

  const supersededAdjustmentIds = new Set(
    adjustments
      .filter((adjustment) => targetLink?.status === "REPORTED" && adjustment.linkId === targetLink.id)
      .map((adjustment) => adjustment.id)
      .filter(Boolean),
  );
  for (const adjustmentId of supersededAdjustmentIds) {
    params.batch.set(financialDbAdmin.collection("paymentAdjustments").doc(adjustmentId!), {
      status: "VOIDED",
      voidReason: "SUPERSEDED_BY_BANK_EVIDENCE",
      supersededByBankTransactionId: params.bankTransactionId,
      updatedAt: now,
    }, { merge: true });
  }

  const bankAdjustments: ObligationPaymentAdjustment[] = [
    ...(interestAmountCents > 0 ? [{
      id: `adj_${safeKey(`${linkId}:${params.bankTransactionId}:interest`)}`,
      linkId,
      bankTransactionId: params.bankTransactionId,
      type: "INTEREST" as const,
      effect: "CASH_CHARGE" as const,
      amountCents: interestAmountCents,
      status: "CLASSIFIED" as const,
    }] : []),
    ...(fineAmountCents > 0 ? [{
      id: `adj_${safeKey(`${linkId}:${params.bankTransactionId}:fine`)}`,
      linkId,
      bankTransactionId: params.bankTransactionId,
      type: "FINE" as const,
      effect: "CASH_CHARGE" as const,
      amountCents: fineAmountCents,
      status: "CLASSIFIED" as const,
    }] : []),
    ...(discountAmountCents > 0 ? [{
      id: `adj_${safeKey(`${linkId}:${params.bankTransactionId}:discount`)}`,
      linkId,
      bankTransactionId: params.bankTransactionId,
      type: "DISCOUNT" as const,
      effect: "SETTLEMENT_CREDIT" as const,
      amountCents: discountAmountCents,
      status: "CLASSIFIED" as const,
    }] : []),
    ...(abatementAmountCents > 0 ? [{
      id: `adj_${safeKey(`${linkId}:${params.bankTransactionId}:abatement`)}`,
      linkId,
      bankTransactionId: params.bankTransactionId,
      type: "ABATEMENT" as const,
      effect: "SETTLEMENT_CREDIT" as const,
      amountCents: abatementAmountCents,
      status: "CLASSIFIED" as const,
    }] : []),
  ];
  const nextAdjustments = adjustments
    .map((adjustment) => supersededAdjustmentIds.has(adjustment.id)
      ? { ...adjustment, status: "VOIDED" as const }
      : adjustment)
    .concat(bankAdjustments);
  const summary = calculateFinancialObligationSummary({
    forecastAmountCents,
    actualAmountCents,
    settlementAmountCents,
    paymentAllocations: nextAllocations,
    adjustments: nextAdjustments,
  });
  if (
    settlementAmountCents != null &&
    summary.principalSettledAmountCents + summary.settlementCreditsAmountCents > settlementAmountCents + 1
  ) {
    throw new Error("A conciliação excede o saldo da obrigação. Revise o pagamento informado ou a despesa selecionada.");
  }

  params.batch.set(financialDbAdmin.collection("financialObligations").doc(obligationId), {
    id: obligationId,
    seriesKey: params.expense.provisionSeriesKey || null,
    competenceKey: competenceKey(params.expense),
    obligationType: params.expense.obligationType || "EXPENSE",
    sourceType: params.expense.cardStatementId ? "CARD_STATEMENT" : "EXPENSE",
    sourceId: params.expense.cardStatementId || params.expenseId,
    supplierName: params.expense.supplier || null,
    status: summary.obligationStatus,
    reconciliationStatus: summary.reconciliationStatus,
    summary,
    updatedAt: now,
  }, { merge: true });
  params.batch.set(financialDbAdmin.collection("obligationPaymentLinks").doc(linkId), {
    ...matchedAllocation,
    obligationId,
    origin: "BANK_STATEMENT",
    confidence: 1,
    previousStatus: targetLink?.status || null,
    originalReportedPrincipalAmountCents: targetLink?.status === "REPORTED" ? targetLink.principalAmountCents : null,
    originalReportedCashAmountCents: targetLink?.status === "REPORTED" ? targetLink.cashAmountCents : null,
    confirmedBy: actorPayload,
    confirmedAt: now,
    ...(targetLink ? {} : { createdAt: now }),
    updatedAt: now,
  }, { merge: true });
  params.batch.set(financialDbAdmin.collection("payments").doc(paymentId), {
    expenseId: params.expenseId,
    obligationId,
    linkId,
    paidAt: params.paidAt,
    description: params.expense.description || "Pagamento confirmado",
    supplier: params.expense.supplier || null,
    baseValue: principalAmountCents / 100,
    principalAmountCents,
    interest: interestAmountCents / 100,
    fine: fineAmountCents / 100,
    discount: discountAmountCents / 100,
    abatement: abatementAmountCents / 100,
    charges: (interestAmountCents + fineAmountCents) / 100,
    chargesAmountCents: interestAmountCents + fineAmountCents,
    totalPaid: cashAmountCents / 100,
    cashAmountCents,
    bankTransactionId: params.bankTransactionId,
    evidenceSource: "BANK_STATEMENT",
    status: "MATCHED",
    reconciliationStatus: summary.reconciliationStatus,
    settlementSummary: summary,
    confirmedBy: actorPayload,
    confirmedAt: now,
    ...(targetLink?.paymentId ? {} : { createdAt: now }),
    updatedAt: now,
  }, { merge: true });
  for (const adjustment of bankAdjustments) {
    const isCashCharge = adjustment.effect === "CASH_CHARGE";
    params.batch.set(financialDbAdmin.collection("paymentAdjustments").doc(adjustment.id!), {
      ...adjustment,
      obligationId,
      paymentId,
      expenseId: params.expenseId,
      amount: adjustment.amountCents / 100,
      reason: "Encargo identificado na conciliação do extrato.",
      responsibility: "UNDETERMINED",
      accountPlanId: isCashCharge ? params.chargesAccountPlanId || null : null,
      accountPlanName: isCashCharge ? params.chargesAccountPlanName || null : null,
      chargeExpenseId: isCashCharge ? params.chargeExpenseId || null : null,
      accountingStatus: isCashCharge
        ? params.chargesAccountPlanId ? "READY" : "PENDING_CLASSIFICATION"
        : "NOT_APPLICABLE",
      classifiedBy: actorPayload,
      classifiedAt: now,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });
  }
  params.batch.set(financialDbAdmin.collection("financialObligations").doc(obligationId).collection("events").doc(`bank_${safeKey(params.bankTransactionId)}`), {
    type: "BANK_PAYMENT_MATCHED",
    obligationId,
    expenseId: params.expenseId,
    paymentId,
    linkId,
    bankTransactionId: params.bankTransactionId,
    principalAmountCents,
    cashAmountCents,
    actor: actorPayload,
    occurredAt: now,
  }, { merge: true });
  const expensePatch = {
    obligationId,
    status: summary.obligationStatus === "PAID" ? "paid" : summary.obligationStatus === "PARTIALLY_PAID" ? "partially_paid" : "pending",
    paymentState: paymentStateLabel(summary),
    settlementSummary: summary,
    updatedAt: now,
  };

  return {
    obligationId,
    linkId,
    paymentId,
    matchedPrincipalAmountCents: principalAmountCents,
    matchedCashAmountCents: cashAmountCents,
    summary,
    expensePatch,
  };
}

export async function queueReopenedBankPayment(params: {
  batch: WriteBatch;
  expenseId: string;
  expense: RawRecord;
  bankTransactionId: string;
  actor: FinancialActor;
}): Promise<{ summary: ReturnType<typeof calculateFinancialObligationSummary>; expensePatch: RawRecord } | null> {
  const bankLinksSnapshot = await financialDbAdmin.collection("obligationPaymentLinks")
    .where("bankTransactionId", "==", params.bankTransactionId)
    .limit(100)
    .get();
  const bankLinks = bankLinksSnapshot.docs
    .map((document): RawRecord => ({ id: document.id, ...document.data() }))
    .filter((link) => link.expenseId === params.expenseId && link.status === "MATCHED");
  if (bankLinks.length === 0) return null;
  const obligationId = String(bankLinks[0].obligationId || params.expense.obligationId || "");
  if (!obligationId) return null;

  const [linksSnapshot, adjustmentsSnapshot] = await Promise.all([
    financialDbAdmin.collection("obligationPaymentLinks").where("obligationId", "==", obligationId).limit(500).get(),
    financialDbAdmin.collection("paymentAdjustments").where("obligationId", "==", obligationId).limit(500).get(),
  ]);
  const allocations = linksSnapshot.docs.map((document) => paymentAllocationFromData({ id: document.id, ...document.data() }));
  const adjustmentsWithData = adjustmentsSnapshot.docs.map((document) => ({
    data: { id: document.id, ...document.data() } as RawRecord,
    adjustment: paymentAdjustmentFromData({ id: document.id, ...document.data() }),
  }));
  const bankLinkIds = new Set(bankLinks.map((link) => link.id));
  const restoredPaymentDates: Timestamp[] = [];

  for (const link of bankLinks) {
    const restoreReported = link.previousStatus === "REPORTED";
    const originalPrincipalAmountCents = centsFromStored(link.originalReportedPrincipalAmountCents);
    const originalCashAmountCents = centsFromStored(link.originalReportedCashAmountCents);
    params.batch.set(financialDbAdmin.collection("obligationPaymentLinks").doc(link.id), restoreReported ? {
      status: "REPORTED",
      bankTransactionId: null,
      principalAmountCents: originalPrincipalAmountCents,
      cashAmountCents: originalCashAmountCents,
      reopenedBankTransactionId: params.bankTransactionId,
      confirmedAt: FieldValue.delete(),
      confirmedBy: FieldValue.delete(),
      updatedAt: Timestamp.now(),
    } : {
      status: "VOIDED",
      voidReason: "BANK_AUDIT_REOPENED",
      reopenedBankTransactionId: params.bankTransactionId,
      updatedAt: Timestamp.now(),
    }, { merge: true });
    if (link.paymentId) {
      const paymentRef = financialDbAdmin.collection("payments").doc(String(link.paymentId));
      const paymentSnapshot = await paymentRef.get();
      const payment = paymentSnapshot.data() ?? {};
      if (restoreReported && payment.paidAt instanceof Timestamp) restoredPaymentDates.push(payment.paidAt);
      params.batch.set(paymentRef, restoreReported ? {
        status: "REPORTED",
        reconciliationStatus: "NOT_FOUND",
        evidenceSource: "MANUAL",
        bankTransactionId: FieldValue.delete(),
        baseValue: originalPrincipalAmountCents / 100,
        principalAmountCents: originalPrincipalAmountCents,
        totalPaid: originalCashAmountCents / 100,
        cashAmountCents: originalCashAmountCents,
        confirmedAt: FieldValue.delete(),
        confirmedBy: FieldValue.delete(),
        updatedAt: Timestamp.now(),
      } : {
        status: "REVERSED",
        reconciliationStatus: "NOT_FOUND",
        reversedBankTransactionId: params.bankTransactionId,
        updatedAt: Timestamp.now(),
      }, { merge: true });
    }
  }

  for (const { data } of adjustmentsWithData) {
    if (data.bankTransactionId === params.bankTransactionId && data.status !== "VOIDED") {
      params.batch.set(financialDbAdmin.collection("paymentAdjustments").doc(data.id), {
        status: "VOIDED",
        voidReason: "BANK_AUDIT_REOPENED",
        updatedAt: Timestamp.now(),
      }, { merge: true });
    } else if (data.supersededByBankTransactionId === params.bankTransactionId && data.status === "VOIDED") {
      params.batch.set(financialDbAdmin.collection("paymentAdjustments").doc(data.id), {
        status: "CLASSIFIED",
        voidReason: FieldValue.delete(),
        supersededByBankTransactionId: FieldValue.delete(),
        updatedAt: Timestamp.now(),
      }, { merge: true });
    }
  }

  const nextAllocations = allocations.map((allocation) => {
    if (!bankLinkIds.has(allocation.id!)) return allocation;
    const source = bankLinks.find((link) => link.id === allocation.id)!;
    return source.previousStatus === "REPORTED" ? {
      ...allocation,
      status: "REPORTED" as const,
      bankTransactionId: null,
      principalAmountCents: centsFromStored(source.originalReportedPrincipalAmountCents),
      cashAmountCents: centsFromStored(source.originalReportedCashAmountCents),
    } : { ...allocation, status: "VOIDED" as const };
  });
  const nextAdjustments = adjustmentsWithData.map(({ data, adjustment }) => {
    if (data.bankTransactionId === params.bankTransactionId) return { ...adjustment, status: "VOIDED" as const };
    if (data.supersededByBankTransactionId === params.bankTransactionId && adjustment.status === "VOIDED") {
      return { ...adjustment, status: "CLASSIFIED" as const };
    }
    return adjustment;
  });
  const actualAmountCents = params.expense.provisionType === "forecast" ? null : moneyToCents(params.expense.totalValue);
  const settlementAmountCents = settlementAmountCentsForExpense(params.expense, actualAmountCents);
  const forecastAmountCents = params.expense.provisionedValue != null
    ? moneyToCents(params.expense.provisionedValue)
    : params.expense.provisionType === "forecast" ? moneyToCents(params.expense.totalValue) : null;
  const summary = calculateFinancialObligationSummary({
    forecastAmountCents,
    actualAmountCents,
    settlementAmountCents,
    paymentAllocations: nextAllocations,
    adjustments: nextAdjustments,
  });
  const now = Timestamp.now();
  params.batch.set(financialDbAdmin.collection("financialObligations").doc(obligationId), {
    status: summary.obligationStatus,
    reconciliationStatus: summary.reconciliationStatus,
    summary,
    updatedAt: now,
  }, { merge: true });
  params.batch.set(financialDbAdmin.collection("financialObligations").doc(obligationId).collection("events").doc(`reopen_${safeKey(params.bankTransactionId)}`), {
    type: "BANK_PAYMENT_REOPENED",
    obligationId,
    expenseId: params.expenseId,
    bankTransactionId: params.bankTransactionId,
    actor: { uid: params.actor.uid, name: params.actor.name || null, email: params.actor.email || null },
    occurredAt: now,
  }, { merge: true });

  const expensePatch: RawRecord = {
    settlementSummary: summary,
    paymentState: paymentStateLabel(summary),
    status: summary.obligationStatus === "PAID" ? "paid" : summary.obligationStatus === "PARTIALLY_PAID" ? "partially_paid" : "pending",
    updatedAt: now,
  };
  if (restoredPaymentDates[0]) expensePatch.paidAt = restoredPaymentDates[0];
  return { summary, expensePatch };
}

export async function registerReportedPayment(
  expenseId: string,
  input: RegisterReportedPaymentInput,
  actor: FinancialActor,
) {
  const expenseRef = financialDbAdmin.collection("expenses").doc(expenseId);
  const paymentId = `manual_${safeKey(`${expenseId}:${input.idempotencyKey}`)}`;
  const paymentRef = financialDbAdmin.collection("payments").doc(paymentId);

  return financialDbAdmin.runTransaction(async (transaction) => {
    const expenseSnapshot = await transaction.get(expenseRef);
    if (!expenseSnapshot.exists) throw new Error("Despesa não encontrada.");
    const expense = expenseSnapshot.data() ?? {};
    if (["draft", "cancelled", "reconciled"].includes(String(expense.status))) {
      throw new Error("Esta despesa não pode receber um pagamento manual.");
    }

    const existingPayment = await transaction.get(paymentRef);
    if (existingPayment.exists) {
      return {
        payment: { id: existingPayment.id, ...existingPayment.data() },
        summary: existingPayment.data()?.settlementSummary ?? expense.settlementSummary ?? null,
        idempotent: true,
      };
    }

    let forecastSnapshot: FirebaseFirestore.DocumentSnapshot | null = null;
    const reconciledForecastId = typeof expense.reconciledProvisionId === "string" && expense.reconciledProvisionId
      ? expense.reconciledProvisionId
      : null;
    if (reconciledForecastId && input.forecastExpenseId && reconciledForecastId !== input.forecastExpenseId) {
      throw new Error("A despesa já está relacionada a outra previsão.");
    }
    const forecastId = reconciledForecastId || input.forecastExpenseId || null;
    if (forecastId) {
      forecastSnapshot = await transaction.get(financialDbAdmin.collection("expenses").doc(forecastId));
    }
    const forecast = forecastSnapshot?.data() ?? null;
    if (input.forecastExpenseId) {
      if (!forecastSnapshot?.exists || forecast?.provisionType !== "forecast") {
        throw new Error("A previsão informada não foi encontrada.");
      }
      const provisionConsultation = consultExpenseProvision(
        { id: expenseId, ...expense },
        [{ id: forecastSnapshot.id, ...forecast }],
      );
      if (!["matched", "already_reconciled"].includes(provisionConsultation.status)) {
        throw new Error("A previsão informada não corresponde à série e à competência da despesa.");
      }
    }
    const rootExpenseId = forecastSnapshot?.exists ? forecastSnapshot.id : expenseId;
    const obligationId = String(expense.obligationId || forecast?.obligationId || `obl_${safeKey(rootExpenseId)}`);
    const obligationRef = financialDbAdmin.collection("financialObligations").doc(obligationId);
    const linkId = `link_${safeKey(paymentId)}`;
    const linkRef = financialDbAdmin.collection("obligationPaymentLinks").doc(linkId);
    const obligationSnapshot = await transaction.get(obligationRef);
    const linksQuery = financialDbAdmin.collection("obligationPaymentLinks")
      .where("obligationId", "==", obligationId)
      .limit(500);
    const adjustmentsQuery = financialDbAdmin.collection("paymentAdjustments")
      .where("obligationId", "==", obligationId)
      .limit(500);
    const [linksSnapshot, adjustmentsSnapshot] = await Promise.all([
      transaction.get(linksQuery),
      transaction.get(adjustmentsQuery),
    ]);
    const chargesAccountSnapshot = input.chargesAccountPlanId
      ? await transaction.get(financialDbAdmin.collection("accounts").doc(input.chargesAccountPlanId))
      : null;
    const chargesAccount = chargesAccountSnapshot?.data() ?? null;
    if (input.chargesAccountPlanId && (
      !chargesAccountSnapshot?.exists || chargesAccount?.active === false || chargesAccount?.isGroup === true
    )) {
      throw new Error("O plano de contas dos encargos é inválido.");
    }

    const existingAllocations = linksSnapshot.docs.map((document) => paymentAllocationFromData({
      id: document.id,
      ...document.data(),
    }));
    const existingAdjustments = adjustmentsSnapshot.docs.map((document) => paymentAdjustmentFromData({
      id: document.id,
      ...document.data(),
    }));
    const interestCents = moneyToCents(input.interest);
    const fineCents = moneyToCents(input.fine);
    const chargesCents = interestCents + fineCents;
    const cashAmountCents = input.splits.reduce((total, split) => total + moneyToCents(split.amount), 0);
    if (cashAmountCents <= chargesCents) {
      throw new Error("O pagamento precisa possuir valor de principal além dos encargos.");
    }
    const principalAmountCents = cashAmountCents - chargesCents;
    const actualAmountCents = expense.provisionType === "forecast"
      ? null
      : moneyToCents(expense.totalValue);
    const settlementAmountCents = settlementAmountCentsForExpense(expense, actualAmountCents);
    const forecastAmountCents = forecast
      ? moneyToCents(forecast.totalValue)
      : expense.provisionedValue != null
        ? moneyToCents(expense.provisionedValue)
        : expense.provisionType === "forecast"
          ? moneyToCents(expense.totalValue)
          : null;
    const currentSummary = calculateFinancialObligationSummary({
      forecastAmountCents,
      actualAmountCents,
      settlementAmountCents,
      paymentAllocations: existingAllocations,
      adjustments: existingAdjustments,
    });
    if (currentSummary.balanceAmountCents === 0) {
      throw new Error("A obrigação já está integralmente liquidada.");
    }
    if (
      currentSummary.balanceAmountCents != null
      && principalAmountCents > currentSummary.balanceAmountCents + 1
    ) {
      throw new Error("O principal informado excede o saldo da obrigação.");
    }

    const allocation: ObligationPaymentAllocation = {
      id: linkId,
      paymentId,
      bankTransactionId: null,
      expenseId,
      installmentId: null,
      principalAmountCents,
      cashAmountCents,
      status: "REPORTED",
    };
    const newAdjustments: ObligationPaymentAdjustment[] = [
      ...(interestCents > 0 ? [{
        id: `adj_${safeKey(`${paymentId}:interest`)}`,
        linkId,
        bankTransactionId: null,
        type: "INTEREST" as const,
        effect: "CASH_CHARGE" as const,
        amountCents: interestCents,
        status: "CLASSIFIED" as const,
      }] : []),
      ...(fineCents > 0 ? [{
        id: `adj_${safeKey(`${paymentId}:fine`)}`,
        linkId,
        bankTransactionId: null,
        type: "FINE" as const,
        effect: "CASH_CHARGE" as const,
        amountCents: fineCents,
        status: "CLASSIFIED" as const,
      }] : []),
    ];
    const summary = calculateFinancialObligationSummary({
      forecastAmountCents,
      actualAmountCents,
      settlementAmountCents,
      paymentAllocations: [...existingAllocations, allocation],
      adjustments: [...existingAdjustments, ...newAdjustments],
    });
    const now = Timestamp.now();
    const paidAt = Timestamp.fromDate(new Date(input.paidAt));
    const manualChargeExpenseId = chargesCents > 0 ? `charge_${safeKey(paymentId)}` : null;
    const actorPayload = {
      uid: actor.uid,
      name: actor.name || null,
      email: actor.email || null,
    };
    const obligationPayload = {
      id: obligationId,
      seriesKey: expense.provisionSeriesKey || forecast?.provisionSeriesKey || null,
      competenceKey: competenceKey(expense) || (forecast ? competenceKey(forecast) : null),
      deduplicationKey: expense.provisionSeriesKey && competenceKey(expense)
        ? `${expense.provisionSeriesKey}:${competenceKey(expense)}`
        : null,
      obligationType: expense.obligationType || "EXPENSE",
      sourceType: expense.cardStatementId ? "CARD_STATEMENT" : "EXPENSE",
      sourceId: expense.cardStatementId || expenseId,
      supplierName: expense.supplier || null,
      status: summary.obligationStatus,
      reconciliationStatus: summary.reconciliationStatus,
      summary,
      updatedAt: now,
      ...(obligationSnapshot.exists ? {} : { createdAt: now, createdBy: actorPayload }),
    };

    transaction.set(obligationRef, obligationPayload, { merge: true });
    transaction.set(paymentRef, {
      expenseId,
      obligationId,
      linkId,
      description: expense.description || "Pagamento informado",
      supplier: expense.supplier || null,
      paidAt,
      baseValue: principalAmountCents / 100,
      principalAmountCents,
      interest: interestCents / 100,
      fine: fineCents / 100,
      charges: chargesCents / 100,
      chargesAmountCents: chargesCents,
      chargesAccountPlanId: input.chargesAccountPlanId || null,
      chargesAccountPlanName: chargesAccount?.name || input.chargesAccountPlanName || null,
      manualChargeExpenseId,
      totalPaid: cashAmountCents / 100,
      cashAmountCents,
      splits: input.splits,
      notes: input.notes,
      evidenceSource: "MANUAL",
      status: "REPORTED",
      reconciliationStatus: "NOT_FOUND",
      settlementSummary: summary,
      createdBy: actor.uid,
      createdByName: actor.name || null,
      createdAt: now,
      updatedAt: now,
    });
    transaction.set(linkRef, {
      ...allocation,
      obligationId,
      origin: "MANUAL",
      confidence: 1,
      confirmedBy: actorPayload,
      confirmedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    for (const adjustment of newAdjustments) {
      const adjustmentRef = financialDbAdmin.collection("paymentAdjustments").doc(adjustment.id!);
      transaction.set(adjustmentRef, {
        ...adjustment,
        obligationId,
        paymentId,
        expenseId,
        amount: adjustment.amountCents / 100,
        reason: input.notes || null,
        responsibility: "UNDETERMINED",
        accountPlanId: input.chargesAccountPlanId || null,
        accountPlanName: input.chargesAccountPlanName || null,
        chargeExpenseId: manualChargeExpenseId,
        accountingStatus: input.chargesAccountPlanId ? "READY" : "PENDING_CLASSIFICATION",
        classifiedBy: actorPayload,
        classifiedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (manualChargeExpenseId) {
      transaction.set(financialDbAdmin.collection("expenses").doc(manualChargeExpenseId), {
        description: `Juros e multa | ${expense.description || "Despesa"}`,
        accountPlan: input.chargesAccountPlanId,
        accountId: input.chargesAccountPlanId,
        accountPlanId: input.chargesAccountPlanId,
        accountPlanName: chargesAccount?.name || input.chargesAccountPlanName || "Encargos financeiros",
        totalValue: chargesCents / 100,
        supplier: expense.supplier || null,
        competenceDate: paidAt,
        dueDate: paidAt,
        paidAt,
        status: "paid",
        paymentState: "reported_paid",
        type: "encargo",
        isPaymentAdjustment: true,
        originExpenseId: expenseId,
        obligationId,
        paymentId,
        evidenceSource: "MANUAL",
        interest: interestCents / 100,
        fine: fineCents / 100,
        isApportioned: expense.isApportioned === true,
        resultCenter: expense.resultCenter || null,
        resultCenterId: expense.resultCenterId || null,
        resultCenterName: expense.resultCenterName || expense.resultCenter || null,
        apportionments: expense.apportionments || null,
        createdBy: actor.uid,
        createdAt: now,
        updatedAt: now,
      }, { merge: true });
    }
    transaction.set(obligationRef.collection("events").doc(`payment_${safeKey(paymentId)}`), {
      type: "PAYMENT_REPORTED",
      obligationId,
      expenseId,
      paymentId,
      linkId,
      principalAmountCents,
      cashAmountCents,
      chargesAmountCents: chargesCents,
      actor: actorPayload,
      occurredAt: now,
    });
    const expenseStatus = summary.obligationStatus === "PAID"
      ? "paid"
      : summary.obligationStatus === "PARTIALLY_PAID"
        ? "partially_paid"
        : expense.status;
    transaction.set(expenseRef, {
      obligationId,
      status: expenseStatus,
      paymentState: paymentStateLabel(summary),
      settlementSummary: summary,
      lastPaymentAt: paidAt,
      lastReportedPaymentId: paymentId,
      manualChargesExpenseId: manualChargeExpenseId,
      updatedAt: now,
      ...(summary.obligationStatus === "PAID" ? { paidAt } : {}),
      ...(forecastSnapshot?.exists ? {
        reconciledProvisionId: forecastSnapshot.id,
        provisionReconciliationStatus: "reconciled",
        provisionedValue: moneyToCents(forecast?.totalValue) / 100,
        provisionVariance: actualAmountCents == null
          ? null
          : (actualAmountCents - moneyToCents(forecast?.totalValue)) / 100,
        provisionReconciledAt: now,
        provisionReconciledBy: actor.uid,
      } : {}),
    }, { merge: true });
    if (forecastSnapshot?.exists) {
      transaction.set(forecastSnapshot.ref, {
        obligationId,
        status: "reconciled",
        replacedByExpenseId: expenseId,
        actualValue: actualAmountCents == null ? null : actualAmountCents / 100,
        provisionVariance: actualAmountCents == null
          ? null
          : (actualAmountCents - moneyToCents(forecast?.totalValue)) / 100,
        provisionReconciliationStatus: "reconciled",
        provisionReconciledAt: now,
        provisionReconciledBy: actor.uid,
        updatedAt: now,
      }, { merge: true });
    }

    return {
      payment: { id: paymentId, obligationId, linkId, status: "REPORTED", paidAt: input.paidAt },
      summary,
      idempotent: false,
    };
  });
}
