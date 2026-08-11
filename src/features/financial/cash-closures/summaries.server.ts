import "server-only";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { CASH_CLOSURE_TIMEZONE } from "./date";
import { withPdvAutomaticClosureTotals } from "./persistence";
import type { CashClosure, CashClosureMonthlySummary, CashClosureUnitSummary } from "./types";

const MONTHLY = "cashClosureMonthlySummaries";
const UNITS = "cashClosureUnitSummaries";

function currentPeriod() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CASH_CLOSURE_TIMEZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
  };
}

function maxString(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => !!value).sort().at(-1) ?? null;
}

function summaryFromClosures(input: {
  id: string;
  closures: CashClosure[];
  workspaceId: string;
  kioskId: string;
  kioskName: string;
  pdvFilialId: string;
  year: number;
  month: number;
  now: string;
}): CashClosureMonthlySummary {
  const closures = input.closures.map(withPdvAutomaticClosureTotals);
  const approvedClosures = closures.filter((closure) => closure.status === "approved");
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    kioskId: input.kioskId,
    kioskName: input.kioskName,
    pdvFilialId: input.pdvFilialId,
    year: input.year,
    month: input.month,
    closureCount: closures.length,
    pendingCount: closures.filter((closure) => ["draft", "pending_review", "reopened"].includes(closure.status)).length,
    divergentCount: approvedClosures.filter((closure) => closure.divergentLineCount > 0).length,
    approvedCount: approvedClosures.length,
    syncErrorCount: closures.filter((closure) => closure.status === "sync_error" || !!closure.syncError).length,
    expectedTotalCents: closures.reduce((total, closure) => total + closure.expectedTotalCents, 0),
    countedTotalCents: approvedClosures.reduce((total, closure) => total + closure.countedTotalCents, 0),
    differenceTotalCents: approvedClosures.reduce((total, closure) => total + closure.differenceTotalCents, 0),
    countedCashCents: approvedClosures.reduce((total, closure) => total + closure.countedCashCents, 0),
    allocatedCashCents: closures
      .filter((closure) => ["allocated", "issued", "paid", "adjusted"].includes(closure.cashDeposit.status))
      .reduce((total, closure) => total + closure.cashDeposit.eligibleCents, 0),
    issuedCashCents: closures
      .filter((closure) => ["issued", "paid"].includes(closure.cashDeposit.status))
      .reduce((total, closure) => total + closure.cashDeposit.eligibleCents, 0),
    paidCashCents: closures
      .filter((closure) => closure.cashDeposit.status === "paid")
      .reduce((total, closure) => total + closure.cashDeposit.eligibleCents, 0),
    lastSyncedAt: maxString(closures.map((closure) => closure.syncedAt)),
    lastApprovedDate: maxString(
      closures.filter((closure) => closure.status === "approved").map((closure) => closure.date),
    ),
    updatedAt: input.now,
  };
}

async function closuresForMonth(workspaceId: string, kioskId: string, year: number, month: number) {
  const snapshot = await financialDbAdmin
    .collection("cashClosures")
    .where("workspaceId", "==", workspaceId)
    .where("kioskId", "==", kioskId)
    .where("year", "==", year)
    .where("month", "==", month)
    .get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as CashClosure));
}

export async function refreshCashClosureSummaries(closure: CashClosure) {
  const now = new Date().toISOString();
  const monthlyClosures = await closuresForMonth(
    closure.workspaceId,
    closure.kioskId,
    closure.year,
    closure.month,
  );
  const monthlyId = `${closure.workspaceId}_${closure.kioskId}_${closure.year}_${String(closure.month).padStart(2, "0")}`;
  const monthly = summaryFromClosures({
    id: monthlyId,
    closures: monthlyClosures,
    workspaceId: closure.workspaceId,
    kioskId: closure.kioskId,
    kioskName: closure.kioskName,
    pdvFilialId: closure.pdvFilialId,
    year: closure.year,
    month: closure.month,
    now,
  });
  const batch = financialDbAdmin.batch();
  batch.set(financialDbAdmin.collection(MONTHLY).doc(monthlyId), monthly);

  const current = currentPeriod();
  if (closure.year === current.year && closure.month === current.month) {
    const unitId = `${closure.workspaceId}_${closure.kioskId}`;
    const unit: CashClosureUnitSummary = {
      ...summaryFromClosures({
        id: unitId,
        closures: monthlyClosures,
        workspaceId: closure.workspaceId,
        kioskId: closure.kioskId,
        kioskName: closure.kioskName,
        pdvFilialId: closure.pdvFilialId,
        year: current.year,
        month: current.month,
        now,
      }),
      currentYear: current.year,
      currentMonth: current.month,
    };
    batch.set(financialDbAdmin.collection(UNITS).doc(unitId), unit);
  }
  await batch.commit();
  return monthly;
}

export async function listCashClosureUnitSummaries(workspaceId: string) {
  const snapshot = await financialDbAdmin.collection(UNITS).where("workspaceId", "==", workspaceId).get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as CashClosureUnitSummary));
}

export async function listCashClosureMonthlySummaries(workspaceId: string, kioskId: string) {
  const snapshot = await financialDbAdmin.collection(MONTHLY)
    .where("workspaceId", "==", workspaceId)
    .where("kioskId", "==", kioskId)
    .orderBy("year", "desc")
    .orderBy("month", "desc")
    .get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as CashClosureMonthlySummary));
}
