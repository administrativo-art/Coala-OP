import type { StudyBatch, StudyClosure } from "./model";

export type StudyCashSession = {
  id: string; workspaceId: string; status: string; kioskIds: string[];
  scopes: Array<{ kioskId: string; year: number; month: number }>;
  batchIds: string[];
  countedCashCents: number; noteTotalCents: number; coinReturnedToTillCents: number; coinPendingExchangeCents: number; dreOnlyCashCents: number;
  scopeAggregationVersion: number | null;
  finalizedOperatorCountsByDate: Record<string, number>;
};
export type StudyCashBill = {
  id: string; workspaceId: string; batchId: string; status: string; situacao: string | null;
  origemRecebimento: string | null; recebidoManual: boolean; valorNominalCents: number; valorTotalRecebidoCents: number;
};
export type StudyCashEvidence = { workspaceId: string; sessions: StudyCashSession[]; bills: StudyCashBill[]; gaps: string[] };
export type CashOperationStage = "awaiting_count" | "partial" | "counted" | "in_batch" | "received" | "excluded" | "unavailable";
export type CashOperation = {
  id: string; originDate: string; unitId: string; unitName: string; stage: CashOperationStage; referenceCents: number;
  finalizedOperators: number; allocatedOperators: number; receivedOperators: number; totalOperators: number | null;
  remainingCents: null; outsideDepositPolicy: boolean;
};
export const CASH_OPERATION_LABEL: Record<CashOperationStage, string> = {
  awaiting_count: "Aguardando contagem", partial: "Contagem parcial", counted: "Contado, sem malote",
  in_batch: "Incluído em malote", received: "Recebido por boleto", excluded: "Fora do fluxo de depósitos", unavailable: "Conferir vínculo",
};
const validCents = (value: number) => Number.isSafeInteger(value) && value >= 0;
const physicalBatchStates = new Set(["open", "locked", "issuing", "issued", "paid", "failed"]);

function activeBill(batch: StudyBatch, evidence?: StudyCashEvidence): StudyCashBill | null {
  if (!evidence || batch.workspaceId !== evidence.workspaceId || !batch.interCobrancaId || !validCents(batch.totalCents) || batch.totalCents <= 0) return null;
  const bill = evidence.bills.find(row => row.id === batch.interCobrancaId);
  return bill && bill.workspaceId === evidence.workspaceId && bill.batchId === batch.id
    && bill.valorNominalCents === batch.totalCents && bill.recebidoManual === false ? bill : null;
}

export function isConfirmedCashBoleto(batch: StudyBatch, evidence?: StudyCashEvidence): boolean {
  const bill = activeBill(batch, evidence);
  return !!bill && ["issued", "issuing", "paid"].includes(batch.status) && bill.status === "paid" && bill.situacao === "RECEBIDO"
    && bill.origemRecebimento === "BOLETO" && bill.valorTotalRecebidoCents === batch.totalCents;
}

/** Missing, cancelled, manual or contradictory active charges are not guaranteed future cash. */
export function isForecastCashBoleto(batch: StudyBatch, evidence?: StudyCashEvidence): boolean {
  const bill = activeBill(batch, evidence);
  return !!bill && ["issued", "issuing"].includes(batch.status) && bill.status === "issued"
    && ["A_RECEBER", "ATRASADO", "PROTESTO"].includes(bill.situacao ?? "") && bill.valorTotalRecebidoCents === 0;
}

function batchBelongs(batch: StudyBatch | undefined, session: StudyCashSession, unitId: string, workspaceId: string): batch is StudyBatch {
  return !!batch && batch.workspaceId === workspaceId && batch.countingSessionId === session.id
    && batch.kioskId === unitId && (batch.kioskIds ?? [batch.kioskId]).length === 1
    && (batch.kioskIds ?? [batch.kioskId])[0] === unitId && physicalBatchStates.has(batch.status)
    && validCents(batch.totalCents) && batch.totalCents > 0;
}

export function buildCashOperations(closures: StudyClosure[], batches: StudyBatch[], evidence?: StudyCashEvidence): CashOperation[] {
  const byBatch = new Map(batches.map(batch => [batch.id, batch]));
  return closures.filter(closure => closure.byChannelCents.cash > 0 || (closure.countedCashCents ?? 0) > 0).map(closure => {
    const related = (evidence?.sessions ?? []).filter(session => session.workspaceId === evidence?.workspaceId && session.status !== "cancelled"
      && session.kioskIds.includes(closure.kioskId)
      && session.scopes.some(scope => scope.kioskId === closure.kioskId && scope.year === Number(closure.date.slice(0, 4)) && scope.month === Number(closure.date.slice(5, 7))));
    const count = (session: StudyCashSession) => {
      const value = session.finalizedOperatorCountsByDate[closure.date];
      return Number.isSafeInteger(value) && value > 0 ? value : 0;
    };
    const ambiguous = related.some(session => session.scopeAggregationVersion !== 1 || session.kioskIds.length !== 1);
    const sessions = related.filter(session => session.scopeAggregationVersion === 1 && session.kioskIds.length === 1);
    const linked = (session: StudyCashSession) => session.batchIds.length > 0 && new Set(session.batchIds).size === session.batchIds.length
      && session.batchIds.every(id => batchBelongs(byBatch.get(id), session, closure.kioskId, evidence!.workspaceId));
    const invalidLink = sessions.some(session => count(session) > 0 && session.batchIds.length > 0 && !linked(session));
    const finalized = sessions.reduce((sum, session) => sum + count(session), 0);
    const allocated = sessions.filter(linked).reduce((sum, session) => sum + count(session), 0);
    const received = sessions.filter(session => session.status === "completed" && linked(session)
      && [session.countedCashCents, session.noteTotalCents, session.coinReturnedToTillCents].every(validCents)
      && session.coinPendingExchangeCents === 0 && session.dreOnlyCashCents === 0
      && session.countedCashCents === session.noteTotalCents + session.coinReturnedToTillCents
      && session.batchIds.reduce((sum, id) => sum + byBatch.get(id)!.totalCents, 0) === session.noteTotalCents
      && session.batchIds.every(id => isConfirmedCashBoleto(byBatch.get(id)!, evidence)))
      .reduce((sum, session) => sum + count(session), 0);
    const total = Number.isSafeInteger(closure.operatorCount) && closure.operatorCount! > 0 ? closure.operatorCount! : null;
    const full = total !== null && finalized === total;
    const outside = closure.cashDepositPolicy === "dre_only";
    let stage: CashOperationStage = "awaiting_count";
    if (ambiguous || invalidLink || (total !== null && finalized > total)) stage = "unavailable";
    else if (full && received === total) stage = "received";
    else if (finalized > 0 && !full) stage = "partial";
    else if (outside && closure.status === "approved") stage = "excluded";
    else if (full && allocated === total) stage = "in_batch";
    else if (full) stage = "counted";
    else if (closure.status === "approved") stage = "unavailable";
    return { id: `cash:${closure.kioskId}:${closure.date}`, originDate: closure.date, unitId: closure.kioskId, unitName: closure.kioskName,
      stage, referenceCents: closure.byChannelCents.cash, finalizedOperators: finalized, allocatedOperators: allocated, receivedOperators: received,
      totalOperators: total, remainingCents: null, outsideDepositPolicy: outside };
  });
}
