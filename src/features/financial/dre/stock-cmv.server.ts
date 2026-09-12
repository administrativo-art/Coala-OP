import "server-only";

import { FieldPath } from "firebase-admin/firestore";

import { financialMonthKey } from "@/features/financial/lib/financial-dates";
import { dbAdmin } from "@/lib/firebase-admin";
import type { BaseProduct, EffectiveCostEntry, MovementRecord, Product } from "@/types";
import {
  DreStockCmvLimitError,
  isDreStockOutflowMovement,
  summarizeDreStockMovements,
  type DreStockCmvPayload,
} from "./stock-cmv";

const MOVEMENT_PAGE_SIZE = 500;
const COST_PAGE_SIZE = 500;
const DOCUMENT_BATCH_SIZE = 200;
const FIRESTORE_IN_LIMIT = 30;
const MAX_MOVEMENTS_PER_RANGE = 25_000;
const MAX_PRODUCTS_PER_RANGE = 5_000;
const MAX_COSTS_PER_RANGE = 10_000;

function chunkValues<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => (
    values.slice(index * size, (index + 1) * size)
  ));
}

function nextMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return `${next.year}-${String(next.month).padStart(2, "0")}`;
}

function periodWindow(periods: string[]) {
  const sorted = [...periods].sort();
  return {
    startAt: new Date(`${sorted[0]}-01T00:00:00-03:00`).toISOString(),
    endBefore: new Date(`${nextMonthKey(sorted.at(-1)!)}-01T00:00:00-03:00`).toISOString(),
  };
}

async function listMovementsForRange(params: {
  kioskIds: string[];
  startAt: string;
  endBefore: string;
}) {
  const documents: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (documents.length <= MAX_MOVEMENTS_PER_RANGE) {
    const remaining = MAX_MOVEMENTS_PER_RANGE + 1 - documents.length;
    let query: FirebaseFirestore.Query = dbAdmin.collection("movementHistory")
      .where("fromKioskId", "in", params.kioskIds)
      .where("timestamp", ">=", params.startAt)
      .where("timestamp", "<", params.endBefore)
      .orderBy("timestamp", "asc")
      .orderBy(FieldPath.documentId(), "asc")
      .limit(Math.min(MOVEMENT_PAGE_SIZE, remaining));
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    documents.push(...snapshot.docs);
    if (snapshot.empty || snapshot.size < Math.min(MOVEMENT_PAGE_SIZE, remaining)) break;
    cursor = snapshot.docs.at(-1) ?? null;
    if (!cursor) break;
  }
  if (documents.length > MAX_MOVEMENTS_PER_RANGE) {
    throw new DreStockCmvLimitError("movements");
  }
  return documents;
}

async function getDocumentsById(collectionName: string, ids: string[]) {
  const chunks = chunkValues(Array.from(new Set(ids.filter(Boolean))), DOCUMENT_BATCH_SIZE);
  return (await Promise.all(chunks.map((chunk) => (
    dbAdmin.getAll(...chunk.map((id) => dbAdmin.collection(collectionName).doc(id)))
  )))).flat();
}

async function listEffectiveCosts(params: {
  workspaceId: string;
  baseProductIds: string[];
  startAt: string;
  endBefore: string;
}) {
  const openingDocuments = (await Promise.all(params.baseProductIds.map(async (baseProductId) => {
    const snapshot = await dbAdmin.collection("effective_cost_history")
      .where("workspaceId", "==", params.workspaceId)
      .where("baseItemId", "==", baseProductId)
      .where("occurredAt", "<", params.startAt)
      .orderBy("occurredAt", "desc")
      .limit(1)
      .get();
    return snapshot.docs;
  }))).flat();

  const periodDocuments: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const baseProductIds of chunkValues(params.baseProductIds, FIRESTORE_IN_LIMIT)) {
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    while (periodDocuments.length + openingDocuments.length <= MAX_COSTS_PER_RANGE) {
      const remaining = MAX_COSTS_PER_RANGE + 1 - periodDocuments.length - openingDocuments.length;
      let query: FirebaseFirestore.Query = dbAdmin.collection("effective_cost_history")
        .where("workspaceId", "==", params.workspaceId)
        .where("baseItemId", "in", baseProductIds)
        .where("occurredAt", ">=", params.startAt)
        .where("occurredAt", "<", params.endBefore)
        .orderBy("occurredAt", "desc")
        .limit(Math.min(COST_PAGE_SIZE, remaining));
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      periodDocuments.push(...snapshot.docs);
      if (snapshot.empty || snapshot.size < Math.min(COST_PAGE_SIZE, remaining)) break;
      cursor = snapshot.docs.at(-1) ?? null;
      if (!cursor) break;
    }
  }
  if (openingDocuments.length + periodDocuments.length > MAX_COSTS_PER_RANGE) {
    throw new DreStockCmvLimitError("costs");
  }
  return [...openingDocuments, ...periodDocuments];
}

