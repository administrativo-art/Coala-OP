import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth-server";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import {
  closeImportStatement,
  effectuateImportSessionItem,
  reopenImportSessionItem,
} from "@/features/financial/import-session-effectuation.server";
import {
  buildImportAuditSnapshot,
  diffImportAuditSnapshots,
  type ImportAuditSnapshot,
} from "@/features/financial/lib/import-audit-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RawItem = Record<string, unknown>;
type ItemStatus = "pending" | "audited" | "ignored" | "completed";

const rawItemSchema = z.record(z.unknown());
const saveSchema = z.object({
  action: z.enum(["save", "finalize"]),
  statementAccountId: z.string().max(200),
  statementAccountName: z.string().max(500),
  items: z.array(rawItemSchema).max(5000),
});
const statusSchema = z.object({
  action: z.literal("status"),
  status: z.enum(["completed", "discarded"]),
});
const effectuateItemSchema = z.object({
  action: z.literal("effectuate_item"),
  itemId: z.string().min(1).max(500),
});
const reopenItemSchema = z.object({
  action: z.literal("reopen_item"),
  itemId: z.string().min(1).max(500),
  reason: z.string().trim().min(5).max(500),
});
const closeStatementSchema = z.object({
  action: z.literal("close_statement"),
});
const updateSchema = z.discriminatedUnion("action", [
  saveSchema,
  statusSchema,
  effectuateItemSchema,
  reopenItemSchema,
  closeStatementSchema,
]);

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getItemId(item: RawItem) {
  return typeof item.id === "string" ? item.id : "";
}

function getItemStatus(item: RawItem): ItemStatus {
  return item.status === "audited" || item.status === "ignored" || item.status === "completed"
    ? item.status
    : "pending";
}

function buildSummary(items: RawItem[]) {
  return {
    total: items.length,
    pending: items.filter((item) => getItemStatus(item) === "pending").length,
    audited: items.filter((item) => getItemStatus(item) === "audited").length,
    ignored: items.filter((item) => getItemStatus(item) === "ignored").length,
    completed: items.filter((item) => getItemStatus(item) === "completed").length,
  };
}

function nextEditableStatus(current: ItemStatus, requested: ItemStatus, action: "save" | "finalize") {
  if (current === "completed") return current;
  if (action === "finalize") {
    return current === "audited" && requested === "completed" ? "completed" : requested === "completed" ? current : requested;
  }
  return requested === "completed" ? current : requested;
}

function mergeItem(
  current: RawItem,
  incoming: RawItem,
  action: "save" | "finalize",
  actor: { id: string; name: string }
) {
  const currentStatus = getItemStatus(current);
  const incomingStatus = getItemStatus(incoming);
  const nextStatus = nextEditableStatus(currentStatus, incomingStatus, action);
  const next = {
    ...current,
    expenseDraft:
      incoming.expenseDraft && typeof incoming.expenseDraft === "object"
        ? incoming.expenseDraft
        : current.expenseDraft,
    financialDraft:
      incoming.financialDraft && typeof incoming.financialDraft === "object"
        ? incoming.financialDraft
        : current.financialDraft,
    status: nextStatus,
  };

  if (action !== "save" || nextStatus !== "audited" || currentStatus === "audited") {
    return next;
  }

  const snapshot = buildImportAuditSnapshot(next);
  const previousSnapshot = current.auditSnapshot && typeof current.auditSnapshot === "object"
    ? current.auditSnapshot as ImportAuditSnapshot
    : null;
  const revision = Math.max(Number(current.auditRevision) || 0, 0) + 1;
  const history = Array.isArray(current.auditHistory) ? current.auditHistory : [];
  return {
    ...next,
    auditSnapshot: snapshot,
    auditRevision: revision,
    auditHistory: [
      ...history,
      {
        action: "audit_confirmed",
        actorId: actor.id,
        actorName: actor.name,
        at: new Date().toISOString(),
        revision,
        changes: diffImportAuditSnapshots(previousSnapshot, snapshot),
      },
    ].slice(-50),
  };
}

