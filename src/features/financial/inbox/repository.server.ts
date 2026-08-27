import { FieldPath } from "firebase-admin/firestore";

import type { FinancialInboxMessage, FinancialInboxStatus } from "./types";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { serializeFinancialValue } from "@/features/financial/lib/server-access";

const COLLECTION = "financialInboxMessages";
const LIST_STATUSES = new Set<FinancialInboxStatus>([
  "pending_review", "document_pending", "suggestion_available", "under_review", "linked",
  "awaiting_authorization", "scheduled", "awaiting_statement", "reconciled", "divergent", "ignored", "error",
]);

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

export async function listFinancialInboxMessages(params: {
  workspaceId: string;
  status?: string | null;
  limit?: number;
  cursor?: string | null;
}) {
  const pageSize = Math.max(1, Math.min(50, params.limit || 25));
  const status = params.status && LIST_STATUSES.has(params.status as FinancialInboxStatus)
    ? params.status as FinancialInboxStatus
    : null;
  let query: FirebaseFirestore.Query = financialDbAdmin.collection(COLLECTION).where("workspaceId", "==", params.workspaceId);
  if (status) query = query.where("status", "==", status);
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
  const reference = financialDbAdmin.collection(COLLECTION).doc(params.id);
  const now = new Date().toISOString();
  await financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error("Mensagem financeira não encontrada.");
    if (snapshot.get("workspaceId") !== params.workspaceId) throw new Error("Mensagem financeira não encontrada.");
    if (params.status === "ignored" && (snapshot.get("linkedExpenseId") || snapshot.get("paymentRequestId"))) {
      throw new Error("Uma cobrança vinculada não pode ser descartada. Cancele ou desvincule o fluxo correspondente primeiro.");
    }
    transaction.set(reference, {
      status: params.status,
      reviewedAt: now,
      reviewedBy: params.actorId,
      updatedAt: now,
    }, { merge: true });
    transaction.create(reference.collection("events").doc(), {
      type: params.status === "ignored" ? "MESSAGE_IGNORED" : "MESSAGE_REOPENED",
      at: now,
      actorId: params.actorId,
      actorEmail: params.actorEmail ?? null,
    });
  });
  return getFinancialInboxMessage(params.id);
}