export async function getDreStockCmv(input: {
  workspaceId: string;
  kioskIds: string[];
  periods: string[];
}): Promise<DreStockCmvPayload> {
  if (input.kioskIds.length < 1 || input.kioskIds.length > 20) {
    throw new DreStockCmvLimitError("movements");
  }
  const requestedPeriods = new Set(input.periods);
  const window = periodWindow(input.periods);
  const movementDocuments = await listMovementsForRange({
    kioskIds: input.kioskIds,
    ...window,
  });
  const movements = movementDocuments.flatMap((document): MovementRecord[] => {
    const movement = { id: document.id, ...document.data() } as MovementRecord;
    return isDreStockOutflowMovement(movement)
      && requestedPeriods.has(financialMonthKey(movement.timestamp) ?? "")
      ? [movement]
      : [];
  });
  const productIds = Array.from(new Set(movements.map((movement) => movement.productId).filter(Boolean)));
  if (productIds.length > MAX_PRODUCTS_PER_RANGE) {
    throw new DreStockCmvLimitError("products");
  }
  const productSnapshots = await getDocumentsById("products", productIds);
  const products = productSnapshots.flatMap((snapshot): Product[] => (
    snapshot.exists ? [{ id: snapshot.id, ...snapshot.data() } as Product] : []
  ));
  const productsById = new Map(products.map((product) => [product.id, product]));
  const baseProductIds = Array.from(new Set(products.map((product) => product.baseProductId).filter(Boolean))) as string[];
  const baseProductSnapshots = await getDocumentsById("baseProducts", baseProductIds);
  const baseProducts = baseProductSnapshots.flatMap((snapshot): BaseProduct[] => (
    snapshot.exists ? [{ id: snapshot.id, ...snapshot.data() } as BaseProduct] : []
  ));
  const baseProductsById = new Map(baseProducts.map((baseProduct) => [baseProduct.id, baseProduct]));
  const effectiveCostSnapshots = baseProductIds.length > 0
    ? await listEffectiveCosts({
        workspaceId: input.workspaceId,
        baseProductIds,
        ...window,
      })
    : [];
  const effectiveCosts = effectiveCostSnapshots.map((snapshot) => ({
    id: snapshot.id,
    ...snapshot.data(),
  } as EffectiveCostEntry));
  const effectiveCostsByBaseProductId = new Map<string, EffectiveCostEntry[]>();
  effectiveCosts.forEach((entry) => {
    const current = effectiveCostsByBaseProductId.get(entry.baseItemId) ?? [];
    current.push(entry);
    effectiveCostsByBaseProductId.set(entry.baseItemId, current);
  });
  const summaries = summarizeDreStockMovements(movements, {
    productsById,
    baseProductsById,
    effectiveCostsByBaseProductId,
  });

  return {
    periods: [...input.periods].sort(),
    ...summaries,
    stats: {
      movementDocuments: movementDocuments.length,
      productDocuments: productSnapshots.length,
      baseProductDocuments: baseProductSnapshots.length,
      effectiveCostDocuments: effectiveCostSnapshots.length,
    },
  };
}
