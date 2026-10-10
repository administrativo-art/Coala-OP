import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import type { Product } from "@/types";
import {
  isLocalPurchaseStockProduct,
  localPurchaseItemLinkId,
  localPurchaseLotId,
  toLocalPurchaseProduct,
  type LocalPurchaseProduct,
  type LocalPurchaseStockLine,
} from "./local-purchase-stock";

const CACHE_TTL_MS = 10 * 60_000;
const MAX_PRODUCTS = 1500;
const ITEM_LINKS = "localPurchaseItemLinks";
let cache: { expiresAt: number; value: Promise<LocalPurchaseProduct[]> } | null = null;

async function loadProducts() {
  const snapshot = await dbAdmin.collection("products").limit(MAX_PRODUCTS + 1).get();
  return snapshot.docs.slice(0, MAX_PRODUCTS)
    .filter((document) => isLocalPurchaseStockProduct(document.data() as Product))
    .map((document) => toLocalPurchaseProduct(document.id, document.data() as Product))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

/** Stock products the app can receive, shared by the review screen and the AI suggestion. */
export function listLocalPurchaseProducts() {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const entry = { expiresAt: Date.now() + CACHE_TTL_MS, value: loadProducts() };
  entry.value.catch(() => { if (cache === entry) cache = null; });
  cache = entry;
  return entry.value;
}

type Supplier = { workspaceId: string; supplierTaxId?: string | null; supplierName?: string | null };

/** Links confirmed by a person in earlier purchases; they outrank the AI guess. */
export async function recallLocalPurchaseItemLinks(supplier: Supplier, descriptions: string[]) {
  const ids = descriptions.map((description) => localPurchaseItemLinkId({ ...supplier, description }));
  const known = ids.filter((id): id is string => !!id);
  if (!known.length) return descriptions.map(() => null);
  const snapshots = await financialDbAdmin.getAll(...known.map((id) => financialDbAdmin.collection(ITEM_LINKS).doc(id)));
  const productById = new Map(snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, String(snapshot.get("productId"))]));
  return ids.map((id) => (id ? productById.get(id) ?? null : null));
}

export async function rememberLocalPurchaseItemLinks(supplier: Supplier, links: Array<{ description: string; productId: string }>, actorId: string) {
  const batch = financialDbAdmin.batch();
  let writes = 0;
  for (const link of links) {
    const id = localPurchaseItemLinkId({ ...supplier, description: link.description });
    if (!id) continue;
    batch.set(financialDbAdmin.collection(ITEM_LINKS).doc(id), {
      workspaceId: supplier.workspaceId, productId: link.productId, description: link.description.slice(0, 180),
      supplierTaxId: supplier.supplierTaxId ?? null, updatedBy: actorId, updatedAt: new Date().toISOString(),
    });
    writes += 1;
  }
  if (writes) await batch.commit();
}

/**
 * Writes the lots, movements and cost of a confirmed local purchase. Stock lives
 * in another database than the purchase, so this runs after the purchase commit
 * and is idempotent: the entry marker is created in the same transaction as the
 * lots, and a retry of the confirmation finishes a half-done purchase.
 */
export async function applyLocalPurchaseStockEntry(input: {
  purchaseId: string;
  unitId: string;
  unitName: string;
  supplierName: string;
  lines: LocalPurchaseStockLine[];
  actorId: string;
  actorName: string;
}) {
  if (!input.lines.length) return;
  const entryRef = dbAdmin.collection("localPurchaseStockEntries").doc(input.purchaseId);
  const now = new Date().toISOString();
  await dbAdmin.runTransaction(async (transaction) => {
    if ((await transaction.get(entryRef)).exists) return;
    // Kept so a reversal can put the reference price back where it was.
    const baseIds = [...new Set(input.lines.map((line) => line.baseItemId))];
    const bases = await Promise.all(baseIds.map((id) => transaction.get(dbAdmin.collection("baseProducts").doc(id))));
    const previousPrices = Object.fromEntries(bases.flatMap((base) => base.get("lastEffectivePrice") ? [[base.id, base.get("lastEffectivePrice")]] : []));
    for (const line of input.lines) {
      const lotId = localPurchaseLotId({ productId: line.productId, unitId: input.unitId, lotCode: line.lotCode, expiryDate: line.expiryDate });
      transaction.set(dbAdmin.collection("lots").doc(lotId), {
        workspaceId: WORKSPACE_ID,
        productId: line.productId,
        productName: line.productName,
        lotNumber: line.lotCode,
        expiryDate: line.expiryDate,
        kioskId: input.unitId,
        quantity: FieldValue.increment(line.quantity),
        updatedAt: Timestamp.now(),
      }, { merge: true });
      transaction.set(dbAdmin.collection("movementHistory").doc(`${input.purchaseId}_${line.itemIndex}`), {
        lotId,
        productId: line.productId,
        productName: line.productName,
        lotNumber: line.lotCode,
        type: "ENTRADA",
        quantityChange: line.quantity,
        toKioskId: input.unitId,
        toKioskName: input.unitName,
        userId: input.actorId,
        username: input.actorName,
        timestamp: now,
        sourceType: "local_purchase",
        sourceId: input.purchaseId,
      });
      transaction.set(dbAdmin.collection("effective_cost_history").doc(`${input.purchaseId}_${line.itemIndex}`), {
        workspaceId: WORKSPACE_ID,
        baseItemId: line.baseItemId,
        supplierId: null,
        supplierName: input.supplierName,
        unitCost: line.pricePerBaseUnit,
        quantity: line.baseQuantity,
        purchasePrice: line.unitPrice,
        purchaseQuantity: line.quantity,
        purchaseUnitType: "content",
        stockProductId: line.productId,
        stockProductQuantity: line.quantity,
        localPurchaseId: input.purchaseId,
        occurredAt: now,
      });
      transaction.set(dbAdmin.collection("baseProducts").doc(line.baseItemId), {
        lastEffectivePrice: {
          baseProductId: line.baseItemId,
          productId: line.productId,
          price: line.unitPrice,
          pricePerUnit: line.pricePerBaseUnit,
          entityId: "N/A",
          confirmedBy: input.actorId,
          confirmedAt: now,
        },
      }, { merge: true });
    }
    transaction.create(entryRef, {
      workspaceId: WORKSPACE_ID, purchaseId: input.purchaseId, unitId: input.unitId,
      lineCount: input.lines.length, previousPrices, createdBy: input.actorId, createdAt: now,
    });
  });
}
