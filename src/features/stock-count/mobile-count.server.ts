import "server-only";

import type { ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";
import { canAccessUnit } from "@/lib/unit-access";
import { WORKSPACE_ID } from "@/lib/workspace";
import type { BaseProduct, LotEntry, Product, StockAuditItem, StockAuditSession } from "@/types";
import { completeStockCountSession, isStockCountOwner } from "./lib/finalize";
import { cancelStockCountTaskSafely, syncStockCountTaskSafely } from "./lib/task-sync";
import { OWN_OPEN_STOCK_COUNT_SESSION_LIMIT } from "./lib/visibility";
import {
  applyMobileCountEntries,
  cancelMobileCountSchema,
  isMobileCountProduct,
  MOBILE_COUNT_EXIT_REASONS,
  mobileCountDisplayUnit,
  mobileCountPhotoUrl,
  mobileCountProductName,
  parseProductPhotoDataUri,
  saveMobileCountSchema,
  startMobileCountSchema,
  toMobileCountItem,
} from "./mobile-count";

/** A unit with more lots than this needs the count split by area before the app can handle it. */
const MAX_LOTS_PER_COUNT = 1500;

function failure(code: string, safeMessage: string, kind: "VALIDATION" | "AUTHORIZATION" | "NOT_FOUND" | "CONFLICT" = "CONFLICT"): never {
  throw new AppError({ code: `MOBILE_COUNT_${code}`, kind, safeMessage });
}

/** Own permission of the app list: counting in the web system does not grant counting in the app. */
export function assertCanPerformMobileCount(actor: ServerUserContext) {
  if (!actor.isDefaultAdmin && actor.permissions.app?.stockCount?.perform !== true) {
    failure("FORBIDDEN", "Sua conta não possui permissão para contar estoque pelo aplicativo.", "AUTHORIZATION");
  }
}

/**
 * Photo and counting instruction come from the product registration at read time, as in the web
 * count; they are not stored in the session, so a photo added later shows up in an open count.
 */
async function sessionPayload(session: StockAuditSession) {
  const items = session.items ?? [];
  const productIds = [...new Set(items.map((item) => item.productId).filter(Boolean))];
  const snapshots = productIds.length ? await dbAdmin.getAll(...productIds.map((id) => dbAdmin.collection("products").doc(id))) : [];
  const media = new Map(snapshots.map((snapshot) => [snapshot.id, {
    imageUrl: mobileCountPhotoUrl(snapshot.id, snapshot.get("imageUrl")),
    countingInstruction: typeof snapshot.get("countingInstruction") === "string" ? String(snapshot.get("countingInstruction")).trim().slice(0, 400) || null : null,
  }]));
  return {
    id: session.id,
    kioskId: session.kioskId,
    kioskName: session.kioskName,
    status: session.status,
    startedAt: session.startedAt,
    // Last save on the server: the app compares it with a draft left on the phone and keeps the newer one.
    updatedAt: typeof (session as { updatedAt?: unknown }).updatedAt === "string" ? (session as { updatedAt?: string }).updatedAt : null,
    items: items.map((item) => ({ ...toMobileCountItem(item), imageUrl: media.get(item.productId)?.imageUrl ?? null, countingInstruction: media.get(item.productId)?.countingInstruction ?? null })),
  };
}

async function ownOpenSessions(actor: ServerUserContext) {
  // Bounded by owner and status; unit scope is rechecked in memory because access can change after a session starts.
  const snapshot = await dbAdmin.collection("stockAuditSessions")
    .where("auditedBy.userId", "==", actor.userDoc.id)
    .where("status", "==", "pending_review")
    .limit(OWN_OPEN_STOCK_COUNT_SESSION_LIMIT)
    .get();
  return snapshot.docs
    .map((document) => ({ id: document.id, ...document.data() }) as StockAuditSession)
    .filter((session) => canAccessUnit(actor.userDoc, session.kioskId, { isDefaultAdmin: actor.isDefaultAdmin }));
}

/** Units the operator may count and the counts they left open. */
export async function loadMobileCountContext(actor: ServerUserContext) {
  assertCanPerformMobileCount(actor);
  const [unitsSnapshot, sessions] = await Promise.all([dbAdmin.collection("kiosks").limit(201).get(), ownOpenSessions(actor)]);
  const units = unitsSnapshot.docs
    .filter((document) => canAccessUnit(actor.userDoc, document.id, { isDefaultAdmin: actor.isDefaultAdmin }))
    .map((document) => ({ id: document.id, name: String(document.get("name") || document.get("displayName") || document.id) }))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  return {
    units,
    openSessions: sessions.map((session) => ({ id: session.id, kioskId: session.kioskId, kioskName: session.kioskName, startedAt: session.startedAt, itemCount: session.items?.length ?? 0 })),
    exitReasons: MOBILE_COUNT_EXIT_REASONS,
  };
}

async function buildCountItems(kioskId: string): Promise<StockAuditItem[]> {
  const lotsSnapshot = await dbAdmin.collection("lots").where("kioskId", "==", kioskId).limit(MAX_LOTS_PER_COUNT + 1).get();
  if (lotsSnapshot.size > MAX_LOTS_PER_COUNT) failure("TOO_MANY_LOTS", "Esta unidade tem lotes demais para uma contagem pelo aplicativo. Faça a contagem pelo Coala One.");
  const lots = lotsSnapshot.docs.map((document) => ({ ...(document.data() as LotEntry), id: document.id })).filter((lot) => Number(lot.quantity) > 0);
  const productIds = [...new Set(lots.map((lot) => lot.productId).filter(Boolean))];
  const productSnapshots = productIds.length ? await dbAdmin.getAll(...productIds.map((id) => dbAdmin.collection("products").doc(id))) : [];
  const products = new Map(productSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data() as Product]));
  const baseIds = [...new Set([...products.values()].flatMap((product) => product.defaultCountingUnit === "base" && product.baseProductId ? [product.baseProductId] : []))];
  const baseSnapshots = baseIds.length ? await dbAdmin.getAll(...baseIds.map((id) => dbAdmin.collection("baseProducts").doc(id))) : [];
  const baseUnits = new Map(baseSnapshots.map((snapshot) => [snapshot.id, (snapshot.data() as BaseProduct | undefined)?.unit]));

  // Same grouping as the web count: lots of one product with the same number and expiry are counted together.
  const grouped = new Map<string, LotEntry>();
  for (const lot of lots) {
    if (!isMobileCountProduct(products.get(lot.productId))) continue;
    const key = `${lot.productId}-${lot.lotNumber}-${lot.expiryDate || "no-expiry"}`;
    const existing = grouped.get(key);
    if (existing) existing.quantity += lot.quantity; else grouped.set(key, { ...lot });
  }
  return [...grouped.values()].map((lot) => {
    const product = products.get(lot.productId)!;
    return {
      productId: lot.productId,
      productName: mobileCountProductName(product),
      lotId: lot.id,
      lotNumber: lot.lotNumber,
      expiryDate: lot.expiryDate || "",
      systemQuantity: lot.quantity,
      displayUnit: mobileCountDisplayUnit(product, product.baseProductId ? baseUnits.get(product.baseProductId) : undefined),
      finalQuantity: lot.quantity,
      divergences: [],
      adjustments: [],
    };
  }).sort((left, right) => left.productName.localeCompare(right.productName, "pt-BR") || left.lotNumber.localeCompare(right.lotNumber));
}

