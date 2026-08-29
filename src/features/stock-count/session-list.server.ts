import "server-only";

import { FieldPath } from "firebase-admin/firestore";

import { dbAdmin } from "@/lib/firebase-admin";
import type { StockAuditSession } from "@/types";
import {
  STOCK_COUNT_SESSION_MAX_UNIT_FILTERS,
  type StockCountSessionSummary,
} from "./lib/visibility";

type SessionStatus = StockAuditSession["status"];
type SessionCursor = { startedAt: string; id: string };

type ListParams = {
  workspaceId: string;
  unitIds: string[] | null;
  status?: SessionStatus;
  fromIso?: string;
  toIso?: string;
  cursor?: SessionCursor;
  pageSize: number;
  includeItems: boolean;
};

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function isoString(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toDate" in value) {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate === "function") return (toDate.call(value) as Date).toISOString();
  }
  return "";
}

function toSession(
  document: FirebaseFirestore.QueryDocumentSnapshot,
  includeItems: boolean,
): StockAuditSession | StockCountSessionSummary {
  const data = document.data() as Partial<StockAuditSession> & Record<string, unknown>;
  const common: StockCountSessionSummary = {
    id: document.id,
    kioskId: String(data.kioskId ?? ""),
    kioskName: String(data.kioskName ?? data.kioskId ?? ""),
    status: data.status === "completed" ? "completed" : "pending_review",
    auditedBy: {
      userId: String(data.auditedBy?.userId ?? ""),
      username: String(data.auditedBy?.username ?? ""),
    },
    startedAt: isoString(data.startedAt),
    ...(data.completedAt ? { completedAt: isoString(data.completedAt) } : {}),
    ...(typeof data.taskId === "string" ? { taskId: data.taskId } : {}),
    ...(typeof data.workspaceId === "string" ? { workspaceId: data.workspaceId } : {}),
  };
  if (!includeItems) return common;
  return {
    ...common,
    items: Array.isArray(data.items) ? data.items : [],
  };
}

function compareSessions(
  left: StockAuditSession | StockCountSessionSummary,
  right: StockAuditSession | StockCountSessionSummary,
) {
  return right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id);
}

export async function listStockCountSessions(params: ListParams) {
  if (params.unitIds && params.unitIds.length === 0) {
    return { sessions: [], nextCursor: null, hasMore: false, readCeiling: 0 };
  }
  if (params.unitIds && params.unitIds.length > STOCK_COUNT_SESSION_MAX_UNIT_FILTERS) {
    throw new Error("O perfil possui unidades demais para esta consulta; reduza o escopo antes de continuar.");
  }

  const unitChunks = params.unitIds ? chunks(params.unitIds, 30) : [null];
  const snapshots = await Promise.all(unitChunks.map(async (unitIds) => {
    let query: FirebaseFirestore.Query = dbAdmin
      .collection("stockAuditSessions")
      .where("workspaceId", "==", params.workspaceId);
    if (params.status) query = query.where("status", "==", params.status);
    if (unitIds) query = query.where("kioskId", "in", unitIds);
    if (params.fromIso) query = query.where("startedAt", ">=", params.fromIso);
    if (params.toIso) query = query.where("startedAt", "<=", params.toIso);
    query = query
      .orderBy("startedAt", "desc")
      .orderBy(FieldPath.documentId(), "desc");
    if (params.cursor) query = query.startAfter(params.cursor.startedAt, params.cursor.id);
    return query.limit(params.pageSize + 1).get();
  }));

  const unique = new Map<string, StockAuditSession | StockCountSessionSummary>();
  for (const snapshot of snapshots) {
    for (const document of snapshot.docs) {
      unique.set(document.id, toSession(document, params.includeItems));
    }
  }
  const ordered = [...unique.values()].sort(compareSessions);
  const sessions = ordered.slice(0, params.pageSize);
  const hasMore = ordered.length > params.pageSize || snapshots.some((snapshot) => snapshot.size > params.pageSize);
  const last = sessions.at(-1);

  return {
    sessions,
    hasMore,
    nextCursor: hasMore && last ? { startedAt: last.startedAt, id: last.id } : null,
    readCeiling: unitChunks.length * (params.pageSize + 1),
  };
}
