import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { canRevertPurchaseStage, canViewPurchasing } from "@/lib/purchasing-permissions";
import { canAccessUnit } from "@/lib/unit-access";
import { LOCAL_PURCHASE_WITHDRAWAL_LINKS } from "@/features/financial/cash-closures/withdrawal-classification.server";
import { localPurchaseLotId, type LocalPurchaseStockLine } from "./local-purchase-stock";
import {
  localPurchaseReversalBlock,
  localPurchaseStockShortfalls,
  reverseLocalPurchaseSchema,
  type LocalPurchaseSummary,
} from "./local-purchase-admin";

const LIST_LIMIT = 150;

function failure(code: string, safeMessage: string, kind: "VALIDATION" | "AUTHORIZATION" | "NOT_FOUND" | "CONFLICT" = "CONFLICT"): never {
  throw new AppError({ code: `LOCAL_PURCHASE_${code}`, kind, safeMessage });
}

function summary(snapshot: FirebaseFirestore.DocumentSnapshot): LocalPurchaseSummary {
  const data = snapshot.data() ?? {};
  const preLink = data.withdrawalPreLink as { amountCents?: number; date?: string; changeCents?: number } | undefined;
  return {
    id: snapshot.id,
    unitId: String(data.unitId ?? ""),
    unitName: String(data.unitName ?? data.unitId ?? ""),
    supplierName: String(data.supplierName ?? ""),
    supplierTaxId: data.supplierTaxId ?? null,
    purchaseDate: String(data.purchaseDate ?? ""),
    createdAt: String(data.createdAt ?? ""),
    totalCents: Number(data.totalCents ?? 0),
    fundingSource: data.fundingSource === "company_payment" ? "company_payment" : "cash_withdrawal",
    companyPaymentMethod: data.companyPaymentMethod ?? null,
    status: String(data.status ?? ""),
    accountPlanName: String(data.accountPlanName ?? ""),
    resultCenterName: String(data.resultCenterName ?? ""),
    note: String(data.note ?? ""),
    stockEntryStatus: data.stockEntryStatus ?? "not_needed",
    items: (Array.isArray(data.items) ? data.items : []).map((item: Record<string, unknown>) => ({
      description: String(item.description ?? ""), quantity: Number(item.quantity ?? 0), unit: String(item.unit ?? ""), totalCents: Number(item.totalCents ?? 0),
    })),
    stockLines: (Array.isArray(data.stockLines) ? data.stockLines as LocalPurchaseStockLine[] : []).map((line) => ({
      itemIndex: line.itemIndex, productName: line.productName, quantity: line.quantity, expiryDate: line.expiryDate, lotCode: line.lotCode,
    })),
    withdrawal: preLink ? { amountCents: Number(preLink.amountCents ?? 0), date: String(preLink.date ?? ""), changeCents: Number(preLink.changeCents ?? 0) } : null,
    cancellation: data.cancelledAt ? { reason: String(data.cancelReason ?? ""), at: String(data.cancelledAt), by: String(data.cancelledByName ?? data.cancelledBy ?? "") } : null,
  };
}

function assertCanView(actor: ServerUserContext) {
  if (!actor.isDefaultAdmin && !canViewPurchasing(actor.permissions)) failure("VIEW_FORBIDDEN", "Sem permissão para ver compras.", "AUTHORIZATION");
}

/** Local purchases for the general purchasing list, newest first, limited to the units the user can see. */
export async function listLocalPurchases(actor: ServerUserContext) {
  assertCanView(actor);
  // Bounded read on a single-field index, once per page open. The workspace filter stays in memory because
  // the deployment is single-tenant; a second tenant needs a (workspaceId, createdAt) index and a cursor here.
  const snapshot = await financialDbAdmin.collection("localPurchases").orderBy("createdAt", "desc").limit(LIST_LIMIT).get();
  return snapshot.docs
    .filter((document) => document.get("workspaceId") === actor.workspace_id
      && canAccessUnit(actor.userDoc, String(document.get("unitId")), { isDefaultAdmin: actor.isDefaultAdmin }))
    .map(summary);
}