function mergeSessionItems(
  currentItems: RawItem[],
  incomingItems: RawItem[],
  action: "save" | "finalize",
  automated: boolean,
  actor: { id: string; name: string }
) {
  const incomingById = new Map(incomingItems.map((item) => [getItemId(item), item]));
  const mergedCurrent = currentItems.map((current) => {
    const incoming = incomingById.get(getItemId(current));
    return incoming ? mergeItem(current, incoming, action, actor) : current;
  });

  if (automated) return mergedCurrent;

  const currentIds = new Set(currentItems.map(getItemId));
  return [
    ...mergedCurrent,
    ...incomingItems.filter((item) => {
      const id = getItemId(item);
      return id && !currentIds.has(id);
    }),
  ];
}

function updateLinkedTransaction(
  transaction: FirebaseFirestore.Transaction,
  previous: RawItem,
  next: RawItem,
  actorId: string
) {
  const previousStatus = getItemStatus(previous);
  const nextStatus = getItemStatus(next);
  if (previousStatus === nextStatus || (nextStatus !== "ignored" && nextStatus !== "pending")) return;

  const linkedTransactionId = typeof next.linkedBankTransactionId === "string" ? next.linkedBankTransactionId : "";
  if (!linkedTransactionId) return;

  transaction.update(financialDbAdmin.collection("transactions").doc(linkedTransactionId), {
    auditStatus: nextStatus,
    auditedBy: nextStatus === "ignored" ? actorId : null,
    auditedAt: nextStatus === "ignored" ? FieldValue.serverTimestamp() : null,
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
) {
  let actor: Awaited<ReturnType<typeof requireUser>>;
  try {
    actor = await requireUser(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Não autenticado.", 401);
  }

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Alteração de auditoria inválida.");

  const { sessionId } = await context.params;
  if (!sessionId.trim()) return jsonError("Sessão inválida.");

  const sessionRef = financialDbAdmin.collection("importDrafts").doc(sessionId);
  const actorName = actor.userDoc.username?.trim() || actor.decoded.name?.trim() || actor.decoded.email || "Usuário";

  try {
    if (
      parsed.data.action === "effectuate_item" ||
      parsed.data.action === "reopen_item" ||
      parsed.data.action === "close_statement"
    ) {
      const snapshot = await sessionRef.get();
      if (!snapshot.exists) throw new Error("NOT_FOUND");
      const current = snapshot.data() ?? {};
      const isAutomated = current.syncSource === "inter_api";
      const canImport = actor.isDefaultAdmin || actor.permissions.financial?.expenses?.import === true;
      const isOwner = current.createdBy === actor.decoded.uid;
      if (!isOwner && !(isAutomated && canImport)) throw new Error("FORBIDDEN");

      if (parsed.data.action === "effectuate_item") {
        return NextResponse.json({
          ok: true,
          ...(await effectuateImportSessionItem({
            sessionId,
            itemId: parsed.data.itemId,
            actorId: actor.decoded.uid,
            actorName,
          })),
        });
      }
      if (parsed.data.action === "reopen_item") {
        return NextResponse.json({
          ok: true,
          ...(await reopenImportSessionItem({
            sessionId,
            itemId: parsed.data.itemId,
            actorId: actor.decoded.uid,
            actorName,
            reason: parsed.data.reason,
          })),
        });
      }
      return NextResponse.json({
        ok: true,
        ...(await closeImportStatement({ sessionId, actorId: actor.decoded.uid, actorName })),
      });
    }

    if (parsed.data.action === "status") {
      const statusData = parsed.data;
      const statusResult = await financialDbAdmin.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(sessionRef);
        if (!snapshot.exists) throw new Error("NOT_FOUND");
        const current = snapshot.data() ?? {};
        const isAutomated = current.syncSource === "inter_api";
        const canImport = actor.isDefaultAdmin || actor.permissions.financial?.expenses?.import === true;
        const isOwner = current.createdBy === actor.decoded.uid;
        if (!isOwner && !(isAutomated && canImport)) throw new Error("FORBIDDEN");
        transaction.update(sessionRef, {
          status: statusData.status,
          updatedAt: FieldValue.serverTimestamp(),
          completedAt: FieldValue.serverTimestamp(),
        });
        return { status: statusData.status };
      });
      return NextResponse.json({ ok: true, ...statusResult });
    }

    const saveData = parsed.data;

    const result = await financialDbAdmin.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(sessionRef);
      if (!snapshot.exists) throw new Error("NOT_FOUND");

      const current = snapshot.data() ?? {};
      const isAutomated = current.syncSource === "inter_api";
      const canImport = actor.isDefaultAdmin || actor.permissions.financial?.expenses?.import === true;
      const isOwner = current.createdBy === actor.decoded.uid;
      if (!isOwner && !(isAutomated && canImport)) throw new Error("FORBIDDEN");

      if (current.status !== "open") throw new Error("SESSION_CLOSED");

      const currentItems = Array.isArray(current.items) ? (current.items as RawItem[]) : [];
      const nextItems = mergeSessionItems(
        currentItems,
        saveData.items,
        saveData.action,
        isAutomated,
        { id: actor.decoded.uid, name: actorName }
      );
      const previousById = new Map(currentItems.map((item) => [getItemId(item), item]));
      nextItems.forEach((item) => {
        const previous = previousById.get(getItemId(item));
        if (previous) updateLinkedTransaction(transaction, previous, item, actor.decoded.uid);
      });

      const summary = buildSummary(nextItems);
      transaction.update(sessionRef, {
        statementAccountId: saveData.statementAccountId,
        statementAccountName: saveData.statementAccountName,
        items: nextItems,
        summary,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { status: "open", summary };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "NOT_FOUND") return jsonError("Sessão não encontrada.", 404);
    if (message === "FORBIDDEN") return jsonError("Sem permissão para editar esta auditoria.", 403);
    if (message === "SESSION_CLOSED") return jsonError("Esta sessão já foi concluída ou descartada.", 409);
    if (message === "ITEM_NOT_FOUND") return jsonError("A movimentação não foi encontrada nesta sessão.", 404);
    if (message === "ITEM_NOT_AUDITED") return jsonError("Confirme a auditoria antes de efetivar esta movimentação.", 409);
    if (message === "ITEM_NOT_COMPLETED") return jsonError("Somente uma movimentação efetivada pode ser reaberta.", 409);
    if (message === "INVALID_ITEM_DATE") return jsonError("A data da movimentação é inválida.", 409);
    if (
      message === "INCOMPLETE_FINANCIAL_MOVEMENT" ||
      message === "INCOMPLETE_TRANSFER" ||
      message === "INCOMPLETE_EXPENSE_LINK" ||
      message === "INCOMPLETE_PURCHASE_LINK" ||
      message === "INCOMPLETE_SPLIT_EXPENSE" ||
      message === "INCOMPLETE_EXPENSE"
    ) {
      return jsonError("Complete todos os campos obrigatórios e confirme novamente a auditoria.", 409);
    }
    if (message === "EXPENSE_NOT_FOUND") return jsonError("A despesa vinculada não foi encontrada.", 409);
    if (message === "PURCHASE_FINANCIAL_NOT_FOUND") return jsonError("O financeiro da compra vinculada não foi encontrado.", 409);
    if (message === "STATEMENT_HAS_PENDING_ITEMS") return jsonError("Efetive ou ignore todos os itens antes de fechar o extrato.", 409);
    console.error("[financial/import-sessions] Falha ao atualizar sessão", error);
    return jsonError("Não foi possível salvar a auditoria.", 500);
  }
}
