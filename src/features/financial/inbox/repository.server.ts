import { AggregateField, FieldPath } from "firebase-admin/firestore";

import {
  FINANCIAL_INBOX_STAGES,
  FINANCIAL_INBOX_STAGE_STATUSES,
  FINANCIAL_INBOX_IDENTIFIED_STATUSES,
  FINANCIAL_INBOX_WORK_STATUSES,
  financialInboxStageForStatus,
  isFinancialInboxBulkDiscardEligible,
  matchesFinancialInboxSearch,
} from "./presentation";
import {
  financialInboxSearchLookupToken,
  FINANCIAL_INBOX_SEARCH_INDEX_VERSION,
  FINANCIAL_INBOX_SEARCH_STATE_ID,
} from "./search-index";
import type {
  FinancialInboxMessage,
  FinancialInboxFinancialState,
  FinancialInboxResolutionKind,
  FinancialInboxStage,
  FinancialInboxStatus,
  FinancialInboxSummary,
  FinancialInboxView,
} from "./types";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { serializeFinancialValue } from "@/features/financial/lib/server-access";
import {
  discardedFinancialInboxResolution,
  FINANCIAL_INBOX_RESOLUTION_VERSION,
  pendingFinancialInboxResolution,
} from "./resolution-contract";

const COLLECTION = "financialInboxMessages";
const SEARCH_SCAN_LIMIT = 500;
const SUMMARY_FALLBACK_LIMIT = 500;
// Cada abertura, troca de aba ou filtro lê no máximo pageSize + 1 mensagens
// (26 no cliente atual), além dos agregados já existentes. Não há polling.
// A busca sem índice mantém o fallback legado limitado a 501 documentos.
const ACTIVE_STATUSES: FinancialInboxStatus[] = [
  "pending_review", "document_pending", "suggestion_available", "under_review", "identified", "linked",
  "awaiting_authorization", "scheduled", "awaiting_statement", "reconciled", "divergent", "ignored", "error",
];
const FILTER_STATUSES = new Set<FinancialInboxStatus>([...ACTIVE_STATUSES, "archived"]);
const RESOLUTION_KINDS = new Set<FinancialInboxResolutionKind>([
  "new_charge", "reminder", "duplicate", "forecast_confirmation", "non_financial",
]);
const FINANCIAL_STATES = new Set<FinancialInboxFinancialState>([
  "forecast", "open", "payment_prepared", "scheduled", "reconciled",
]);

export class FinancialInboxReviewError extends Error {
  constructor(readonly code: "EMPTY_SELECTION" | "NOT_FOUND" | "STATE_CONFLICT") {
    super(code === "EMPTY_SELECTION"
      ? "Selecione ao menos uma mensagem."
      : code === "NOT_FOUND"
        ? "Mensagem financeira não encontrada."
        : "A cobrança não pode ser descartada ou reaberta neste estado.");
    this.name = "FinancialInboxReviewError";
  }
}

function encodeCursor(receivedAt: string, id: string) {
  return Buffer.from(JSON.stringify([receivedAt, id]), "utf8").toString("base64url");
}

function decodeCursor(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some((entry) => typeof entry !== "string")) return null;
    return { receivedAt: parsed[0] as string, id: parsed[1] as string };
  } catch {
    return null;
  }
}

function encodeSearchCursor(key: string, offset: number) {
  return Buffer.from(JSON.stringify(["search", key, offset]), "utf8").toString("base64url");
}

function decodeSearchCursor(value: string | null, key: string) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return Array.isArray(parsed)
      && parsed[0] === "search"
      && parsed[1] === key
      && Number.isInteger(parsed[2])
      && parsed[2] >= 0
      ? Number(parsed[2])
      : 0;
  } catch {
    return 0;
  }
}

function stageFrom(value: string | null | undefined): FinancialInboxStage | null {
  return FINANCIAL_INBOX_STAGES.includes(value as FinancialInboxStage) ? value as FinancialInboxStage : null;
}

