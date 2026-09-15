import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { serializeFinancialValue } from "@/features/financial/lib/server-access";
import { salesReconciliationPeriodId } from "@/features/financial/sales-reconciliation/identity.server";
import { cashDifferenceEffects, type CashDifferenceClassification, type CashDifferenceDecision } from "./types";

export class CashDifferenceError extends Error {
  constructor(readonly code: "NOT_FOUND" | "ACCESS" | "STATE" | "ACCOUNT" | "LIMIT", message: string) {
    super(message);
    this.name = "CashDifferenceError";
  }
}

function decisionId(workspaceId: string, closureId: string) {
  return `cash_difference_${createHash("sha256").update(`${workspaceId}|${closureId}`).digest("hex").slice(0, 40)}`;
}

function lossExpenseId(decisionDocumentId: string) {
  return `cash_loss_${createHash("sha256").update(decisionDocumentId).digest("hex").slice(0, 40)}`;
}

function validLossAccount(data: Record<string, unknown>) {
  const name = String(data.name ?? "").toLocaleLowerCase("pt-BR");
  return data.active !== false
    && data.isGroup !== true
    && data.is_dre_account !== false
    && data.dre_position === "despesas_operacionais"
    && name.includes("caixa")
    && (name.includes("quebra") || name.includes("diferen"));
}

export async function listCashClosureDifferences(input: {
  workspaceId: string;
  kioskId: string;
  period: string;
}) {
  const [year, month] = input.period.split("-").map(Number);
  const maximumDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const snapshot = await financialDbAdmin.collection("cashClosures")
    .where("workspaceId", "==", input.workspaceId)
    .where("kioskId", "==", input.kioskId)
    .where("year", "==", year)
    .where("month", "==", month)
    .orderBy("date", "desc")
    .limit(maximumDays + 1)
    .get();
  if (snapshot.size > maximumDays) throw new CashDifferenceError("LIMIT", "Existe mais de um fechamento para o mesmo dia.");
  const closures = snapshot.docs.filter((document) => Number(document.data().finalizedDifferenceTotalCents ?? 0) !== 0);
  const decisions = closures.length > 0
    ? await financialDbAdmin.getAll(...closures.map((closure) => financialDbAdmin.collection("cashClosureDifferenceDecisions").doc(decisionId(input.workspaceId, closure.id))))
    : [];
  const decisionByClosureId = new Map(decisions.flatMap((document) => document.exists
    ? [[String(document.data()?.closureId), { id: document.id, ...document.data() } as CashDifferenceDecision] as const]
    : []));
  return serializeFinancialValue({
    differences: closures.map((document) => {
      const data = document.data();
      const decision = decisionByClosureId.get(document.id) ?? null;
      return {
        closureId: document.id,
        kioskId: data.kioskId,
        kioskName: data.kioskName,
        date: data.date,
        status: data.status,
        sourceHash: data.sourceHash,
        expectedCashCents: Number(data.expectedCashCents ?? 0),
        countedCashCents: Number(data.finalizedCountedCashCents ?? 0),
        differenceAmountCents: Number(data.finalizedDifferenceTotalCents ?? 0),
        decision,
        decisionStale: Boolean(decision && decision.sourceHash !== data.sourceHash),
      };
    }),
    stats: { closureDocuments: snapshot.size, decisionDocuments: decisions.length },
  });
}

