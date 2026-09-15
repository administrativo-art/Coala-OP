import "server-only";

import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";

import { serializeFinancialValue } from "@/features/financial/lib/server-access";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { prepareStoneFinancialImport } from "./ingestion.server";
import { stoneFinancialRunId } from "./identity.server";
import { assertStoneSettlementLink, StoneSettlementReconciliationError } from "./settlement-reconciliation";
import type { StoneReceivable, StoneReceivableStatus, StoneSettlement } from "./types";
import { stoneSaleTransactionId } from "@/features/financial/sales-reconciliation/identity.server";
import type { StoneSaleTransaction } from "@/features/financial/sales-reconciliation/types";
import {
  STONE_ANTICIPATION_ACCOUNT,
  STONE_MDR_ACCOUNT,
  stoneFeeExpenseFields,
  stoneFeeExpenseId,
  stoneReceivableFeeEffects,
} from "./fee-accounting";

export { StoneSettlementReconciliationError } from "./settlement-reconciliation";

const ROWS_PER_BATCH = 100;
const RUN_LEASE_MS = 5 * 60 * 1_000;

export class StoneFinancialConflictError extends Error {
  constructor(message = "A importação financeira Stone já está em andamento.") {
    super(message);
    this.name = "StoneFinancialConflictError";
  }
}

export class StoneFinancialAccessError extends Error {
  constructor(message = "O lote contém unidade fora do escopo permitido.") {
    super(message);
    this.name = "StoneFinancialAccessError";
  }
}

export class StoneFinancialAccountingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoneFinancialAccountingError";
  }
}

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

function validFeeAccount(snapshot: FirebaseFirestore.DocumentSnapshot, expectedName: string) {
  const data = snapshot.data() ?? {};
  return snapshot.exists
    && data.active !== false
    && data.isGroup !== true
    && data.is_dre_account !== false
    && data.dre_position === "despesas_financeiras"
    && String(data.name ?? "").trim() === expectedName;
}

async function prepareReceivableAccounting(rows: StoneReceivable[]) {
  const previousSnapshots = rows.length > 0
    ? await financialDbAdmin.getAll(...rows.map((row) => financialDbAdmin.collection("stoneReceivables").doc(row.id)))
    : [];
  const feeRows = rows.filter((row) => row.mdrAmountCents > 0 || row.anticipationFeeAmountCents > 0);
  const missingSaleReference = feeRows.find((row) => !row.externalSaleId);
  if (missingSaleReference) {
    throw new StoneFinancialAccountingError(`O recebível ${missingSaleReference.receivableKey} possui taxa sem vínculo com a venda de origem.`);
  }
  const saleReferences = [...new Set(feeRows.map((row) => row.externalSaleId as string))]
    .map((externalTransactionId) => financialDbAdmin.collection("stoneSaleTransactions").doc(stoneSaleTransactionId({
      workspaceId: rows[0]?.workspaceId ?? "",
      externalTransactionId,
    })));
  const [saleSnapshots, accountSnapshots] = await Promise.all([
    saleReferences.length > 0 ? financialDbAdmin.getAll(...saleReferences) : [],
    feeRows.length > 0 ? financialDbAdmin.getAll(
      financialDbAdmin.collection("accounts").doc(STONE_MDR_ACCOUNT.id),
      financialDbAdmin.collection("accounts").doc(STONE_ANTICIPATION_ACCOUNT.id),
    ) : [],
  ]);
  if (feeRows.some((row) => row.mdrAmountCents > 0) && !validFeeAccount(accountSnapshots[0], STONE_MDR_ACCOUNT.name)) {
    throw new StoneFinancialAccountingError(`A conta ${STONE_MDR_ACCOUNT.name} não atende ao contrato contábil esperado.`);
  }
  if (feeRows.some((row) => row.anticipationFeeAmountCents > 0) && !validFeeAccount(accountSnapshots[1], STONE_ANTICIPATION_ACCOUNT.name)) {
    throw new StoneFinancialAccountingError(`A conta ${STONE_ANTICIPATION_ACCOUNT.name} não atende ao contrato contábil esperado.`);
  }
  const saleByExternalId = new Map(saleSnapshots.flatMap((snapshot) => {
    if (!snapshot.exists) return [];
    const sale = { id: snapshot.id, ...snapshot.data() } as StoneSaleTransaction;
    return [[sale.externalTransactionId, sale] as const];
  }));
  const previousById = new Map(previousSnapshots.flatMap((snapshot) => snapshot.exists
    ? [[snapshot.id, { id: snapshot.id, ...snapshot.data() } as StoneReceivable] as const]
    : []));
  const enrichedRows = rows.map((row) => {
    if (row.mdrAmountCents <= 0 && row.anticipationFeeAmountCents <= 0) return row;
    const sale = saleByExternalId.get(row.externalSaleId as string);
    if (!sale || sale.workspaceId !== row.workspaceId) {
      throw new StoneFinancialAccountingError(`A venda de origem do recebível ${row.receivableKey} precisa ser importada antes das taxas.`);
    }
    if (!sale.kioskId) {
      throw new StoneFinancialAccountingError(`A venda de origem do recebível ${row.receivableKey} ainda não possui unidade canônica.`);
    }
    if (row.kioskId && row.kioskId !== sale.kioskId) {
      throw new StoneFinancialAccountingError(`O recebível ${row.receivableKey} diverge da unidade da venda de origem.`);
    }
    return { ...row, kioskId: sale.kioskId, kioskName: row.kioskName ?? sale.kioskName ?? null };
  });
  return { enrichedRows, saleByExternalId, previousById };
}