async function loadPurchase(purchaseId: string, actor: ServerUserContext) {
  const snapshot = await financialDbAdmin.collection("localPurchases").doc(purchaseId).get();
  if (!snapshot.exists || snapshot.get("workspaceId") !== actor.workspace_id
    || !canAccessUnit(actor.userDoc, String(snapshot.get("unitId")), { isDefaultAdmin: actor.isDefaultAdmin })) {
    failure("NOT_FOUND", "Compra local não encontrada.", "NOT_FOUND");
  }
  return snapshot;
}

export async function getLocalPurchase(purchaseId: string, actor: ServerUserContext) {
  assertCanView(actor);
  return summary(await loadPurchase(purchaseId, actor));
}

/**
 * Undoes the stock entry of a purchase. Runs before the financial cancellation so
 * that goods already consumed block the whole reversal instead of leaving a
 * cancelled purchase with stock nobody can explain.
 */
async function reverseStockEntry(input: { purchaseId: string; unitId: string; unitName: string; lines: LocalPurchaseStockLine[]; reason: string; actorId: string; actorName: string }) {
  const entryRef = dbAdmin.collection("localPurchaseStockEntries").doc(input.purchaseId);
  const now = new Date().toISOString();
  await dbAdmin.runTransaction(async (transaction) => {
    const entry = await transaction.get(entryRef);
    if (!entry.exists || entry.get("reversedAt")) return;
    const lotRefs = input.lines.map((line) => dbAdmin.collection("lots").doc(
      localPurchaseLotId({ productId: line.productId, unitId: input.unitId, lotCode: line.lotCode, expiryDate: line.expiryDate })));
    const baseIds = [...new Set(input.lines.map((line) => line.baseItemId))];
    const [lots, bases] = await Promise.all([
      Promise.all(lotRefs.map((ref) => transaction.get(ref))),
      Promise.all(baseIds.map((id) => transaction.get(dbAdmin.collection("baseProducts").doc(id)))),
    ]);
    // Two lines of the same purchase may share a lot: check the lot against everything this purchase put there.
    const needed = new Map<string, number>();
    input.lines.forEach((line, index) => needed.set(lotRefs[index]!.id, (needed.get(lotRefs[index]!.id) ?? 0) + line.quantity));
    const shortfalls = localPurchaseStockShortfalls(
      input.lines.map((line, index) => ({ productName: line.productName, quantity: needed.get(lotRefs[index]!.id)! })),
      lots.map((lot) => Number(lot.get("quantity") ?? 0)),
    );
    if (shortfalls.length) {
      failure("STOCK_ALREADY_USED", `Parte da mercadoria já saiu do estoque: ${[...new Set(shortfalls)].join("; ")}. Ajuste o estoque antes de estornar.`);
    }
    const previousPrices = (entry.get("previousPrices") ?? {}) as Record<string, unknown>;
    input.lines.forEach((line, index) => {
      const lotRef = lotRefs[index]!;
      transaction.set(lotRef, { quantity: FieldValue.increment(-line.quantity), updatedAt: Timestamp.now() }, { merge: true });
      const movementId = `${input.purchaseId}_${line.itemIndex}`;
      transaction.set(dbAdmin.collection("movementHistory").doc(movementId), { reverted: true }, { merge: true });
      transaction.set(dbAdmin.collection("movementHistory").doc(`${movementId}_estorno`), {
        lotId: lotRef.id,
        productId: line.productId,
        productName: line.productName,
        lotNumber: line.lotCode,
        // Project convention: reversing an entry is ENTRADA_ESTORNO, counted as an exit, with a positive quantity.
        type: "ENTRADA_ESTORNO",
        quantityChange: line.quantity,
        fromKioskId: input.unitId,
        fromKioskName: input.unitName,
        userId: input.actorId,
        username: input.actorName,
        timestamp: now,
        notes: `Estorno de compra local: ${input.reason}`,
        revertedFromId: movementId,
        sourceType: "local_purchase",
        sourceId: input.purchaseId,
      });
      // The cost of a purchase that did not happen must not feed cost history.
      transaction.delete(dbAdmin.collection("effective_cost_history").doc(movementId));
    });
    bases.forEach((base) => {
      // Restore the previous reference price only if this purchase is still the latest one.
      if (base.get("lastEffectivePrice.confirmedAt") !== entry.get("createdAt")) return;
      transaction.set(base.ref, { lastEffectivePrice: previousPrices[base.id] ?? FieldValue.delete() }, { merge: true });
    });
    transaction.update(entryRef, { reversedAt: now, reversedBy: input.actorId, reverseReason: input.reason });
  });
}

