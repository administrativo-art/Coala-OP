import "server-only";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import type { StudyBatch } from "./model";
import type { StudyCashBill, StudyCashEvidence } from "./cash-stages";

export const CASH_EVIDENCE_LIMITS = { batches: 200, activeSessions: 50, readBatchSize: 50 } as const;
const SESSION_FIELDS = ["workspaceId", "status", "kioskIds", "scopes", "batchIds", "scopeAggregationVersion", "finalizedOperatorCountsByDate", "countedCashCents", "noteTotalCents", "coinReturnedToTillCents", "coinPendingExchangeCents", "dreOnlyCashCents"];
const BILL_FIELDS = ["workspaceId", "batchId", "status", "situacao", "origemRecebimento", "recebidoManual", "valorNominalCents", "valorTotalRecebidoCents"];
const safeId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(value);
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** Only existing records; no bank client, producer, synchronization or writes. */
export async function loadStudyCashEvidence(batches: StudyBatch[], historyFrom: string, db = financialDbAdmin): Promise<StudyCashEvidence> {
  const result: StudyCashEvidence = { workspaceId: WORKSPACE_ID, sessions: [], bills: [], gaps: [] };
  if (batches.length >= CASH_EVIDENCE_LIMITS.batches) result.gaps.push("Limite de malotes na conferência do numerário; cobertura parcial.");
  const selected = batches.slice(0, CASH_EVIDENCE_LIMITS.batches);
  const sessionIds = [...new Set(selected.map(batch => batch.countingSessionId).filter(safeId))];
  const billIds = [...new Set(selected.map(batch => batch.interCobrancaId).filter(safeId))];
  try {
    const active = await db.collection("cashCountingSessions").where("workspaceId", "==", WORKSPACE_ID)
      .where("status", "in", ["open", "counted", "deposit_ready"]).where("updatedAt", ">=", `${historyFrom}T00:00:00.000Z`)
      .orderBy("updatedAt", "asc").limit(CASH_EVIDENCE_LIMITS.activeSessions + 1).select(...SESSION_FIELDS).get();
    if (active.size > CASH_EVIDENCE_LIMITS.activeSessions) result.gaps.push("Mais de 50 sessões pendentes: estágios operacionais com cobertura parcial.");
    const sessions = new Map<string, FirebaseFirestore.DocumentSnapshot>(active.docs.slice(0, CASH_EVIDENCE_LIMITS.activeSessions).map(doc => [doc.id, doc]));
    for (let offset = 0; offset < sessionIds.length; offset += CASH_EVIDENCE_LIMITS.readBatchSize) {
      const refs = sessionIds.slice(offset, offset + CASH_EVIDENCE_LIMITS.readBatchSize).filter(id => !sessions.has(id)).map(id => db.collection("cashCountingSessions").doc(id));
      if (refs.length) for (const doc of await db.getAll(...refs, { fieldMask: SESSION_FIELDS })) sessions.set(doc.id, doc);
    }
    for (const doc of sessions.values()) {
      const data = doc.data();
      if (!doc.exists || data?.workspaceId !== WORKSPACE_ID) { result.gaps.push("Sessão ausente ou fora do escopo; recebimento não presumido."); continue; }
      const scopes = Array.isArray(data.scopes) ? data.scopes.filter((scope): scope is { kioskId: string; year: number; month: number } => !!scope && typeof scope.kioskId === "string" && Number.isInteger(scope.year) && Number.isInteger(scope.month)) : [];
      const counts = data.finalizedOperatorCountsByDate && typeof data.finalizedOperatorCountsByDate === "object" ? data.finalizedOperatorCountsByDate as Record<string, number> : {};
      result.sessions.push({ id: doc.id, workspaceId: WORKSPACE_ID, status: String(data.status ?? ""), kioskIds: strings(data.kioskIds), scopes,
        countedCashCents: Number(data.countedCashCents), noteTotalCents: Number(data.noteTotalCents), coinReturnedToTillCents: Number(data.coinReturnedToTillCents), coinPendingExchangeCents: Number(data.coinPendingExchangeCents), dreOnlyCashCents: Number(data.dreOnlyCashCents),
        batchIds: strings(data.batchIds), scopeAggregationVersion: data.scopeAggregationVersion === 1 ? 1 : null, finalizedOperatorCountsByDate: counts });
      if (strings(data.kioskIds).length !== 1) result.gaps.push("Sessão com várias unidades exige discriminação por unidade/data; estágios desses dias permanecem para conferir.");
    }
    for (let offset = 0; offset < billIds.length; offset += CASH_EVIDENCE_LIMITS.readBatchSize) {
      const refs = billIds.slice(offset, offset + CASH_EVIDENCE_LIMITS.readBatchSize).map(id => db.collection("interCobrancas").doc(id));
      for (const doc of await db.getAll(...refs, { fieldMask: BILL_FIELDS })) {
        const data = doc.data();
        if (!doc.exists || data?.workspaceId !== WORKSPACE_ID) { result.gaps.push("Cobrança ausente ou fora do escopo; liquidação não presumida."); continue; }
        result.bills.push({ id: doc.id, workspaceId: WORKSPACE_ID, batchId: String(data.batchId ?? ""), status: String(data.status ?? ""),
          situacao: typeof data.situacao === "string" ? data.situacao : null, origemRecebimento: typeof data.origemRecebimento === "string" ? data.origemRecebimento : null,
          recebidoManual: data.recebidoManual !== false, valorNominalCents: Number(data.valorNominalCents), valorTotalRecebidoCents: Number(data.valorTotalRecebidoCents) } satisfies StudyCashBill);
      }
    }
  } catch {
    result.gaps.push("Não foi possível completar a conferência das sessões e boletos; numerário pendente não foi transformado em entrada bancária.");
  }
  result.gaps = [...new Set(result.gaps)];
  return result;
}