/** Opens a count for the unit, or returns the one this operator already has open there. */
export async function startMobileCount(raw: unknown, actor: ServerUserContext) {
  assertCanPerformMobileCount(actor);
  const parsed = startMobileCountSchema.safeParse(raw);
  if (!parsed.success) failure("INPUT_INVALID", "Unidade inválida.", "VALIDATION");
  const { kioskId } = parsed.data;
  if (!canAccessUnit(actor.userDoc, kioskId, { isDefaultAdmin: actor.isDefaultAdmin })) {
    failure("UNIT_FORBIDDEN", "A unidade não está no escopo da sua conta.", "AUTHORIZATION");
  }
  const existing = (await ownOpenSessions(actor)).find((session) => session.kioskId === kioskId);
  if (existing) return { session: await sessionPayload(existing), resumed: true };

  const unit = await dbAdmin.collection("kiosks").doc(kioskId).get();
  if (!unit.exists) failure("UNIT_NOT_FOUND", "Unidade não encontrada.", "NOT_FOUND");
  const items = await buildCountItems(kioskId);
  if (!items.length) failure("EMPTY", "Não há lotes em estoque para contar nesta unidade.");
  const now = new Date().toISOString();
  const data = {
    kioskId,
    kioskName: String(unit.get("name") || unit.get("displayName") || kioskId),
    status: "pending_review" as const,
    auditedBy: { userId: actor.userDoc.id, username: actor.userDoc.username },
    startedAt: now,
    items,
    source: "coala-notas-android",
    workspaceId: WORKSPACE_ID,
    createdAt: now,
    createdBy: actor.decoded.uid,
  };
  const reference = await dbAdmin.collection("stockAuditSessions").add(data);
  const session = { id: reference.id, ...data } as StockAuditSession;
  await syncStockCountTaskSafely({ context: actor, session, label: "create" });
  return { session: await sessionPayload(session), resumed: false };
}

