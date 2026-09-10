import { AggregateField, FieldPath } from "firebase-admin/firestore";

import {
  FINANCIAL_INBOX_STAGES,
  FINANCIAL_INBOX_STAGE_STATUSES,
  isFinancialInboxBulkDiscardEligible,
  matchesFinancialInboxSearch,
} from "./presentation";
import type {
  FinancialInboxMessage,
  FinancialInboxStage,
  FinancialInboxStatus,
  FinancialInboxSummary,
} from "./types";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { serializeFinancialValue } from "@/features/financial/lib/server-access";

const COLLECTION = "financialInboxMessages";
const SEARCH_SCAN_LIMIT = 500;
const LIST_STATUSES = new Set<FinancialInboxStatus>([
  "pending_review", "document_pending", "suggestion_available", "under_review", "linked",
  "awaiting_authorization", "scheduled", "awaiting_statement", "reconciled", "divergent", "ignored", "error",
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

function scopedInboxQuery(workspaceId: string, status: FinancialInboxStatus | null, stage: FinancialInboxStage | null) {
  let query: FirebaseFirestore.Query = financialDbAdmin.collection(COLLECTION).where("workspaceId", "==", workspaceId);
  if (status) query = query.where("status", "==", status);
  else if (stage) query = query.where("status", "in", FINANCIAL_INBOX_STAGE_STATUSES[stage]);
  return query;
}

async function summarizeFinancialInbox(workspaceId: string): Promise<FinancialInboxSummary> {
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
  const total = entries.reduce((result, [, value]) => ({
    count: result.count + value.count,
    amountCents: result.amountCents + value.amountCents,
  }), { count: 0, amountCents: 0 });
  return { total, stages, generatedAt: new Date().toISOString() };
}

export async function listFinancialInboxMessages(params: {
  workspaceId: string;
  status?: string | null;
  stage?: string | null;
  search?: string | null;
  limit?: number;
  cursor?: string | null;
}) {
  const pageSize = Math.max(1, Math.min(50, params.limit || 25));
  const status = params.status && LIST_STATUSES.has(params.status as FinancialInboxStatus)
    ? params.status as FinancialInboxStatus
    : null;
  const stage = status ? null : stageFrom(params.stage);
  const search = String(params.search ?? "").trim().slice(0, 120);
  const summaryPromise = summarizeFinancialInbox(params.workspaceId);
  let query = scopedInboxQuery(params.workspaceId, status, stage);
  query = query.orderBy("receivedAt", "desc").orderBy(FieldPath.documentId(), "desc");
  if (search) {
    const snapshot = await query.limit(SEARCH_SCAN_LIMIT + 1).get();
    const searchKey = `${stage ?? status ?? "all"}:${search.toLocaleLowerCase("pt-BR")}`;
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
      summary: await summaryPromise,
    };
  }
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