function viewFrom(value: string | null | undefined): FinancialInboxView {
  return value === "identified" ? "identified" : "work";
}

function resolutionKindFrom(value: string | null | undefined): FinancialInboxResolutionKind | null {
  return RESOLUTION_KINDS.has(value as FinancialInboxResolutionKind) ? value as FinancialInboxResolutionKind : null;
}

function financialStateFrom(value: string | null | undefined): FinancialInboxFinancialState | null {
  return FINANCIAL_STATES.has(value as FinancialInboxFinancialState) ? value as FinancialInboxFinancialState : null;
}

function scopedInboxQuery(params: {
  workspaceId: string;
  status: FinancialInboxStatus | null;
  stage: FinancialInboxStage | null;
  view: FinancialInboxView;
  resolutionKind: FinancialInboxResolutionKind | null;
  financialState: FinancialInboxFinancialState | null;
}) {
  let query: FirebaseFirestore.Query = financialDbAdmin.collection(COLLECTION).where("workspaceId", "==", params.workspaceId);
  if (params.status) query = query.where("status", "==", params.status);
  else if (params.resolutionKind) {
    query = query
      .where("resolution.status", "==", "identified")
      .where("resolution.kind", "==", params.resolutionKind);
  } else if (params.financialState) {
    query = query
      .where("resolution.status", "==", "identified")
      .where("resolution.financialState", "==", params.financialState);
  } else if (params.stage) query = query.where("status", "in", FINANCIAL_INBOX_STAGE_STATUSES[params.stage]);
  else query = query.where("status", "in", params.view === "identified"
    ? FINANCIAL_INBOX_IDENTIFIED_STATUSES
    : FINANCIAL_INBOX_WORK_STATUSES);
  return query;
}

async function summarizeFinancialInboxFromDocuments(workspaceId: string): Promise<FinancialInboxSummary> {
  const snapshot = await financialDbAdmin.collection(COLLECTION)
    .where("workspaceId", "==", workspaceId)
    .where("status", "in", [...ACTIVE_STATUSES, "archived"])
    .limit(SUMMARY_FALLBACK_LIMIT + 1)
    .get();
  if (snapshot.size > SUMMARY_FALLBACK_LIMIT) {
    throw new Error("FINANCIAL_INBOX_SUMMARY_FALLBACK_LIMIT_EXCEEDED");
  }
  const stages = Object.fromEntries(FINANCIAL_INBOX_STAGES.map((stage) => [
    stage,
    { count: 0, amountCents: 0 },
  ])) as FinancialInboxSummary["stages"];
  snapshot.docs.forEach((document) => {
    const status = document.get("status") as FinancialInboxStatus;
    if (!FILTER_STATUSES.has(status)) return;
    const stage = financialInboxStageForStatus(status);
    stages[stage].count += 1;
    stages[stage].amountCents += Number(document.get("classification.amountCents") || 0);
  });
  const total = FINANCIAL_INBOX_STAGES.filter((stage) => stage !== "archive").reduce((result, stage) => ({
    count: result.count + stages[stage].count,
    amountCents: result.amountCents + stages[stage].amountCents,
  }), { count: 0, amountCents: 0 });
  return { total, stages, generatedAt: new Date().toISOString() };
}

function isMissingFirestoreIndex(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && Number(error.code) === 9;
}

