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
};

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
