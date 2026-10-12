import { z } from "zod";

import type { RepositionActivity, RepositionItem } from "@/types";
import { parseProductPhotoDataUri } from "@/features/stock-count/mobile-count";

const documentId = z.string().trim().min(1).max(300).regex(/^[^/]+$/);

export const mobileRepositionPhotoQuerySchema = z.object({
  activityId: documentId,
  baseProductId: documentId,
  lotId: documentId,
}).strict();

/** Embedded photos stay behind the receipt permission and destination scope. */
export function mobileRepositionPhotoUrl(activityId: string, row: { baseProductId: string; lotId: string }, value: unknown) {
  if (typeof value === "string" && /^https:\/\/[^\s]+$/.test(value.trim()) && value.length <= 2000) return value.trim();
  if (!parseProductPhotoDataUri(value)) return null;
  return `/api/stock/mobile-reposition/photo?${new URLSearchParams({ activityId, baseProductId: row.baseProductId, lotId: row.lotId })}`;
}

export function dispatchedPhotoProduct(activity: Pick<RepositionActivity, "items">, baseProductId: string, lotId: string): string | null {
  return activity.items?.find((item) => item.baseProductId === baseProductId)?.suggestedLots?.find((lot) => lot.lotId === lotId)?.productId || null;
}

/** Testable authorization/read order; no product read before destination validation. */
export async function readMobileRepositionPhoto(
  input: z.infer<typeof mobileRepositionPhotoQuerySchema>,
  dependencies: {
    authorized: boolean;
    loadActivity: (id: string) => Promise<RepositionActivity | null>;
    canAccessDestination: (unitId: string) => boolean;
    loadImage: (productId: string) => Promise<unknown>;
  },
) {
  if (!dependencies.authorized) return { ok: false as const, reason: "forbidden" as const };
  const activity = await dependencies.loadActivity(input.activityId);
  if (!activity || !dependencies.canAccessDestination(activity.kioskDestinationId)) return { ok: false as const, reason: "not_found" as const };
  if (activity.status !== "Aguardando recebimento") return { ok: false as const, reason: "not_awaiting" as const };
  const productId = dispatchedPhotoProduct(activity, input.baseProductId, input.lotId);
  if (!productId) return { ok: false as const, reason: "not_found" as const };
  const photo = parseProductPhotoDataUri(await dependencies.loadImage(productId));
  return photo ? { ok: true as const, unitId: activity.kioskDestinationId, photo } : { ok: false as const, reason: "not_found" as const };
}

export const receiveMobileRepositionSchema = z.object({
  activityId: documentId,
  rows: z.array(z.object({
    baseProductId: documentId,
    lotId: documentId,
    receivedQuantity: z.number().finite().min(0).max(1_000_000),
    notes: z.string().trim().max(240),
  }).strict()).min(1).max(2000),
}).strict();

export type MobileReceiptRow = z.infer<typeof receiveMobileRepositionSchema>["rows"][number];

const rowKey = (baseProductId: string, lotId: string) => `${baseProductId}:${lotId}`;

/** What the destination unit sees: who sent it and, per lot, how much was dispatched. */
export function toMobileRepositionActivity(activity: RepositionActivity) {
  return {
    id: activity.id,
    originName: activity.kioskOriginName,
    destinationId: activity.kioskDestinationId,
    destinationName: activity.kioskDestinationName,
    createdAt: activity.createdAt,
    dispatchedBy: activity.transportSignature?.signedBy ?? null,
    dispatchedAt: activity.transportSignature?.signedAt ?? null,
    rows: (activity.items ?? []).flatMap((item) => (item.suggestedLots ?? []).map((lot) => ({
      baseProductId: item.baseProductId,
      lotId: lot.lotId,
      // The lot carries the derived product actually shipped; the item name is the base ingredient.
      productId: lot.productId,
      productName: lot.productName || item.productName,
      lotNumber: lot.lotNumber,
      sentQuantity: Number(lot.quantityToMove ?? 0),
    }))),
  };
}

/**
 * Same record the web receipt writes: every dispatched lot gets a received quantity, and a
 * quantity different from the dispatched one must be explained. Receiving does not move stock.
 */
export function buildMobileReceipt(activity: Pick<RepositionActivity, "items">, rows: MobileReceiptRow[]) {
  const byKey = new Map<string, MobileReceiptRow>();
  for (const row of rows) {
    const key = rowKey(row.baseProductId, row.lotId);
    if (byKey.has(key)) return { ok: false as const, error: "Lote repetido no recebimento." };
    byKey.set(key, row);
  }
  const expected = (activity.items ?? []).flatMap((item) => (item.suggestedLots ?? []).map((lot) => rowKey(item.baseProductId, lot.lotId)));
  if (expected.length !== byKey.size || expected.some((key) => !byKey.has(key))) {
    return { ok: false as const, error: "O recebimento deve conter exatamente os lotes enviados nesta reposição." };
  }
  let hasDivergence = false;
  const items: RepositionItem[] = [];
  for (const item of activity.items ?? []) {
    const receivedLots = [];
    for (const lot of item.suggestedLots ?? []) {
      const row = byKey.get(rowKey(item.baseProductId, lot.lotId))!;
      const differs = row.receivedQuantity !== Number(lot.quantityToMove ?? 0);
      if (differs && row.notes.length < 3) return { ok: false as const, error: `Explique a diferença de ${lot.productName || item.productName} (lote ${lot.lotNumber}).` };
      hasDivergence ||= differs;
      receivedLots.push({ ...lot, receivedQuantity: row.receivedQuantity, ...(row.notes ? { receiptNotes: row.notes } : {}) });
    }
    items.push({ ...item, receivedLots });
  }
  return {
    ok: true as const,
    items,
    status: (hasDivergence ? "Recebido com divergência" : "Recebido sem divergência") as RepositionActivity["status"],
    hasDivergence,
  };
}