async function summarizeFinancialInbox(workspaceId: string): Promise<FinancialInboxSummary> {
  try {
    const entries = await Promise.all(FINANCIAL_INBOX_STAGES.map(async (stage) => {
      const snapshot = await financialDbAdmin.collection(COLLECTION)
        .where("workspaceId", "==", workspaceId)
        .where("status", "in", FINANCIAL_INBOX_STAGE_STATUSES[stage])
        .aggregate({
          count: AggregateField.count(),
          amountCents: AggregateField.sum("classification.amountCents"),
        })
        .get();
      const data = snapshot.data();
      return [stage, {
        count: Number(data.count || 0),
        amountCents: Number(data.amountCents || 0),
      }] as const;
    }));
    const stages = Object.fromEntries(entries) as FinancialInboxSummary["stages"];
    const total = entries.filter(([stage]) => stage !== "archive").reduce((result, [, value]) => ({
      count: result.count + value.count,
      amountCents: result.amountCents + value.amountCents,
    }), { count: 0, amountCents: 0 });
    return { total, stages, generatedAt: new Date().toISOString() };
  } catch (error) {
    if (!isMissingFirestoreIndex(error)) throw error;
    return summarizeFinancialInboxFromDocuments(workspaceId);
  }
}

async function financialInboxSearchIndexReady() {
  const snapshot = await financialDbAdmin.collection("financialSystemState").doc(FINANCIAL_INBOX_SEARCH_STATE_ID).get();
  return snapshot.exists
    && snapshot.get("version") === FINANCIAL_INBOX_SEARCH_INDEX_VERSION
    && snapshot.get("complete") === true;
}

async function listIndexedFinancialInboxSearch(params: {
  query: FirebaseFirestore.Query;
  search: string;
  pageSize: number;
  cursor: string | null;
}) {
  const lookupToken = financialInboxSearchLookupToken(params.search);
  if (!lookupToken) return { messages: [], nextCursor: null, searchTruncated: false, searchIndexed: true };
  const baseQuery = params.query
    .where("searchTerms", "array-contains", lookupToken)
    .orderBy("receivedAt", "desc")
    .orderBy(FieldPath.documentId(), "desc");
  let scanCursor = decodeCursor(params.cursor);
  let scanned = 0;
  let reachedEnd = false;
  const matches: Array<{ document: FirebaseFirestore.QueryDocumentSnapshot; message: FinancialInboxMessage }> = [];
  while (matches.length <= params.pageSize && scanned < SEARCH_SCAN_LIMIT) {
    const candidateLimit = Math.min(100, SEARCH_SCAN_LIMIT - scanned);
    let candidateQuery = baseQuery.limit(candidateLimit);
    if (scanCursor) candidateQuery = candidateQuery.startAfter(scanCursor.receivedAt, scanCursor.id);
    const snapshot = await candidateQuery.get();
    if (snapshot.empty) {
      reachedEnd = true;
      break;
    }
    for (const document of snapshot.docs) {
      scanCursor = { receivedAt: String(document.get("receivedAt")), id: document.id };
      scanned += 1;
      const message = {
        id: document.id,
        ...serializeFinancialValue(document.data()) as Omit<FinancialInboxMessage, "id">,
      };
      if (matchesFinancialInboxSearch(message, params.search)) matches.push({ document, message });
      if (matches.length > params.pageSize || scanned >= SEARCH_SCAN_LIMIT) break;
    }
    if (matches.length > params.pageSize || scanned >= SEARCH_SCAN_LIMIT) break;
    if (snapshot.size < candidateLimit) {
      reachedEnd = true;
      break;
    }
  }
  const visible = matches.slice(0, params.pageSize);
  const lastVisible = visible.at(-1)?.document;
  const hasMore = matches.length > params.pageSize || !reachedEnd;
  const nextCursor = hasMore
    ? lastVisible
      ? encodeCursor(String(lastVisible.get("receivedAt")), lastVisible.id)
      : scanCursor
        ? encodeCursor(scanCursor.receivedAt, scanCursor.id)
        : null
    : null;
  return {
    messages: visible.map((match) => match.message),
    nextCursor,
    searchTruncated: false,
    searchIndexed: true,
  };
}

