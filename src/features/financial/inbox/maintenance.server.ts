import { FieldPath } from "firebase-admin/firestore";

import {
  buildFinancialInboxSearchTerms,
  FINANCIAL_INBOX_SEARCH_INDEX_VERSION,
  FINANCIAL_INBOX_SEARCH_STATE_ID,
} from "./search-index";
import {
  financialInboxRetentionCutoff,
  financialInboxRetentionPlan,
  FINANCIAL_INBOX_RETENTION_POLICY_VERSION,
} from "./retention-policy";
import {
  FINANCIAL_INBOX_RESOLUTION_STATE_ID,
  FINANCIAL_INBOX_RESOLUTION_VERSION,
  resolutionForDisplay,
} from "./resolution-contract";
import type { FinancialInboxMessage } from "./types";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";

const COLLECTION = "financialInboxMessages";
const STATE_COLLECTION = "financialSystemState";
const DEFAULT_BATCH_SIZE = 300;
const MAX_BATCH_SIZE = 400;

function boundedBatchSize(value?: number) {
  return Math.max(1, Math.min(MAX_BATCH_SIZE, value ?? DEFAULT_BATCH_SIZE));
}

async function backfillSearchIndex(params: { dryRun: boolean; batchSize: number; now: Date }) {
  const stateRef = financialDbAdmin.collection(STATE_COLLECTION).doc(FINANCIAL_INBOX_SEARCH_STATE_ID);
  const state = await stateRef.get();
  if (state.get("complete") === true && state.get("version") === FINANCIAL_INBOX_SEARCH_INDEX_VERSION) {
    return { scanned: 0, indexed: 0, complete: true };
  }
  const cursor = typeof state.get("cursor") === "string" ? String(state.get("cursor")) : null;
  let query: FirebaseFirestore.Query = financialDbAdmin.collection(COLLECTION)
    .orderBy(FieldPath.documentId())
    .limit(params.batchSize);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const updates = snapshot.docs.filter((document) => document.get("searchIndexVersion") !== FINANCIAL_INBOX_SEARCH_INDEX_VERSION);
  const complete = snapshot.size < params.batchSize;
  if (!params.dryRun) {
    const batch = financialDbAdmin.batch();
    updates.forEach((document) => {
      const message = { id: document.id, ...document.data() } as FinancialInboxMessage;
      batch.set(document.ref, {
        searchTerms: buildFinancialInboxSearchTerms(message),
        searchIndexVersion: FINANCIAL_INBOX_SEARCH_INDEX_VERSION,
        searchIndexedAt: params.now.toISOString(),
      }, { merge: true });
    });
    batch.set(stateRef, {
      version: FINANCIAL_INBOX_SEARCH_INDEX_VERSION,
      cursor: complete ? null : snapshot.docs.at(-1)?.id ?? cursor,
      complete,
      lastRunAt: params.now.toISOString(),
      indexedInLastRun: updates.length,
    }, { merge: true });
    await batch.commit();
  }
  return { scanned: snapshot.size, indexed: updates.length, complete };
}

async function backfillResolutionContract(params: { dryRun: boolean; batchSize: number; now: Date }) {
  // Migração única, paginada e idempotente: até 300 leituras/escritas por execução
  // com o lote padrão. Depois de concluída, custa apenas a leitura do documento de estado.
  const stateRef = financialDbAdmin.collection(STATE_COLLECTION).doc(FINANCIAL_INBOX_RESOLUTION_STATE_ID);
  const state = await stateRef.get();
  if (state.get("complete") === true && state.get("version") === FINANCIAL_INBOX_RESOLUTION_VERSION) {
    return { scanned: 0, updated: 0, complete: true };
  }
  const cursor = typeof state.get("cursor") === "string" ? String(state.get("cursor")) : null;
  let query: FirebaseFirestore.Query = financialDbAdmin.collection(COLLECTION)
    .orderBy(FieldPath.documentId())
    .limit(params.batchSize);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const updates = snapshot.docs.filter((document) => (
    document.get("resolutionContractVersion") !== FINANCIAL_INBOX_RESOLUTION_VERSION
    || (document.get("status") === "ignored" && !document.get("resolution.mode"))
  ));
  const complete = snapshot.size < params.batchSize;
  let appliedUpdates = updates.length;
  if (!params.dryRun) {
    const result = await financialDbAdmin.runTransaction(async (transaction) => {
      const currentState = await transaction.get(stateRef);
      const currentCursor = typeof currentState.get("cursor") === "string"
        ? String(currentState.get("cursor")) : null;
      if (currentCursor !== cursor) return { applied: false, updated: 0 };
      const currentSnapshots = updates.length
        ? await transaction.getAll(...updates.map((document) => document.ref))
        : [];
      let updated = 0;
      currentSnapshots.forEach((document) => {
        if (!document.exists || (document.get("resolutionContractVersion") === FINANCIAL_INBOX_RESOLUTION_VERSION
          && !(document.get("status") === "ignored" && !document.get("resolution.mode")))) return;
        const message = { id: document.id, ...document.data() } as FinancialInboxMessage;
        transaction.set(document.ref, {
          resolution: resolutionForDisplay(message),
          resolutionContractVersion: FINANCIAL_INBOX_RESOLUTION_VERSION,
          updatedAt: message.updatedAt,
        }, { merge: true });
        updated += 1;
      });
      transaction.set(stateRef, {
        version: FINANCIAL_INBOX_RESOLUTION_VERSION,
        cursor: complete ? null : snapshot.docs.at(-1)?.id ?? cursor,
        complete,
        lastRunAt: params.now.toISOString(),
        updatedInLastRun: updated,
      }, { merge: true });
      return { applied: true, updated };
    });
    if (!result.applied) return { scanned: 0, updated: 0, complete: false };
    appliedUpdates = result.updated;
  }
  return { scanned: snapshot.size, updated: appliedUpdates, complete };
}