/**
 * Photo of a product whose registration stores the image inside the document. One document read;
 * any operator who may count may see product photos, which carry no unit or cost data.
 */
export async function loadMobileCountPhoto(productId: string, actor: ServerUserContext) {
  assertCanPerformMobileCount(actor);
  const photo = parseProductPhotoDataUri((await dbAdmin.collection("products").doc(productId).get()).get("imageUrl"));
  if (!photo) failure("PHOTO_NOT_FOUND", "Foto não encontrada.", "NOT_FOUND");
  return { contentType: photo.contentType, bytes: Buffer.from(photo.base64, "base64") };
}

/**
 * Cancels an open count, by the same rule as the web: only who started it, only while open.
 * Nothing was applied to stock yet, so removing the session undoes it entirely.
 */
export async function cancelMobileCount(raw: unknown, actor: ServerUserContext) {
  assertCanPerformMobileCount(actor);
  const parsed = cancelMobileCountSchema.safeParse(raw);
  if (!parsed.success) failure("INPUT_INVALID", "Contagem inválida.", "VALIDATION");
  const reference = dbAdmin.collection("stockAuditSessions").doc(parsed.data.sessionId);
  const taskId = await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    // Cancelling twice (retry after a lost answer) is not an error.
    if (!snapshot.exists) return null;
    const session = { id: snapshot.id, ...(snapshot.data() ?? {}) } as StockAuditSession;
    if (!isStockCountOwner(actor, session) || !canAccessUnit(actor.userDoc, session.kioskId, { isDefaultAdmin: actor.isDefaultAdmin })) {
      failure("NOT_FOUND", "Contagem não encontrada.", "NOT_FOUND");
    }
    if (session.status !== "pending_review") failure("ALREADY_COMPLETED", "Esta contagem já foi concluída e não pode mais ser cancelada.");
    transaction.delete(reference);
    return session.taskId ?? undefined;
  });
  if (taskId === null) return { cancelled: true, alreadyCancelled: true };
  await cancelStockCountTaskSafely({ context: actor, sessionId: parsed.data.sessionId, taskId, label: "mobile-cancel" });
  return { cancelled: true, alreadyCancelled: false };
}

/** Saves the draft or, with `complete`, applies the count to stock through the same transaction the web uses. */
export async function saveMobileCount(raw: unknown, actor: ServerUserContext) {
  assertCanPerformMobileCount(actor);
  const parsed = saveMobileCountSchema.safeParse(raw);
  if (!parsed.success) failure("INPUT_INVALID", parsed.error.issues[0]?.message ?? "Contagem inválida.", "VALIDATION");
  const input = parsed.data;
  const reference = dbAdmin.collection("stockAuditSessions").doc(input.sessionId);
  const snapshot = await reference.get();
  const session = { id: snapshot.id, ...(snapshot.data() ?? {}) } as StockAuditSession;
  if (!snapshot.exists || !isStockCountOwner(actor, session)
    || !canAccessUnit(actor.userDoc, session.kioskId, { isDefaultAdmin: actor.isDefaultAdmin })) {
    failure("NOT_FOUND", "Contagem não encontrada.", "NOT_FOUND");
  }
  if (session.status === "completed") return { status: "completed" as const, alreadyCompleted: true, adjustedLots: 0 };
  const applied = applyMobileCountEntries(session.items ?? [], input.entries);
  if (!applied.ok) failure("ENTRIES_INVALID", applied.error, "VALIDATION");
  const adjustedLots = applied.items.filter((item) => item.finalQuantity !== item.systemQuantity).length;

  if (!input.complete) {
    await reference.update({ items: applied.items, updatedAt: new Date().toISOString(), updatedBy: actor.userDoc.id });
    await syncStockCountTaskSafely({ context: actor, session: { ...session, items: applied.items }, label: "update" });
    return { status: "pending_review" as const, alreadyCompleted: false, adjustedLots };
  }
  const result = await completeStockCountSession({ context: actor, sessionId: input.sessionId, items: applied.items }).catch((cause) => {
    // The shared finalizer signals business conflicts with a numeric code and a message written for the operator.
    const code = (cause as { code?: number }).code;
    if (typeof code === "number" && code >= 400 && code < 500) failure("COMPLETE_REJECTED", (cause as Error).message, code === 404 ? "NOT_FOUND" : "CONFLICT");
    throw cause;
  });
  await syncStockCountTaskSafely({ context: actor, session: result.session, label: "complete" });
  return { status: "completed" as const, alreadyCompleted: result.alreadyCompleted, adjustedLots };
}