export async function listFinancialInboxMessages(params: {
  workspaceId: string;
  view?: string | null;
  status?: string | null;
  stage?: string | null;
  resolutionKind?: string | null;
  financialState?: string | null;
  search?: string | null;
  limit?: number;
  cursor?: string | null;
}) {
  const pageSize = Math.max(1, Math.min(50, params.limit || 25));
  const status = params.status && FILTER_STATUSES.has(params.status as FinancialInboxStatus)
    ? params.status as FinancialInboxStatus
    : null;
  const stage = status ? null : stageFrom(params.stage);
  const view = viewFrom(params.view);
  const resolutionKind = status || stage ? null : resolutionKindFrom(params.resolutionKind);
  const financialState = status || stage || resolutionKind ? null : financialStateFrom(params.financialState);
  const search = String(params.search ?? "").trim().slice(0, 120);
  const summaryPromise = summarizeFinancialInbox(params.workspaceId);
  let query = scopedInboxQuery({
    workspaceId: params.workspaceId,
    status,
    stage,
    view,
    resolutionKind,
    financialState,
  });
  if (search) {
    const indexReady = await financialInboxSearchIndexReady().catch(() => false);
    if (indexReady) {
      try {
        return {
          ...await listIndexedFinancialInboxSearch({ query, search, pageSize, cursor: params.cursor ?? null }),
          summary: await summaryPromise,
        };
      } catch {
        // Durante a construção inicial do índice composto, a busca limitada
        // continua disponível até o Firestore liberar o índice novo.
      }
    }
    query = query.orderBy("receivedAt", "desc").orderBy(FieldPath.documentId(), "desc");
    const snapshot = await query.limit(SEARCH_SCAN_LIMIT + 1).get();
    const searchKey = `${view}:${stage ?? status ?? resolutionKind ?? financialState ?? "all"}:${search.toLocaleLowerCase("pt-BR")}`;
    const offset = decodeSearchCursor(params.cursor ?? null, searchKey);
    const matched = snapshot.docs.slice(0, SEARCH_SCAN_LIMIT)
      .map((document) => ({
        id: document.id,
        ...serializeFinancialValue(document.data()) as Omit<FinancialInboxMessage, "id">,
      }))
      .filter((message) => matchesFinancialInboxSearch(message, search));
    const messages = matched.slice(offset, offset + pageSize);
    const nextOffset = offset + messages.length;
    return {
      messages,
      nextCursor: nextOffset < matched.length ? encodeSearchCursor(searchKey, nextOffset) : null,
      searchTruncated: snapshot.size > SEARCH_SCAN_LIMIT,
      searchIndexed: false,
      summary: await summaryPromise,
    };
  }
  query = query.orderBy("receivedAt", "desc").orderBy(FieldPath.documentId(), "desc");
  const cursor = decodeCursor(params.cursor ?? null);
  if (cursor) query = query.startAfter(cursor.receivedAt, cursor.id);
  const snapshot = await query.limit(pageSize + 1).get();
  const hasMore = snapshot.size > pageSize;
  const documents = snapshot.docs.slice(0, pageSize);
  const last = documents.at(-1);
  return {
    messages: documents.map((document) => ({
      id: document.id,
      ...serializeFinancialValue(document.data()) as Omit<FinancialInboxMessage, "id">,
    })),
    nextCursor: hasMore && last ? encodeCursor(String(last.get("receivedAt")), last.id) : null,
    searchTruncated: false,
    searchIndexed: null,
    summary: await summaryPromise,
  };
}

export async function getFinancialInboxMessage(id: string) {
  const snapshot = await financialDbAdmin.collection(COLLECTION).doc(id).get();
  if (!snapshot.exists) throw new Error("Mensagem financeira não encontrada.");
  return { id: snapshot.id, ...snapshot.data() } as FinancialInboxMessage;
}

export async function reviewFinancialInboxMessage(params: {
  id: string;
  status: "pending_review" | "ignored";
  workspaceId: string;
  actorId: string;
  actorEmail?: string | null;
}) {
  await reviewFinancialInboxMessages({ ...params, ids: [params.id] });
  return getFinancialInboxMessage(params.id);
}

