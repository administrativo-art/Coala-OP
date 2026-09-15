import type { SalesReport } from "@/types";
import type { FinancialExpenseDreDocument } from "@/features/financial/lib/expense-accounting-contract";

export class DreSourceLimitError extends Error {
  readonly reason: "reports" | "simulations" | "expenses";

  constructor(reason: "reports" | "simulations" | "expenses") {
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
};

export type DreSourceDataStats = {
  salesReportDocuments: number;
  simulationDocuments: number;
  closureSummaryDocuments: number;
  expenseDocuments: number;
  revenueSummaryDocuments: number;
};

export type DreRevenueMonthlySummary = {
  id: string;
  workspaceId: string;
  kioskId: string;
  kioskName?: string | null;
  period: string;
  pdvRevenueTotalCents: number;
  reconciledRevenueTotalCents: number;
  differenceAmountCents: number;
  coveragePercent: number;
  periodStatus: "open" | "partial" | "ready" | "closed" | "reopened" | "stale";
  sourceFingerprint: string;
  cashRevenueAdjustmentCents?: number;
};

export function dreRevenueByCriterion(input: {
  criterion: "pdv" | "reconciled";
  pdvTotalRevenue: number;
  reconciliationSummary?: DreRevenueMonthlySummary;
}) {
  if (input.criterion === "pdv") return input.pdvTotalRevenue;
  if (!input.reconciliationSummary) return null;
  const electronicAdjustmentCents = input.reconciliationSummary.reconciledRevenueTotalCents
    - input.reconciliationSummary.pdvRevenueTotalCents;
  return input.pdvTotalRevenue
    + electronicAdjustmentCents / 100
    + (input.reconciliationSummary.cashRevenueAdjustmentCents ?? 0) / 100;
}

export type DreSourceDataPayload = {
  expenses: FinancialExpenseDreDocument[];
  salesSummaries: DreSalesUnitMonthSummary[];
  closureSummaries: Array<{
    id: string;
    kioskId: string;
    year: number;
    month: number;
    expectedTotalCents: number;
    differenceTotalCents: number;
    dreRevenueTotalCents?: number;
  }>;
  revenueSummaries: DreRevenueMonthlySummary[];
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
    };
    for (const item of report.items) {
      current.revenue += item.quantity * (item.unitPrice ?? 0);
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
