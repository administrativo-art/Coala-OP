import { createHash } from "node:crypto";

import {
  prepareCanonicalSalesImportBatch,
  SalesImportValidationError,
} from "./ingestion.server";
import { suggestSalesReconciliationCases } from "./matching";
import type {
  PdvPaymentFact,
  SalesMatchFact,
  StoneSaleTransaction,
} from "./types";
import {
  prepareStoneFinancialImport,
  StoneFinancialImportValidationError,
} from "../stone-receivables/ingestion.server";
import type { StoneReceivable, StoneSettlement } from "../stone-receivables/types";

export type StoneBackfillSource =
  | "pdv"
  | "stone_sales"
  | "stone_receivables"
  | "stone_settlements";

export type StoneBackfillInput = {
  fileName: string;
  raw: unknown;
};

export type PreparedStoneBackfillBatch = {
  fileName: string;
  source: StoneBackfillSource;
  period: string | null;
  rowCount: number;
  duplicateCount: number;
  idempotencyKey: string;
  finalize: boolean | null;
  raw: unknown;
};

type SalesTotals = {
  period: string;
  kioskId: string;
  pdvFactCount: number;
  stoneSaleCount: number;
  pdvGrossAmountCents: number;
  stoneGrossAmountCents: number;
};

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceOf(raw: unknown): StoneBackfillSource | null {
  if (!raw || typeof raw !== "object" || !("source" in raw)) return null;
  const source = String((raw as { source?: unknown }).source ?? "");
  return ["pdv", "stone_sales", "stone_receivables", "stone_settlements"].includes(source)
    ? source as StoneBackfillSource
    : null;
}

function toMatchFact(row: PdvPaymentFact | StoneSaleTransaction): SalesMatchFact {
  if ("couponId" in row) {
    return {
      id: row.id,
      source: "pdv",
      workspaceId: row.workspaceId,
      kioskId: row.kioskId,
      businessDate: row.businessDate,
      soldAt: row.soldAt,
      channel: row.channel,
      grossAmountCents: row.grossAmountCents,
      status: row.status,
      couponId: row.couponId,
      identifiers: row.identifiers,
    };
  }
  return {
    id: row.id,
    source: "stone",
    workspaceId: row.workspaceId,
    kioskId: row.kioskId,
    businessDate: row.businessDate,
    soldAt: row.soldAt,
    channel: row.channel,
    grossAmountCents: row.grossAmountCents,
    status: row.status,
    identifiers: row.identifiers,
  };
}

function deduplicateRows<T extends { id: string; sourceHash: string }>(
  rows: T[],
  label: string,
) {
  const unique = new Map<string, T>();
  let duplicateCount = 0;
  for (const row of rows) {
    const previous = unique.get(row.id);
    if (!previous) {
      unique.set(row.id, row);
      continue;
    }
    duplicateCount += 1;
    if (previous.sourceHash !== row.sourceHash) {
      throw new Error(`${label} contém revisões conflitantes para ${row.id}. Separe as revisões em execuções distintas.`);
    }
  }
  return { rows: [...unique.values()], duplicateCount };
}

function reconciliationCases(pdv: PdvPaymentFact[], stone: StoneSaleTransaction[]) {
  const groups = new Map<string, { pdv: SalesMatchFact[]; stone: SalesMatchFact[] }>();
  for (const fact of pdv.map(toMatchFact)) {
    const key = `${fact.businessDate}:${fact.channel}`;
    const group = groups.get(key) ?? { pdv: [], stone: [] };
    group.pdv.push(fact);
    groups.set(key, group);
  }
  for (const fact of stone.map(toMatchFact)) {
    const key = `${fact.businessDate}:${fact.channel}`;
    const group = groups.get(key) ?? { pdv: [], stone: [] };
    group.stone.push(fact);
    groups.set(key, group);
  }
  return [...groups.keys()].sort().flatMap((key) => {
    const group = groups.get(key)!;
    return suggestSalesReconciliationCases({ pdvFacts: group.pdv, stoneSales: group.stone });
  });
}

function settledPeriod(value: string) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "invalid";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month ? `${year}-${month}` : "invalid";
}