export async function restoreArchivedFinancialInboxMessage(params: {
  id: string;
  workspaceId: string;
  actorId: string;
  actorEmail?: string | null;
}) {
  const reference = financialDbAdmin.collection(COLLECTION).doc(params.id);
  const now = new Date().toISOString();
  await financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists || snapshot.get("workspaceId") !== params.workspaceId) {
      throw new FinancialInboxReviewError("NOT_FOUND");
    }
    if (snapshot.get("status") !== "archived" || !["ignored", "identified", "reconciled"].includes(snapshot.get("archivedFromStatus"))) {
      throw new FinancialInboxReviewError("STATE_CONFLICT");
    }
    const restoredStatus = snapshot.get("archivedFromStatus") as "ignored" | "identified" | "reconciled";
    transaction.set(reference, {
      status: restoredStatus,
      "resolution.status": restoredStatus === "ignored" ? "discarded" : "identified",
      resolutionContractVersion: FINANCIAL_INBOX_RESOLUTION_VERSION,
      archivedAt: null,
      archivedBy: null,
      archivedFromStatus: null,
      retentionClass: null,
      purgeEligibleAt: null,
      retentionPolicyVersion: null,
      updatedAt: now,
    }, { merge: true });
    transaction.create(reference.collection("events").doc(), {
      type: "MESSAGE_RESTORED_FROM_ARCHIVE",
      at: now,
      actorId: params.actorId,
      actorEmail: params.actorEmail ?? null,
      restoredStatus,
    });
  });
  return getFinancialInboxMessage(params.id);
}

export async function reviewFinancialInboxMessages(params: {
  ids: string[];
  status: "pending_review" | "ignored";
  workspaceId: string;
  actorId: string;
  actorEmail?: string | null;
}) {
  const ids = [...new Set(params.ids)].slice(0, 50);
  if (ids.length === 0) throw new FinancialInboxReviewError("EMPTY_SELECTION");
  const references = ids.map((id) => financialDbAdmin.collection(COLLECTION).doc(id));
  const eventReferences = references.map((reference) => reference.collection("events").doc());
  const now = new Date().toISOString();
  await financialDbAdmin.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(...references);
    snapshots.forEach((snapshot) => {
      if (!snapshot.exists || snapshot.get("workspaceId") !== params.workspaceId) {
        throw new FinancialInboxReviewError("NOT_FOUND");
      }
      if (params.status === "ignored" && !isFinancialInboxBulkDiscardEligible({
        status: snapshot.get("status") as FinancialInboxStatus,
        linkedExpenseId: snapshot.get("linkedExpenseId") || null,
        paymentRequestId: snapshot.get("paymentRequestId") || null,
      })) {
        throw new FinancialInboxReviewError("STATE_CONFLICT");
      }
      if (params.status === "pending_review" && snapshot.get("status") !== "ignored") {
        throw new FinancialInboxReviewError("STATE_CONFLICT");
      }
    });
    snapshots.forEach((snapshot, index) => {
      transaction.set(references[index], {
        status: params.status,
        resolution: params.status === "ignored"
          ? discardedFinancialInboxResolution({
              mode: "manual",
              at: now,
              by: params.actorId,
              reasons: ["mensagem descartada após revisão"],
            })
          : pendingFinancialInboxResolution(),
        resolutionContractVersion: FINANCIAL_INBOX_RESOLUTION_VERSION,
        reviewedAt: now,
        reviewedBy: params.actorId,
        updatedAt: now,
      }, { merge: true });
      transaction.create(eventReferences[index], {
        type: params.status === "ignored" ? "MESSAGE_IGNORED" : "MESSAGE_REOPENED",
        at: now,
        actorId: params.actorId,
        actorEmail: params.actorEmail ?? null,
        batchSize: ids.length,
      });
    });
  });
  return { updated: ids.length };
}
