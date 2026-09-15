import "server-only";

import { FieldPath, Timestamp } from "firebase-admin/firestore";

import { serializeFinancialValue } from "@/features/financial/lib/server-access";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { prepareStoneFinancialImport } from "./ingestion.server";
import { stoneFinancialRunId } from "./identity.server";
import type { StoneReceivable, StoneReceivableStatus, StoneSettlement } from "./types";

const ROWS_PER_BATCH = 200;
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

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
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
    const collection = prepared.source === "stone_receivables" ? "stoneReceivables" : "stoneSettlements";
    for (const page of chunks(prepared.rows, ROWS_PER_BATCH)) {
      const batch = financialDbAdmin.batch();
      for (const row of page) {
        const reference = financialDbAdmin.collection(collection).doc(row.id);
        batch.set(reference, { ...row, latestRunId: runId, updatedAt: Timestamp.now() }, { merge: true });
        batch.set(reference.collection("events").doc(row.sourceHash), row);
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

export type { StoneReceivable, StoneSettlement };
