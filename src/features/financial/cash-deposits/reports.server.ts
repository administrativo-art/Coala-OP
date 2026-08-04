import "server-only";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import type { CashClosure, CashClosureLine } from "../cash-closures/types";
import { getCashDepositBatch, listCashDepositBatches, listPendingCashDepositAdjustments } from "./repository.server";
import { listInterCobrancas } from "./inter-service.server";
import { reconcileCashDepositBatch } from "./reconciliation";

function snapshotValue<T extends { id: string }>(snapshot: FirebaseFirestore.DocumentSnapshot) {
  return { id: snapshot.id, ...snapshot.data() } as T;
}

function calendarDayDifference(left: string, right: string) {
  const leftDate = new Date(`${left.slice(0, 10)}T12:00:00Z`);
  const rightDate = new Date(`${right.slice(0, 10)}T12:00:00Z`);
  return Math.round((leftDate.getTime() - rightDate.getTime()) / 86_400_000);
}

export async function buildCashDepositReport(
  workspaceId: string,
  canAccessKiosk: (kioskId: string) => boolean = () => true,
) {
  const [allBatches, allAdjustments, allCobrancas, closuresSnapshot, linesSnapshot] = await Promise.all([
    listCashDepositBatches({ workspaceId, limit: 500 }),
    listPendingCashDepositAdjustments(workspaceId),
    listInterCobrancas(workspaceId, 500),
    financialDbAdmin.collection("cashClosures")
      .where("workspaceId", "==", workspaceId)
      .orderBy("date", "desc")
      .limit(1000)
      .get(),
    financialDbAdmin.collectionGroup("lines")
      .where("workspaceId", "==", workspaceId)
      .limit(10_000)
      .get(),
  ]);
  const batches = allBatches.filter((batch) => canAccessKiosk(batch.kioskId));
  const adjustments = allAdjustments.filter((adjustment) => canAccessKiosk(adjustment.kioskId));
  const cobrancas = allCobrancas.filter((cobranca) => canAccessKiosk(cobranca.kioskId));
  const closures = closuresSnapshot.docs
    .map((document) => snapshotValue<CashClosure>(document))
    .filter((closure) => canAccessKiosk(closure.kioskId));
  const closureById = new Map(closures.map((closure) => [closure.id, closure]));
  const lines = linesSnapshot.docs
    .map((document) => snapshotValue<CashClosureLine>(document))
    .filter((line) =>
      typeof line.kioskId === "string" &&
      typeof line.closureId === "string" &&
      closureById.has(line.closureId) &&
      canAccessKiosk(line.kioskId),
    );
  const cobrancaById = new Map(cobrancas.map((cobranca) => [cobranca.id, cobranca]));

  const batchDetails = await Promise.all(batches.map((batch) => getCashDepositBatch(batch.id)));
  const reconciliationIssues = batchDetails.flatMap((detail) => {
    if (!detail) return [];
    return reconcileCashDepositBatch({
      batch: detail.batch,
      items: detail.items,
      cobranca: detail.batch.interCobrancaId ? cobrancaById.get(detail.batch.interCobrancaId) : null,
      closures: detail.batch.closureIds.map((id) => closureById.get(id)).filter((value): value is CashClosure => Boolean(value)),
    }).issues;
  });

  const divergentLines = lines.filter((line) => (line.differenceCents ?? 0) !== 0);
  const divergenceGroups = new Map<string, {
    operatorId: string;
    operatorName: string;
    channel: string;
    occurrences: number;
    absoluteDifferenceCents: number;
    netDifferenceCents: number;
  }>();
  for (const line of divergentLines) {
    const key = `${line.operatorId}:${line.channel}`;
    const current = divergenceGroups.get(key) ?? {
      operatorId: line.operatorId,
      operatorName: line.operatorName,
      channel: line.channel,
      occurrences: 0,
      absoluteDifferenceCents: 0,
      netDifferenceCents: 0,
    };
    current.occurrences++;
    current.absoluteDifferenceCents += Math.abs(line.differenceCents ?? 0);
    current.netDifferenceCents += line.differenceCents ?? 0;
    divergenceGroups.set(key, current);
  }

  const approved = closures.filter((closure) => closure.status === "approved" && closure.approvedAt);
  const closedOnTime = approved.filter((closure) => calendarDayDifference(closure.approvedAt!, closure.date) <= 1).length;
  const settled = cobrancas.filter((cobranca) => cobranca.paidAt && cobranca.issuedAt);
  const averageSettlementHours = settled.length
    ? settled.reduce((total, cobranca) => total + Math.max(0, new Date(cobranca.paidAt!).getTime() - new Date(cobranca.issuedAt!).getTime()), 0) / settled.length / 3_600_000
    : null;

  return {
    generatedAt: new Date().toISOString(),
    indicators: {
      approvedClosureCount: approved.length,
      closedOnTimeCount: closedOnTime,
      closedOnTimePercent: approved.length ? Math.round((closedOnTime / approved.length) * 10_000) / 100 : 0,
      averageAbsoluteDivergenceCents: divergentLines.length
        ? Math.round(divergentLines.reduce((total, line) => total + Math.abs(line.differenceCents ?? 0), 0) / divergentLines.length)
        : 0,
      cashAwaitingDepositCents: batches
        .filter((batch) => !["paid", "cancelled"].includes(batch.status))
        .reduce((total, batch) => total + batch.totalCents, 0),
      averageSettlementHours: averageSettlementHours === null ? null : Math.round(averageSettlementHours * 10) / 10,
    },
    pendingClosures: closures.filter((closure) => ["draft", "pending_review", "reopened", "sync_error"].includes(closure.status)),
    divergences: [...divergenceGroups.values()].sort((a, b) => b.absoluteDifferenceCents - a.absoluteDifferenceCents),
    openOrLockedBatches: batches.filter((batch) => ["open", "locked"].includes(batch.status)),
    issuedNotPaid: cobrancas.filter((cobranca) => ["requested", "issued", "marked_received"].includes(cobranca.status)),
    adjustments,
    reconciliationIssues,
  };
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function cashDepositReportCsv(report: Awaited<ReturnType<typeof buildCashDepositReport>>) {
  const rows: unknown[][] = [
    ["RELATORIO", "INDICADORES"],
    ["Gerado em", report.generatedAt],
    ["Fechamentos aprovados", report.indicators.approvedClosureCount],
    ["Fechados no prazo", report.indicators.closedOnTimeCount],
    ["Percentual no prazo", report.indicators.closedOnTimePercent],
    ["Divergencia media absoluta (centavos)", report.indicators.averageAbsoluteDivergenceCents],
    ["Dinheiro aguardando deposito (centavos)", report.indicators.cashAwaitingDepositCents],
    ["Tempo medio ate liquidacao (horas)", report.indicators.averageSettlementHours],
    [],
    ["DIVERGENCIAS", "Operador", "Canal", "Ocorrencias", "Absoluta (centavos)", "Liquida (centavos)"],
    ...report.divergences.map((item) => ["", item.operatorName, item.channel, item.occurrences, item.absoluteDifferenceCents, item.netDifferenceCents]),
    [],
    ["BLOCOS ABERTOS/TRAVADOS", "Unidade", "Status", "Total (centavos)", "Inicio", "Fim"],
    ...report.openOrLockedBatches.map((item) => ["", item.kioskName, item.status, item.totalCents, item.periodStartDate, item.periodEndDate]),
    [],
    ["COBRANCAS NAO PAGAS", "Unidade", "Situacao", "Valor (centavos)", "Vencimento", "Seu numero"],
    ...report.issuedNotPaid.map((item) => ["", item.kioskName, item.situacao, item.valorNominalCents, item.dataVencimento, item.seuNumero]),
    [],
    ["AJUSTES", "Unidade", "Fechamento", "Delta (centavos)", "Status", "Motivo"],
    ...report.adjustments.map((item) => ["", item.kioskId, item.closureId, item.deltaCents, item.status, item.reason]),
    [],
    ["RECONCILIACAO", "Codigo", "Bloco", "Fechamento", "Esperado", "Atual", "Mensagem"],
    ...report.reconciliationIssues.map((item) => ["", item.code, item.batchId, item.closureId, item.expectedCents, item.actualCents, item.message]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\n")}`;
}