export async function importStoneFinancialBatch(raw: unknown, actor: {
  id: string;
  workspaceId: string;
  canAccessKiosk: (kioskId: string) => boolean;
}) {
  const prepared = prepareStoneFinancialImport(raw);
  if (prepared.workspaceId !== actor.workspaceId) throw new StoneFinancialAccessError("O workspace do lote não corresponde à sessão.");
  if (prepared.rows.some((row) => "kioskId" in row && row.kioskId && !actor.canAccessKiosk(row.kioskId))) {
    throw new StoneFinancialAccessError();
  }

  const runId = stoneFinancialRunId(prepared);
  const runRef = financialDbAdmin.collection("stoneIngestionRuns").doc(runId);
  const now = Timestamp.now();
  const started = await financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(runRef);
    const current = snapshot.data() ?? {};
    if (current.status === "completed") return { completed: true, result: current.result ?? null };
    const leaseUntil = typeof current.leaseUntil?.toMillis === "function" ? current.leaseUntil.toMillis() : 0;
    if (current.status === "processing" && leaseUntil > now.toMillis()) throw new StoneFinancialConflictError();
    transaction.set(runRef, {
      id: runId,
      workspaceId: prepared.workspaceId,
      source: prepared.source,
      rowCount: prepared.rows.length,
      duplicateCount: prepared.duplicateCount,
      actorId: actor.id,
      status: "processing",
      attemptCount: Number(current.attemptCount ?? 0) + 1,
      leaseUntil: Timestamp.fromMillis(now.toMillis() + RUN_LEASE_MS),
      createdAt: current.createdAt ?? now,
      updatedAt: now,
    }, { merge: true });
    return { completed: false, result: null };
  });
  if (started.completed) return { runId, idempotent: true, ...(started.result as object ?? {}) };

  try {
    const receivableAccounting = prepared.source === "stone_receivables"
      ? await prepareReceivableAccounting(prepared.rows as StoneReceivable[])
      : null;
    const rows = receivableAccounting?.enrichedRows ?? prepared.rows;
    if (rows.some((row) => "kioskId" in row && row.kioskId && !actor.canAccessKiosk(row.kioskId))) {
      throw new StoneFinancialAccessError();
    }
    const collection = prepared.source === "stone_receivables" ? "stoneReceivables" : "stoneSettlements";
    for (const page of chunks(rows, ROWS_PER_BATCH)) {
      const batch = financialDbAdmin.batch();
      for (const row of page) {
        const reference = financialDbAdmin.collection(collection).doc(row.id);
        batch.set(reference, { ...row, latestRunId: runId, updatedAt: Timestamp.now() }, { merge: true });
        batch.set(reference.collection("events").doc(row.sourceHash), row);
        if ("receivableKey" in row && receivableAccounting) {
          const sale = row.externalSaleId ? receivableAccounting.saleByExternalId.get(row.externalSaleId) : null;
          const previous = receivableAccounting.previousById.get(row.id);
          for (const fee of stoneReceivableFeeEffects(row)) {
            const previousAmount = fee.kind === "mdr"
              ? Number(previous?.mdrAmountCents ?? 0)
              : Number(previous?.anticipationFeeAmountCents ?? 0);
            const expenseRef = financialDbAdmin.collection("expenses").doc(stoneFeeExpenseId(row.id, fee.kind));
            if (fee.amountCents > 0 && sale) {
              batch.set(expenseRef, {
                ...stoneFeeExpenseFields({ receivable: row, sale, ...fee }),
                competenceDate: Timestamp.fromDate(new Date(`${sale.period}-01T12:00:00.000Z`)),
                latestRunId: runId,
                cancelledAt: null,
                cancelledBy: null,
                cancellationReason: null,
                ...(previousAmount <= 0 ? { createdAt: Timestamp.now(), createdBy: actor.id } : {}),
                updatedAt: Timestamp.now(),
                updatedBy: actor.id,
              }, { merge: true });
            } else if (previousAmount > 0) {
              batch.set(expenseRef, {
                status: "cancelled",
                cancellationReason: "A taxa deixou de existir na revisão do recebível Stone.",
                cancelledAt: Timestamp.now(),
                cancelledBy: actor.id,
                latestRunId: runId,
                updatedAt: Timestamp.now(),
                updatedBy: actor.id,
              }, { merge: true });
            }
          }
        }
      }
      await batch.commit();
    }
    const result = {
      importedCount: prepared.rows.length,
      duplicateCount: prepared.duplicateCount,
      source: prepared.source,
    };
    await runRef.set({ status: "completed", result, leaseUntil: null, completedAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
    return { runId, idempotent: false, ...result };
  } catch (error) {
    await runRef.set({ status: "failed", leaseUntil: null, failedAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true }).catch(() => undefined);
    throw error;
  }
}

function parseCursor(cursor: string | undefined) {
  if (!cursor) return null;
  const separator = cursor.indexOf("|");
  if (separator < 1) throw new StoneFinancialConflictError("O cursor da consulta é inválido.");
  const date = cursor.slice(0, separator);
  const id = cursor.slice(separator + 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !id) {
    throw new StoneFinancialConflictError("O cursor da consulta é inválido.");
  }
  return { date, id };
}

function parseSettlementCursor(cursor: string | undefined) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { date?: unknown; id?: unknown };
    if (typeof value.date !== "string" || typeof value.id !== "string" || !value.id) throw new Error("invalid");
    return { date: value.date, id: value.id };
  } catch {
    throw new StoneFinancialConflictError("O cursor da consulta é inválido.");
  }
}