async function archiveTreatedMessages(params: { dryRun: boolean; batchSize: number; now: Date }) {
  const cutoff = financialInboxRetentionCutoff(params.now).toISOString();
  const archiveBatchSize = Math.min(params.batchSize, 200);
  const stateRef = financialDbAdmin.collection(STATE_COLLECTION).doc("financial-inbox-retention-cursor-v2");
  const state = await stateRef.get();
  const storedCursor = state.get("cursor");
  const cursor = storedCursor && typeof storedCursor.updatedAt === "string" && typeof storedCursor.id === "string"
    ? { updatedAt: storedCursor.updatedAt as string, id: storedCursor.id as string } : null;
  let query = financialDbAdmin.collection(COLLECTION)
    .where("status", "in", ["ignored", "identified", "reconciled"])
    .where("updatedAt", "<=", cutoff)
    .orderBy("updatedAt", "asc")
    .orderBy(FieldPath.documentId(), "asc")
    .limit(archiveBatchSize);
  if (cursor) query = query.startAfter(cursor.updatedAt, cursor.id);
  const snapshot = await query.get();
  const last = snapshot.docs.at(-1);
  const nextCursor = snapshot.size < archiveBatchSize || !last
    ? null : { updatedAt: String(last.get("updatedAt")), id: last.id };
  let archived = 0;
  if (!params.dryRun && snapshot.size === 0 && cursor) {
    await stateRef.set({ cursor: null, updatedAt: params.now.toISOString() }, { merge: true });
  }
  if (!params.dryRun && snapshot.size > 0) {
    archived = await financialDbAdmin.runTransaction(async (transaction) => {
      const currentState = await transaction.get(stateRef);
      const currentCursor = currentState.get("cursor");
      if ((currentCursor?.updatedAt ?? null) !== (cursor?.updatedAt ?? null)
        || (currentCursor?.id ?? null) !== (cursor?.id ?? null)) return 0;
      const currentSnapshots = await transaction.getAll(...snapshot.docs.map((document) => document.ref));
      let currentArchived = 0;
      currentSnapshots.forEach((current) => {
        const status = current.get("status");
        const updatedAt = String(current.get("updatedAt") || "");
        if (!current.exists || !["ignored", "identified", "reconciled"].includes(status) || !updatedAt || updatedAt > cutoff) return;
        const message = { id: current.id, ...current.data() } as FinancialInboxMessage;
        const plan = financialInboxRetentionPlan(message, params.now);
        if (!plan) return;
        const eventRef = current.ref.collection("events").doc();
        currentArchived += 1;
        const resolution = resolutionForDisplay(message);
        transaction.set(current.ref, {
          status: "archived",
          resolution: { ...resolution, status: "archived" },
          resolutionContractVersion: FINANCIAL_INBOX_RESOLUTION_VERSION,
          archivedAt: params.now.toISOString(),
          archivedBy: "system:financial-inbox-retention",
          archivedFromStatus: plan.archivedFromStatus,
          retentionClass: plan.retentionClass,
          purgeEligibleAt: plan.purgeEligibleAt,
          retentionPolicyVersion: FINANCIAL_INBOX_RETENTION_POLICY_VERSION,
          updatedAt: params.now.toISOString(),
        }, { merge: true });
        transaction.create(eventRef, {
          type: "MESSAGE_ARCHIVED_BY_RETENTION",
          at: params.now.toISOString(),
          actorId: "system:financial-inbox-retention",
          previousStatus: plan.archivedFromStatus,
          retentionClass: plan.retentionClass,
          policyVersion: FINANCIAL_INBOX_RETENTION_POLICY_VERSION,
        });
      });
      transaction.set(stateRef, { cursor: nextCursor, updatedAt: params.now.toISOString() }, { merge: true });
      return currentArchived;
    });
  }
  return {
    cutoff,
    eligible: snapshot.size,
    archived,
  };
}

export async function maintainFinancialInbox(params: {
  dryRun?: boolean;
  batchSize?: number;
  now?: Date;
} = {}) {
  const now = params.now ?? new Date();
  const batchSize = boundedBatchSize(params.batchSize);
  const dryRun = params.dryRun !== false;
  const searchIndex = await backfillSearchIndex({ dryRun, batchSize, now });
  const resolutionContract = await backfillResolutionContract({ dryRun, batchSize, now });
  const retention = await archiveTreatedMessages({ dryRun, batchSize, now });
  return {
    mode: dryRun ? "dry-run" : "execute",
    policyVersion: FINANCIAL_INBOX_RETENTION_POLICY_VERSION,
    searchIndex,
    resolutionContract,
    retention,
    generatedAt: now.toISOString(),
  };
}
