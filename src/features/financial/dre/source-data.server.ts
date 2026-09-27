import "server-only";

import { FieldPath } from "firebase-admin/firestore";

import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { getBudgetPlanningComparisons } from "../budgets/projections.server";
import type { BudgetExpense } from "../lib/budget-consumption";
import type { CashClosureMonthlySummary } from "@/features/financial/cash-closures/types";
import type { SalesReport } from "@/types";
import {
  financialExpenseDreWithoutPresentationDetails,
  normalizeFinancialExpenseForDre,
} from "@/features/financial/lib/expense-accounting-contract";
import {
  DreSourceLimitError,
  summarizeDreSalesReports,
  type DreSourceDataPayload,
} from "./source-data";

import { buildCmvPeriod, loadCmvClosures, loadCurrentCompositionCosts } from "./cmv-closure.server";

const SALES_PAGE_SIZE = 500;
const EXPENSE_PAGE_SIZE = 500;
const MAX_REPORTS_PER_PERIOD = 5_000;
const MAX_EXPENSES_PER_PERIOD = 5_000;


async function listSalesReportsForPeriod(year: number, month: number, kioskIds: string[]) {
  const documents: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: string | null = null;
  while (documents.length <= MAX_REPORTS_PER_PERIOD) {
    const remaining = MAX_REPORTS_PER_PERIOD + 1 - documents.length;
    let query: FirebaseFirestore.Query = dbAdmin.collection("salesReports")
      .where("year", "==", year)
      .where("month", "==", month)
      .where("kioskId", "in", kioskIds)
      .orderBy(FieldPath.documentId())
      .limit(Math.min(SALES_PAGE_SIZE, remaining));
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    documents.push(...snapshot.docs);
    if (snapshot.empty || snapshot.size < Math.min(SALES_PAGE_SIZE, remaining)) break;
    cursor = snapshot.docs.at(-1)?.id ?? null;
    if (!cursor) break;
  }
  if (documents.length > MAX_REPORTS_PER_PERIOD) {
    throw new DreSourceLimitError("reports");
  }
  return documents;
}

async function listExpensesForPeriod(period: string) {
  const documents: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: string | null = null;

  while (documents.length <= MAX_EXPENSES_PER_PERIOD) {
    const remaining = MAX_EXPENSES_PER_PERIOD + 1 - documents.length;
    let query: FirebaseFirestore.Query = financialDbAdmin.collection("expenses")
      .where("competenceMonth", "==", period)
      .orderBy(FieldPath.documentId())
      .limit(Math.min(EXPENSE_PAGE_SIZE, remaining));
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    documents.push(...snapshot.docs);
    if (snapshot.empty || snapshot.size < Math.min(EXPENSE_PAGE_SIZE, remaining)) break;
    cursor = snapshot.docs.at(-1)?.id ?? null;
    if (!cursor) break;
  }
  if (documents.length > MAX_EXPENSES_PER_PERIOD) {
    throw new DreSourceLimitError("expenses");
  }
  return documents;
}