function settlementCursor(date: string, id: string) {
  return Buffer.from(JSON.stringify({ date, id }), "utf8").toString("base64url");
}

function timestampDate(value: unknown) {
  if (typeof (value as { toDate?: unknown })?.toDate === "function") return (value as { toDate: () => Date }).toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  return null;
}

function civilDateInBelem(value: unknown) {
  const date = timestampDate(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function transactionAmountCents(data: Record<string, unknown>) {
  const direct = Number(data.amountCents);
  if (Number.isSafeInteger(direct)) return Math.abs(direct);
  const amount = Number(data.amount);
  return Number.isFinite(amount) ? Math.round(Math.abs(amount) * 100) : 0;
}

export async function listStoneReceivables(input: {
  workspaceId: string;
  from: string;
  to: string;
  kioskId?: string;
  status?: StoneReceivableStatus;
  cursor?: string;
  limit: number;
  canAccessKiosk: (kioskId: string) => boolean;
  canViewUnmapped: boolean;
}) {
  let query: FirebaseFirestore.Query = financialDbAdmin.collection("stoneReceivables")
    .where("workspaceId", "==", input.workspaceId)
    .where("currentExpectedDate", ">=", input.from)
    .where("currentExpectedDate", "<=", input.to);
  if (input.kioskId) query = query.where("kioskId", "==", input.kioskId);
  if (input.status) query = query.where("status", "==", input.status);
  query = query.orderBy("currentExpectedDate").orderBy(FieldPath.documentId());
  const cursor = parseCursor(input.cursor);
  if (cursor) query = query.startAfter(cursor.date, cursor.id);
  const snapshot = await query.limit(input.limit + 1).get();
  const hasMore = snapshot.size > input.limit;
  const documents = snapshot.docs.slice(0, input.limit);
  const receivables = documents
    .map((document) => ({ id: document.id, ...document.data() } as StoneReceivable))
    .filter((entry) => entry.kioskId ? input.canAccessKiosk(entry.kioskId) : input.canViewUnmapped);
  const last = documents.at(-1);
  return serializeFinancialValue({
    receivables,
    nextCursor: hasMore && last ? `${String(last.data().currentExpectedDate)}|${last.id}` : null,
  });
}

export async function listStoneSettlements(input: {
  workspaceId: string;
  from: string;
  to: string;
  cursor?: string;
  limit: number;
}) {
  const fromInstant = new Date(`${input.from}T03:00:00.000Z`).toISOString();
  const nextDay = new Date(`${input.to}T03:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  let query: FirebaseFirestore.Query = financialDbAdmin.collection("stoneSettlements")
    .where("workspaceId", "==", input.workspaceId)
    .where("settledAt", ">=", fromInstant)
    .where("settledAt", "<", nextDay.toISOString())
    .orderBy("settledAt")
    .orderBy(FieldPath.documentId());
  const cursor = parseSettlementCursor(input.cursor);
  if (cursor) query = query.startAfter(cursor.date, cursor.id);
  const snapshot = await query.limit(input.limit + 1).get();
  const hasMore = snapshot.size > input.limit;
  const documents = snapshot.docs.slice(0, input.limit);
  const last = documents.at(-1);
  return serializeFinancialValue({
    settlements: documents.map((document) => ({ id: document.id, ...document.data() } as StoneSettlement)),
    nextCursor: hasMore && last ? settlementCursor(String(last.data().settledAt), last.id) : null,
  });
}

export async function linkStoneSettlement(input: {
  workspaceId: string;
  settlementId: string;
  transactionId: string;
  reason: string;
  actor: { id: string; name: string | null; email: string | null };
}) {
  const settlementRef = financialDbAdmin.collection("stoneSettlements").doc(input.settlementId);
  const bankTransactionRef = financialDbAdmin.collection("transactions").doc(input.transactionId);
  return serializeFinancialValue(await financialDbAdmin.runTransaction(async (transaction) => {
    const [settlementSnapshot, bankTransactionSnapshot] = await Promise.all([
      transaction.get(settlementRef),
      transaction.get(bankTransactionRef),
    ]);
    if (!settlementSnapshot.exists) throw new StoneSettlementReconciliationError("SETTLEMENT_NOT_FOUND", "Liquidação Stone não encontrada.");
    if (!bankTransactionSnapshot.exists) throw new StoneSettlementReconciliationError("TRANSACTION_NOT_FOUND", "Transação bancária não encontrada.");
    const settlement = settlementSnapshot.data() as StoneSettlement;
    const bankTransaction = bankTransactionSnapshot.data() ?? {};
    if (settlement.linkedBankTransactionId === input.transactionId && bankTransaction.stoneSettlementId === input.settlementId) {
      return { idempotent: true, settlementId: input.settlementId, transactionId: input.transactionId };
    }
    if (settlement.linkedBankTransactionId) throw new StoneSettlementReconciliationError("SETTLEMENT_ALREADY_LINKED", "A liquidação já está vinculada a outra transação.");
    if (bankTransaction.stoneSettlementId) throw new StoneSettlementReconciliationError("TRANSACTION_ALREADY_LINKED", "A transação já está vinculada a outra liquidação Stone.");
    const bankDate = civilDateInBelem(bankTransaction.date);
    const settlementDate = civilDateInBelem(settlement.settledAt);
    assertStoneSettlementLink({
      workspaceId: input.workspaceId,
      settlementWorkspaceId: settlement.workspaceId,
      transactionWorkspaceId: typeof bankTransaction.workspaceId === "string" ? bankTransaction.workspaceId : null,
      settlementAccountId: settlement.accountId,
      transactionAccountId: String(bankTransaction.accountId || ""),
      settlementAmountCents: settlement.netAmountCents,
      transactionAmountCents: transactionAmountCents(bankTransaction),
      settlementDate,
      transactionDate: bankDate,
      transactionDirection: bankTransaction.direction,
      transactionReversed: bankTransaction.reversed === true || bankTransaction.auditStatus === "reversed",
    });
    const now = Timestamp.now();
    const audit = { actorId: input.actor.id, actorName: input.actor.name, actorEmail: input.actor.email, reason: input.reason, at: now };
    transaction.set(settlementRef, {
      linkedBankTransactionId: input.transactionId,
      linkedAt: now,
      linkedBy: input.actor,
      linkReason: input.reason,
      updatedAt: now,
    }, { merge: true });
    transaction.set(bankTransactionRef, {
      stoneSettlementId: input.settlementId,
      stoneSettlementExternalId: settlement.externalSettlementId,
      stoneSettlementReconciledAt: now,
      stoneSettlementReconciledBy: input.actor,
      reconciliationSource: "stone_settlement",
      updatedAt: now,
    }, { merge: true });
    transaction.set(settlementRef.collection("events").doc(), {
      type: "BANK_TRANSACTION_LINKED",
      settlementId: input.settlementId,
      bankTransactionId: input.transactionId,
      ...audit,
    });
    return { idempotent: false, settlementId: input.settlementId, transactionId: input.transactionId };
  }));
}

export async function unlinkStoneSettlement(input: {
  workspaceId: string;
  settlementId: string;
  expectedTransactionId?: string;
  reason: string;
  actor: { id: string; name: string | null; email: string | null };
}) {
  const settlementRef = financialDbAdmin.collection("stoneSettlements").doc(input.settlementId);
  return serializeFinancialValue(await financialDbAdmin.runTransaction(async (transaction) => {
    const settlementSnapshot = await transaction.get(settlementRef);
    if (!settlementSnapshot.exists) throw new StoneSettlementReconciliationError("SETTLEMENT_NOT_FOUND", "Liquidação Stone não encontrada.");
    const settlement = settlementSnapshot.data() as StoneSettlement;
    if (settlement.workspaceId !== input.workspaceId) throw new StoneSettlementReconciliationError("WORKSPACE_MISMATCH", "A liquidação não pertence ao workspace.");
    const linkedId = settlement.linkedBankTransactionId ?? null;
    if (!linkedId) return { idempotent: true, settlementId: input.settlementId, transactionId: null };
    if (input.expectedTransactionId && input.expectedTransactionId !== linkedId) {
      throw new StoneSettlementReconciliationError("SETTLEMENT_ALREADY_LINKED", "A liquidação está vinculada a outra transação.");
    }
    const bankTransactionRef = financialDbAdmin.collection("transactions").doc(linkedId);
    const bankTransactionSnapshot = await transaction.get(bankTransactionRef);
    const now = Timestamp.now();
    if (bankTransactionSnapshot.exists && bankTransactionSnapshot.get("stoneSettlementId") === input.settlementId) {
      transaction.set(bankTransactionRef, {
        stoneSettlementId: FieldValue.delete(),
        stoneSettlementExternalId: FieldValue.delete(),
        stoneSettlementReconciledAt: FieldValue.delete(),
        stoneSettlementReconciledBy: FieldValue.delete(),
        reconciliationSource: FieldValue.delete(),
        stoneSettlementUnlinkedAt: now,
        stoneSettlementUnlinkedBy: input.actor,
        updatedAt: now,
      }, { merge: true });
    }
    transaction.set(settlementRef, {
      linkedBankTransactionId: null,
      linkedAt: null,
      linkedBy: null,
      linkReason: null,
      unlinkedAt: now,
      unlinkedBy: input.actor,
      unlinkReason: input.reason,
      updatedAt: now,
    }, { merge: true });
    transaction.set(settlementRef.collection("events").doc(), {
      type: "BANK_TRANSACTION_UNLINKED",
      settlementId: input.settlementId,
      bankTransactionId: linkedId,
      actorId: input.actor.id,
      actorName: input.actor.name,
      actorEmail: input.actor.email,
      reason: input.reason,
      at: now,
    });
    return { idempotent: false, settlementId: input.settlementId, transactionId: linkedId };
  }));
}

export type { StoneReceivable, StoneSettlement };