/** Estorno completo: tira a mercadoria do estoque, cancela a despesa e libera a sangria para outra nota. */
export async function reverseLocalPurchase(raw: unknown, actor: ServerUserContext) {
  const parsed = reverseLocalPurchaseSchema.safeParse(raw);
  if (!parsed.success) failure("REVERSAL_INVALID", parsed.error.issues[0]?.message ?? "Dados do estorno inválidos.", "VALIDATION");
  const { purchaseId, reason } = parsed.data;
  if (!actor.isDefaultAdmin && !canRevertPurchaseStage(actor.permissions)) {
    failure("REVERSAL_FORBIDDEN", "Sem permissão para estornar compras.", "AUTHORIZATION");
  }
  const purchase = await loadPurchase(purchaseId, actor);
  if (purchase.get("status") === "cancelled") return { purchase: summary(purchase), alreadyReversed: true };
  const expenseRef = financialDbAdmin.collection("expenses").doc(purchaseId);
  const block = localPurchaseReversalBlock({ purchaseStatus: String(purchase.get("status")), expense: (await expenseRef.get()).data() ?? null });
  if (block) failure("REVERSAL_BLOCKED", block);

  const actorName = String(actor.userDoc.username || actor.decoded.email || "Usuário");
  const lines = (purchase.get("stockLines") ?? []) as LocalPurchaseStockLine[];
  if (lines.length) {
    await reverseStockEntry({
      purchaseId, unitId: String(purchase.get("unitId")), unitName: String(purchase.get("unitName") ?? ""),
      lines, reason, actorId: actor.userDoc.id, actorName,
    });
  }

  const now = new Date().toISOString();
  await financialDbAdmin.runTransaction(async (transaction) => {
    const [current, expense] = await Promise.all([transaction.get(purchase.ref), transaction.get(expenseRef)]);
    if (current.get("status") === "cancelled") return;
    // The closure may have linked the sangria while the stock was being reversed.
    const lateBlock = localPurchaseReversalBlock({ purchaseStatus: String(current.get("status")), expense: expense.data() ?? null });
    if (lateBlock) failure("REVERSAL_BLOCKED", lateBlock);
    transaction.update(purchase.ref, {
      status: "cancelled", statusBeforeCancellation: current.get("status"),
      stockEntryStatus: lines.length ? "reversed" : current.get("stockEntryStatus") ?? "not_needed",
      cancelledAt: now, cancelledBy: actor.userDoc.id, cancelledByName: actorName, cancelReason: reason, updatedAt: now,
    });
    if (expense.exists) {
      transaction.update(expenseRef, {
        status: "cancelled", originStatus: "cancelled", updatedAt: Timestamp.now(),
        localPurchaseReversal: { reason, reversedAt: now, reversedBy: actor.userDoc.id },
      });
    }
    const sourceId = current.get("withdrawalPreLink.sourceId");
    if (typeof sourceId === "string" && sourceId) transaction.delete(financialDbAdmin.collection(LOCAL_PURCHASE_WITHDRAWAL_LINKS).doc(sourceId));
    const messageId = current.get("sourceMessageId");
    if (typeof messageId === "string" && messageId) {
      transaction.set(financialDbAdmin.collection("financialInboxMessages").doc(messageId), { localPurchaseStatus: "cancelled", updatedAt: now }, { merge: true });
    }
    transaction.create(purchase.ref.collection("events").doc(), {
      type: "LOCAL_PURCHASE_REVERSED", at: now, actorId: actor.userDoc.id, reason, stockLinesReversed: lines.length,
    });
  });
  return { purchase: summary(await purchase.ref.get()), alreadyReversed: false };
}