export async function decideCashClosureDifference(input: {
  workspaceId: string;
  closureId: string;
  classification: CashDifferenceClassification;
  accountPlanId?: string | null;
  reason: string;
  actor: { id: string; name: string | null; email: string | null };
  canAccessKiosk: (kioskId: string) => boolean;
}) {
  const closureRef = financialDbAdmin.collection("cashClosures").doc(input.closureId);
  const decisionDocumentId = decisionId(input.workspaceId, input.closureId);
  const decisionRef = financialDbAdmin.collection("cashClosureDifferenceDecisions").doc(decisionDocumentId);
  const expenseRef = financialDbAdmin.collection("expenses").doc(lossExpenseId(decisionDocumentId));
  return serializeFinancialValue(await financialDbAdmin.runTransaction(async (transaction) => {
    const closureSnapshot = await transaction.get(closureRef);
    if (!closureSnapshot.exists || closureSnapshot.data()?.workspaceId !== input.workspaceId) {
      throw new CashDifferenceError("NOT_FOUND", "O fechamento de caixa não foi encontrado.");
    }
    const closure = closureSnapshot.data() ?? {};
    const kioskId = String(closure.kioskId ?? "");
    if (!kioskId || !input.canAccessKiosk(kioskId)) throw new CashDifferenceError("ACCESS", "A unidade está fora do seu escopo.");
    if (closure.status !== "approved") throw new CashDifferenceError("STATE", "A diferença só pode ser classificada depois da aprovação do fechamento.");
    const differenceAmountCents = Number(closure.finalizedDifferenceTotalCents ?? 0);
    let effects: ReturnType<typeof cashDifferenceEffects>;
    try {
      effects = cashDifferenceEffects({ differenceAmountCents, classification: input.classification });
    } catch (cause) {
      throw new CashDifferenceError("STATE", cause instanceof Error ? cause.message : "A classificação é incompatível com a diferença.");
    }
    const period = `${closure.year}-${String(closure.month).padStart(2, "0")}`;
    const periodId = salesReconciliationPeriodId({ workspaceId: input.workspaceId, kioskId, period });
    const revenueRef = financialDbAdmin.collection("revenueMonthlySummaries").doc(periodId);
    const accountRef = input.accountPlanId ? financialDbAdmin.collection("accounts").doc(input.accountPlanId) : null;
    const [decisionSnapshot, revenueSnapshot, accountSnapshot] = await Promise.all([
      transaction.get(decisionRef),
      transaction.get(revenueRef),
      accountRef ? transaction.get(accountRef) : Promise.resolve(null),
    ]);
    const previous = decisionSnapshot.data() as CashDifferenceDecision | undefined;
    const previousRevenueAdjustment = Number(previous?.revenueAdjustmentCents ?? 0);
    if (effects.expenseAmountCents > 0 && (!accountSnapshot?.exists || !validLossAccount(accountSnapshot.data() ?? {}))) {
      throw new CashDifferenceError("ACCOUNT", "Selecione a conta ativa “Quebras e diferenças de caixa” em despesas operacionais.");
    }
    if ((effects.revenueAdjustmentCents !== 0 || previousRevenueAdjustment !== 0) && !revenueSnapshot.exists) {
      throw new CashDifferenceError("STATE", "A competência de receita precisa ser construída antes do ajuste por venda não registrada.");
    }
    const now = Timestamp.now();
    const accountName = accountSnapshot?.exists ? String(accountSnapshot.data()?.name || input.accountPlanId) : null;
    const nextDecision: CashDifferenceDecision = {
      id: decisionDocumentId,
      workspaceId: input.workspaceId,
      closureId: input.closureId,
      kioskId,
      kioskName: String(closure.kioskName || kioskId),
      period,
      closureDate: String(closure.date),
      sourceHash: String(closure.sourceHash || ""),
      differenceAmountCents,
      classification: input.classification,
      reason: input.reason,
      accountPlanId: effects.expenseAmountCents > 0 ? input.accountPlanId ?? null : null,
      accountPlanName: effects.expenseAmountCents > 0 ? accountName : null,
      revenueAdjustmentCents: effects.revenueAdjustmentCents,
      expenseAmountCents: effects.expenseAmountCents,
      expenseId: effects.expenseAmountCents > 0 ? expenseRef.id : null,
      actor: input.actor,
      decidedAt: now,
    };
    transaction.set(decisionRef, { ...nextDecision, createdAt: decisionSnapshot.data()?.createdAt ?? now, updatedAt: now });
    transaction.set(decisionRef.collection("events").doc(randomUUID()), {
      previous: previous ?? null,
      decision: nextDecision,
      actor: input.actor,
      reason: input.reason,
      createdAt: now,
    });
    if (previousRevenueAdjustment !== effects.revenueAdjustmentCents) {
      transaction.set(revenueRef, {
        cashRevenueAdjustmentCents: Number(revenueSnapshot.data()?.cashRevenueAdjustmentCents ?? 0)
          - previousRevenueAdjustment
          + effects.revenueAdjustmentCents,
        updatedAt: now,
      }, { merge: true });
    }
    if (effects.expenseAmountCents > 0) {
      transaction.set(expenseRef, {
        workspaceId: input.workspaceId,
        sourceType: "cash_closure_difference",
        sourceId: input.closureId,
        cashClosureDifferenceDecisionId: decisionDocumentId,
        cashEffectAlreadyRealized: true,
        createsBankingObligation: false,
        status: "paid",
        provisionType: "actual",
        accountingContractVersion: 1,
        competenceMonth: period,
        competenceDate: Timestamp.fromDate(new Date(`${period}-01T12:00:00.000Z`)),
        totalValue: effects.expenseAmountCents / 100,
        accountId: input.accountPlanId,
        accountPlan: input.accountPlanId,
        accountPlanName: accountName,
        hasAccountAllocations: false,
        accountAllocations: [],
        hasPersonAllocations: false,
        personAllocations: [],
        isApportioned: false,
        resultCenter: kioskId,
        description: `Perda operacional de caixa em ${String(closure.date)}`,
        supplier: "Ajuste de fechamento de caixa",
        createdAt: now,
        createdBy: input.actor.id,
        updatedAt: now,
        updatedBy: input.actor.id,
      });
    } else if (previous?.expenseId) {
      transaction.set(expenseRef, {
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: input.actor,
        cancellationReason: `Classificação substituída: ${input.reason}`,
        updatedAt: now,
      }, { merge: true });
    }
    return { decision: nextDecision };
  }));
}
