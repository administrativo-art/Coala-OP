import "server-only";

import { FieldPath } from "firebase-admin/firestore";

import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import type { CashClosureMonthlySummary } from "@/features/financial/cash-closures/types";
import type { ProductSimulation, SalesReport } from "@/types";
import {
  chunkDreSimulationIds,
  DreSourceLimitError,
  summarizeDreSalesReports,
  type DreSourceDataPayload,
} from "./source-data";

const SALES_PAGE_SIZE = 500;
const MAX_REPORTS_PER_PERIOD = 5_000;
const MAX_SIMULATIONS_PER_REQUEST = 5_000;

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

export async function getDreSourceData(input: {
  workspaceId: string;
  kioskIds: string[];
  periods: string[];
}): Promise<DreSourceDataPayload> {
  if (input.kioskIds.length < 1 || input.kioskIds.length > 20) {
    throw new DreSourceLimitError("reports");
  }
  const allowedKiosks = new Set(input.kioskIds);
  const periodDocuments = await Promise.all(input.periods.map((period) => {
    const [year, month] = period.split("-").map(Number);
    return listSalesReportsForPeriod(year, month, input.kioskIds);
  }));
  const reportDocuments = periodDocuments.flat();
  const reports = reportDocuments.flatMap((document): SalesReport[] => {
    const data = document.data();
    if (!allowedKiosks.has(String(data.kioskId ?? "")) || !Array.isArray(data.items)) return [];
    return [{ id: document.id, ...data } as SalesReport];
  });
  const simulationIds = reports.flatMap((report) => report.items.map((item) => item.simulationId));
  const simulationChunks = chunkDreSimulationIds(simulationIds);
  const uniqueSimulationCount = simulationChunks.reduce((total, ids) => total + ids.length, 0);
  if (uniqueSimulationCount > MAX_SIMULATIONS_PER_REQUEST) {
    throw new DreSourceLimitError("simulations");
  }
  const simulationDocuments = (
    await Promise.all(simulationChunks.map((ids) => (
      dbAdmin.getAll(...ids.map((id) => dbAdmin.collection("productSimulations").doc(id)))
    )))
  ).flat().filter((snapshot) => snapshot.exists);
  const simulationCmv = new Map(simulationDocuments.flatMap((snapshot) => {
    const simulation = { id: snapshot.id, ...snapshot.data() } as ProductSimulation;
    return Number.isFinite(simulation.totalCmv)
      ? [[snapshot.id, simulation.totalCmv] as const]
      : [];
  }));
  const sales = summarizeDreSalesReports(reports, simulationCmv);

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
    salesSummaries: sales.salesSummaries,
    closureSummaries,
    missingSimulationIds: sales.missingSimulationIds,
    stats: {
      salesReportDocuments: reportDocuments.length,
      simulationDocuments: simulationDocuments.length,
      closureSummaryDocuments: closureSnapshots.length,
    },
  };
}