export async function getDreSourceData(input: {
  workspaceId: string;
  kioskIds: string[];
  periods: string[];
  canViewExpenseDetails: boolean;
  canViewPersonnel?: boolean;
}): Promise<DreSourceDataPayload> {
  if (input.kioskIds.length < 1 || input.kioskIds.length > 20) {
    throw new DreSourceLimitError("reports");
  }
  const allowedKiosks = new Set(input.kioskIds);
  const [periodDocuments, expensePeriodDocuments] = await Promise.all([
    Promise.all(input.periods.map((period) => {
      const [year, month] = period.split("-").map(Number);
      return listSalesReportsForPeriod(year, month, input.kioskIds);
    })),
    Promise.all(input.periods.map(listExpensesForPeriod)),
  ]);
  const reportDocuments = periodDocuments.flat();
  const requestedPeriods = new Set(input.periods);
  const expenseDocuments = expensePeriodDocuments.flat();
  const expenses = expenseDocuments
    .map((document) => normalizeFinancialExpenseForDre(document.id, document.data()))
    .map((expense) => input.canViewExpenseDetails
      ? expense
      : financialExpenseDreWithoutPresentationDetails(expense))
    .filter((expense) => expense.competenceMonth && requestedPeriods.has(expense.competenceMonth));
  const reports = reportDocuments.flatMap((document): SalesReport[] => {
    const data = document.data();
    if (!allowedKiosks.has(String(data.kioskId ?? ""))) return [];
    return [{ ...data, id: document.id } as SalesReport];
  });
  const cmvClosures = await loadCmvClosures(input.workspaceId, input.kioskIds, input.periods);
  const closureByKey = new Map(cmvClosures.map(closure => [`${closure.kioskId}:${closure.period}`, closure]));
  const keyForReport = (report: SalesReport) => `${report.kioskId}:${report.year}-${String(report.month).padStart(2, "0")}`;
  const liveReports = reports.filter(report => closureByKey.get(keyForReport(report))?.status !== "closed");
  const simulationIds = liveReports.flatMap(report => Array.isArray(report.items) ? report.items.map(item => item?.simulationId) : []);
  const currentCosts = await loadCurrentCompositionCosts(simulationIds);
  const simulationCmv = new Map([...currentCosts.costs].flatMap(([id, result]) => result.complete && result.totalCmv !== null ? [[id, result.totalCmv] as const] : []));
  const sales = summarizeDreSalesReports(reports, simulationCmv);
  const cmvPeriods = input.kioskIds.flatMap(kioskId => input.periods.map(period => {
    const key = `${kioskId}:${period}`;
    return buildCmvPeriod(kioskId, period, reports.filter(report => keyForReport(report) === key),
      currentCosts.costs, closureByKey.get(key)).view;
  }));
  for (const cmv of cmvPeriods) {
    const [year, month] = cmv.period.split("-").map(Number);
    const summary = sales.salesSummaries.find(row => row.kioskId === cmv.kioskId && row.year === year && row.month === month);
    if (summary) { summary.cmv = cmv.totalCmv ?? 0; summary.cmvComplete = cmv.complete; }
    else if (cmv.status === "closed") sales.salesSummaries.push({ kioskId: cmv.kioskId, year, month,
      revenue: 0, cmv: cmv.totalCmv!, cmvComplete: true, cmvOnly: true, dates: [], hasUndatedReports: true });
  }
  // Missing live compositions must not invalidate unrelated frozen months.
  sales.missingSimulationIds = [...currentCosts.costs].filter(([, result]) => !result.complete).map(([id]) => id).sort();

  const closureRefs = input.kioskIds.flatMap((kioskId) => input.periods.map((period) => {
    const [year, month] = period.split("-").map(Number);
    return financialDbAdmin.collection("cashClosureMonthlySummaries")
      .doc(`${input.workspaceId}_${kioskId}_${year}_${String(month).padStart(2, "0")}`);
  }));
  const closureSnapshots = closureRefs.length > 0 ? await financialDbAdmin.getAll(...closureRefs) : [];
  const closureSummaries = closureSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() } as CashClosureMonthlySummary));

  return {
    budgetPlanning: await getBudgetPlanningComparisons({ periods: input.periods, kioskIds: input.kioskIds,
      expenses: expenseDocuments.map((doc) => ({ ...doc.data(), id: doc.id } as BudgetExpense)), canViewPersonnel: input.canViewPersonnel === true }),
    expenses,
    cmvPeriods,
    salesSummaries: sales.salesSummaries,
    closureSummaries,
    missingSimulationIds: sales.missingSimulationIds,
    stats: {
      salesReportDocuments: reportDocuments.length,
      ...currentCosts.stats,
      cmvClosureDocuments: input.kioskIds.length * input.periods.length,
      closureSummaryDocuments: closureSnapshots.length,
      expenseDocuments: expenseDocuments.length,
    },
  };
}