export function prepareStoneReconciliationBackfill(input: {
  workspaceId: string;
  fromPeriod?: string;
  approvedKioskIds: string[];
  batches: StoneBackfillInput[];
}) {
  const fromPeriod = input.fromPeriod ?? "2026-08";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fromPeriod)) throw new Error("A competência inicial do backfill é inválida.");
  if (!input.workspaceId.trim() || input.workspaceId.includes("/")) throw new Error("O workspace do backfill é inválido.");
  if (input.batches.length < 1 || input.batches.length > 1_000) throw new Error("O backfill exige de 1 a 1.000 lotes.");

  const approvedKioskIds = new Set(input.approvedKioskIds);
  const batchKeys = new Set<string>();
  const preparedBatches: PreparedStoneBackfillBatch[] = [];
  const pdvRows: PdvPaymentFact[] = [];
  const stoneSaleRows: StoneSaleTransaction[] = [];
  const receivableRows: StoneReceivable[] = [];
  const settlementRows: StoneSettlement[] = [];

  for (const inputBatch of input.batches) {
    const source = sourceOf(inputBatch.raw);
    if (!source) throw new Error(`${inputBatch.fileName}: fonte ausente ou não suportada.`);
    try {
      if (source === "pdv" || source === "stone_sales") {
        const batch = prepareCanonicalSalesImportBatch(inputBatch.raw);
        if (batch.workspaceId !== input.workspaceId) throw new Error("workspace diferente do informado");
        if (batch.period < fromPeriod) throw new Error(`competência anterior a ${fromPeriod}`);
        const key = `${batch.workspaceId}:${batch.idempotencyKey}`;
        if (batchKeys.has(key)) throw new Error("chave de idempotência repetida no conjunto");
        batchKeys.add(key);
        if (source === "pdv") pdvRows.push(...batch.rows as PdvPaymentFact[]);
        else stoneSaleRows.push(...batch.rows as StoneSaleTransaction[]);
        preparedBatches.push({
          fileName: inputBatch.fileName,
          source,
          period: batch.period,
          rowCount: batch.rows.length,
          duplicateCount: batch.duplicateCount,
          idempotencyKey: batch.idempotencyKey,
          finalize: batch.finalize,
          raw: inputBatch.raw,
        });
        continue;
      }

      const batch = prepareStoneFinancialImport(inputBatch.raw);
      if (batch.workspaceId !== input.workspaceId) throw new Error("workspace diferente do informado");
      const key = `${batch.workspaceId}:${batch.idempotencyKey}`;
      if (batchKeys.has(key)) throw new Error("chave de idempotência repetida no conjunto");
      batchKeys.add(key);
      if (source === "stone_receivables") {
        const rows = batch.rows as StoneReceivable[];
        if (rows.some((row) => row.originalExpectedDate.slice(0, 7) < fromPeriod)) {
          throw new Error(`recebível anterior a ${fromPeriod}`);
        }
        receivableRows.push(...rows);
      } else {
        const rows = batch.rows as StoneSettlement[];
        if (rows.some((row) => settledPeriod(row.settledAt) < fromPeriod)) {
          throw new Error(`liquidação anterior a ${fromPeriod}`);
        }
        settlementRows.push(...rows);
      }
      preparedBatches.push({
        fileName: inputBatch.fileName,
        source,
        period: null,
        rowCount: batch.rows.length,
        duplicateCount: batch.duplicateCount,
        idempotencyKey: batch.idempotencyKey,
        finalize: null,
        raw: inputBatch.raw,
      });
    } catch (cause) {
      const suffix = cause instanceof SalesImportValidationError || cause instanceof StoneFinancialImportValidationError
        ? cause.message
        : cause instanceof Error ? cause.message : "lote inválido";
      throw new Error(`${inputBatch.fileName}: ${suffix}`, { cause });
    }
  }

  const uniquePdv = deduplicateRows(pdvRows, "O conjunto PDV");
  const uniqueStoneSales = deduplicateRows(stoneSaleRows, "O conjunto Stone Vendas");
  const uniqueReceivables = deduplicateRows(receivableRows, "O conjunto de recebíveis");
  const uniqueSettlements = deduplicateRows(settlementRows, "O conjunto de liquidações");
  for (const period of [...new Set([...uniquePdv.rows, ...uniqueStoneSales.rows].map((row) => row.period))]) {
    const pdvCount = uniquePdv.rows.filter((row) => row.period === period).length;
    const stoneCount = uniqueStoneSales.rows.filter((row) => row.period === period).length;
    if (pdvCount > 5_000 || stoneCount > 5_000) {
      throw new Error(`A competência ${period} ultrapassa o teto de 5.000 fatos por fonte.`);
    }
  }
  const salesTotals = new Map<string, SalesTotals>();
  const updateSalesTotal = (period: string, kioskId: string, source: "pdv" | "stone", amountCents: number) => {
    const key = `${period}:${kioskId}`;
    const total = salesTotals.get(key) ?? {
      period,
      kioskId,
      pdvFactCount: 0,
      stoneSaleCount: 0,
      pdvGrossAmountCents: 0,
      stoneGrossAmountCents: 0,
    };
    if (source === "pdv") {
      total.pdvFactCount += 1;
      if (amountCents >= 0) total.pdvGrossAmountCents += amountCents;
    } else {
      total.stoneSaleCount += 1;
      if (amountCents >= 0) total.stoneGrossAmountCents += amountCents;
    }
    salesTotals.set(key, total);
  };
  uniquePdv.rows.forEach((row) => updateSalesTotal(row.period, row.kioskId, "pdv", row.status === "approved" ? row.grossAmountCents : 0));
  uniqueStoneSales.rows.forEach((row) => updateSalesTotal(row.period, row.kioskId ?? "__unmapped__", "stone", row.status === "approved" ? row.grossAmountCents : 0));

  const periods = [...salesTotals.values()]
    .map((entry) => ({ ...entry, differenceAmountCents: entry.stoneGrossAmountCents - entry.pdvGrossAmountCents }))
    .sort((left, right) => left.period.localeCompare(right.period) || left.kioskId.localeCompare(right.kioskId));
  const salesPeriods = [...new Set(preparedBatches.flatMap((batch) => batch.period ? [batch.period] : []))].sort();
  const periodsWithoutBothSalesSources = salesPeriods.filter((period) => {
    const sources = new Set(preparedBatches.filter((batch) => batch.period === period).map((batch) => batch.source));
    return !sources.has("pdv") || !sources.has("stone_sales");
  });
  const periodsWithoutFinalBatch = salesPeriods.filter((period) => {
    const last = preparedBatches.filter((batch) => batch.period === period && (batch.source === "pdv" || batch.source === "stone_sales")).at(-1);
    return last?.finalize !== true;
  });
  const usedKioskIds = [...new Set([
    ...uniquePdv.rows.map((row) => row.kioskId),
    ...uniqueStoneSales.rows.flatMap((row) => row.kioskId ? [row.kioskId] : []),
    ...uniqueReceivables.rows.flatMap((row) => row.kioskId ? [row.kioskId] : []),
  ])].sort();
  const unapprovedKioskIds = usedKioskIds.filter((kioskId) => !approvedKioskIds.has(kioskId));
  const unmappedStoneSaleCount = uniqueStoneSales.rows.filter((row) => !row.kioskId).length;
  const stoneSaleExternalIds = new Set(uniqueStoneSales.rows.map((row) => row.externalTransactionId));
  const feeReceivables = uniqueReceivables.rows.filter((row) => row.mdrAmountCents > 0 || row.anticipationFeeAmountCents > 0);
  const feeReceivablesWithoutSale = feeReceivables.filter((row) => !row.externalSaleId || !stoneSaleExternalIds.has(row.externalSaleId));
  const lastStoneSalesBatchIndex = preparedBatches.reduce((last, batch, index) => batch.source === "stone_sales" ? index : last, -1);
  const firstFeeReceivablesBatchIndex = preparedBatches.findIndex((batch) => batch.source === "stone_receivables"
    && (batch.raw as { rows?: Array<Record<string, unknown>> }).rows?.some((row) => Number(row.mdrAmountCents ?? 0) > 0
      || Number(row.anticipationFeeAmountCents ?? 0) > 0));
  const feeBatchOrderInvalid = firstFeeReceivablesBatchIndex >= 0 && lastStoneSalesBatchIndex > firstFeeReceivablesBatchIndex;
  const cases = reconciliationCases(uniquePdv.rows, uniqueStoneSales.rows);
  const casesByKind = Object.fromEntries([...cases.reduce(
    (totals, entry) => totals.set(entry.kind, (totals.get(entry.kind) ?? 0) + 1),
    new Map<string, number>(),
  )].sort(([left], [right]) => left.localeCompare(right)));
  const receivableTotals = uniqueReceivables.rows.reduce((totals, row) => ({
    grossAmountCents: totals.grossAmountCents + row.grossAmountCents,
    mdrAmountCents: totals.mdrAmountCents + row.mdrAmountCents,
    anticipationFeeAmountCents: totals.anticipationFeeAmountCents + row.anticipationFeeAmountCents,
    netAmountCents: totals.netAmountCents + row.netAmountCents,
    settledAmountCents: totals.settledAmountCents + row.settledAmountCents,
  }), { grossAmountCents: 0, mdrAmountCents: 0, anticipationFeeAmountCents: 0, netAmountCents: 0, settledAmountCents: 0 });
  const settlementTotals = uniqueSettlements.rows.reduce((totals, row) => ({
    grossAmountCents: totals.grossAmountCents + row.grossAmountCents,
    feeAmountCents: totals.feeAmountCents + row.feeAmountCents,
    netAmountCents: totals.netAmountCents + row.netAmountCents,
  }), { grossAmountCents: 0, feeAmountCents: 0, netAmountCents: 0 });

  const blockers = [
    ...(unmappedStoneSaleCount > 0 ? [`${unmappedStoneSaleCount} venda(s) Stone sem unidade canônica`] : []),
    ...(unapprovedKioskIds.length > 0 ? [`unidades sem aprovação explícita: ${unapprovedKioskIds.join(", ")}`] : []),
    ...(periodsWithoutBothSalesSources.length > 0 ? [`competências sem PDV e Stone Vendas: ${periodsWithoutBothSalesSources.join(", ")}`] : []),
    ...(periodsWithoutFinalBatch.length > 0 ? [`competências cujo último lote não finaliza a projeção: ${periodsWithoutFinalBatch.join(", ")}`] : []),
    ...(feeReceivablesWithoutSale.length > 0 ? [`${feeReceivablesWithoutSale.length} recebível(is) com taxa sem venda Stone no conjunto`] : []),
    ...(feeBatchOrderInvalid ? ["lotes de recebíveis com taxas aparecem antes do último lote de Stone Vendas"] : []),
  ];
  const reportCore = {
    workspaceId: input.workspaceId,
    fromPeriod,
    approvedKioskIds: [...approvedKioskIds].sort(),
    input: {
      batchCount: preparedBatches.length,
      batches: preparedBatches.map((batch) => ({
        fileName: batch.fileName,
        source: batch.source,
        period: batch.period,
        rowCount: batch.rowCount,
        duplicateCount: batch.duplicateCount,
        idempotencyKey: batch.idempotencyKey,
        finalize: batch.finalize,
      })),
      fingerprint: sha256(input.batches.map((batch) => ({ fileName: batch.fileName, raw: batch.raw }))),
    },
    rows: {
      pdv: uniquePdv.rows.length,
      stoneSales: uniqueStoneSales.rows.length,
      stoneReceivables: uniqueReceivables.rows.length,
      stoneSettlements: uniqueSettlements.rows.length,
      duplicatesAcrossBatches: uniquePdv.duplicateCount + uniqueStoneSales.duplicateCount
        + uniqueReceivables.duplicateCount + uniqueSettlements.duplicateCount,
    },
    sales: {
      periods,
      caseCount: cases.length,
      pendingReviewCount: cases.filter((entry) => entry.reviewStatus === "pending_review").length,
      casesByKind,
      unmappedStoneSaleCount,
    },
    receivables: receivableTotals,
    feeAccounting: {
      receivableCount: feeReceivables.length,
      missingSaleCount: feeReceivablesWithoutSale.length,
      salesImportedBeforeFees: !feeBatchOrderInvalid,
    },
    settlements: settlementTotals,
    blockers,
    referencesExistingCashAndBankRecordsOnly: true,
  };

  return {
    preparedBatches,
    report: {
      ...reportCore,
      readyToExecute: blockers.length === 0,
      reviewHash: sha256(reportCore),
    },
  };
}
