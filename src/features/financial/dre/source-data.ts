import type { DreCmvPeriod } from "./cmv-closure";
import type { SalesReport } from "@/types";
import type { BudgetPlanningComparison } from "../budgets/projection-view";
import type { FinancialExpenseDreDocument } from "@/features/financial/lib/expense-accounting-contract";
import type { CashClosureDreSummary } from "../cash-closures/dre-contract";

export class DreSourceLimitError extends Error {
  readonly reason: "reports" | "simulations" | "expenses" | "compositionItems" | "ingredients" | "snapshot";

  constructor(reason: "reports" | "simulations" | "expenses" | "compositionItems" | "ingredients" | "snapshot") {
    super("O volume solicitado ultrapassa o limite operacional da DRE.");
    this.name = "DreSourceLimitError";
    this.reason = reason;
  }
}

export type DreSalesUnitMonthSummary = {
  kioskId: string;
  year: number;
  month: number;
  revenue: number;
  cmv: number;
  cmvComplete?: boolean;
  /** A frozen CMV can survive removal of all live sales reports. */
  cmvOnly?: boolean;
  /** Coverage witnesses only: item price × quantity is not the integral payments source. */
  dates?: string[];
  hasUndatedReports?: boolean;
};

export type DreClosureUnitMonthSummary = Partial<CashClosureDreSummary> & {
  id: string;
  kioskId: string;
  year: number;
  month: number;
  closureCount?: number;
  expectedTotalCents: number;
  differenceTotalCents: number;
};

export type DreSourceDataStats = {
  salesReportDocuments: number;
  simulationDocuments: number;
  closureSummaryDocuments: number;
  expenseDocuments: number;
  compositionItemDocuments?: number;
  ingredientDocuments?: number;
  cmvClosureDocuments?: number;
};

export type DreSourceDataPayload = {
  budgetPlanning?: BudgetPlanningComparison[];
  cmvPeriods?: DreCmvPeriod[];
  cmvCapabilities?: { canClose: boolean; canReopen: boolean };
  expenses: FinancialExpenseDreDocument[];
  salesSummaries: DreSalesUnitMonthSummary[];
  closureSummaries: DreClosureUnitMonthSummary[];
  missingSimulationIds: string[];
  stats: DreSourceDataStats;
};

export function chunkDreSimulationIds(ids: string[], size = 200) {
  if (!Number.isInteger(size) || size <= 0) throw new Error("Tamanho de lote inválido.");
  const unique = Array.from(new Set(ids.filter(Boolean))).sort();
  return Array.from({ length: Math.ceil(unique.length / size) }, (_, index) => (
    unique.slice(index * size, (index + 1) * size)
  ));
}

export function summarizeDreSalesReports(
  reports: SalesReport[],
  simulationCmv: ReadonlyMap<string, number>,
) {
  const summaries = new Map<string, DreSalesUnitMonthSummary>();
  const missingSimulationIds = new Set<string>();
  for (const report of reports) {
    const key = `${report.kioskId}:${report.year}-${String(report.month).padStart(2, "0")}`;
    const current = summaries.get(key) ?? {
      kioskId: report.kioskId,
      year: report.year,
      month: report.month,
      revenue: 0,
      cmv: 0,
      dates: [],
      hasUndatedReports: false,
    };
    const maximumDay = new Date(Date.UTC(report.year, report.month, 0)).getUTCDate();
    if (Number.isInteger(report.day) && report.day! >= 1 && report.day! <= maximumDay) {
      const date = `${report.year}-${String(report.month).padStart(2, "0")}-${String(report.day).padStart(2, "0")}`;
      current.dates = [...new Set([...(current.dates ?? []), date])].sort();
    } else current.hasUndatedReports = true;
    for (const item of Array.isArray(report.items) ? report.items : []) {
      if (!item || typeof item !== "object") continue;
      if (Number.isFinite(item.quantity) && Number.isFinite(item.unitPrice ?? 0)) current.revenue += item.quantity * (item.unitPrice ?? 0);
      if (!item.simulationId) continue;
      const cmv = simulationCmv.get(item.simulationId);
      if (cmv === undefined) missingSimulationIds.add(item.simulationId);
      else current.cmv += item.quantity * cmv;
    }
    summaries.set(key, current);
  }
  return {
    salesSummaries: [...summaries.values()].sort((left, right) => (
      left.year - right.year
      || left.month - right.month
      || left.kioskId.localeCompare(right.kioskId)
    )),
    missingSimulationIds: [...missingSimulationIds].sort(),
  };
}
