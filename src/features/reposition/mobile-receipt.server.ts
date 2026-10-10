import "server-only";

import type { ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";
import { canAccessUnit } from "@/lib/unit-access";
import type { RepositionActivity } from "@/types";
import { safeAvatarUrl } from "@/features/collaborator-schedule/mobile-schedule";
import { syncRepositionTaskSafely } from "./lib/task-sync";
import { buildMobileReceipt, receiveMobileRepositionSchema, toMobileRepositionActivity } from "./mobile-receipt";

const AWAITING_RECEIPT: RepositionActivity["status"] = "Aguardando recebimento";
const LIST_LIMIT = 50;

function failure(code: string, safeMessage: string, kind: "VALIDATION" | "AUTHORIZATION" | "NOT_FOUND" | "CONFLICT" = "CONFLICT"): never {
  throw new AppError({ code: `MOBILE_REPOSITION_${code}`, kind, safeMessage });
}

/** Permission from the app list; receiving in the web system does not grant it here. */
export function assertCanReceiveMobileReposition(actor: ServerUserContext) {
  if (!actor.isDefaultAdmin && actor.permissions.app?.reposition?.receive !== true) {
    failure("FORBIDDEN", "Sua conta não possui permissão para receber reposição pelo aplicativo.", "AUTHORIZATION");
  }
}

const canReceiveAt = (actor: ServerUserContext, unitId: string) => canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin });

/** Repositions on their way to the units of this user; nothing else of the reposition flow is exposed to the app. */
export async function listMobileRepositionsToReceive(actor: ServerUserContext) {
  assertCanReceiveMobileReposition(actor);
  // Only what is in transit is read; the destination is narrowed to the user's units before anything is returned.
  const snapshot = await dbAdmin.collection("repositionActivities").where("status", "==", AWAITING_RECEIPT).limit(LIST_LIMIT + 1).get();
  const activities = snapshot.docs
    .map((document) => ({ id: document.id, ...document.data() }) as RepositionActivity)
    .filter((activity) => canReceiveAt(actor, activity.kioskDestinationId))
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
    .map(toMobileRepositionActivity);
  // Product photo from the registration, as in the stock count; the product id itself stays on the server.
  const productIds = [...new Set(activities.flatMap((activity) => activity.rows.map((row) => row.productId)).filter(Boolean))];
  const products = productIds.length ? await dbAdmin.getAll(...productIds.map((id) => dbAdmin.collection("products").doc(id))) : [];
  const images = new Map(products.map((product) => [product.id, safeAvatarUrl(product.get("imageUrl"))]));
  return {
    activities: activities.map((activity) => ({ ...activity, rows: activity.rows.map(({ productId, ...row }) => ({ ...row, imageUrl: images.get(productId) ?? null })) })),
    truncated: snapshot.size > LIST_LIMIT,
  };
}

/** Records the receipt at the destination unit. Stock only moves when the reposition is finalized in Coala One. */
export async function receiveMobileReposition(raw: unknown, actor: ServerUserContext) {
  assertCanReceiveMobileReposition(actor);
  const parsed = receiveMobileRepositionSchema.safeParse(raw);
  if (!parsed.success) failure("INPUT_INVALID", parsed.error.issues[0]?.message ?? "Recebimento inválido.", "VALIDATION");
  const input = parsed.data;
  const reference = dbAdmin.collection("repositionActivities").doc(input.activityId);
  const now = new Date().toISOString();
  const username = String(actor.userDoc.username || actor.decoded.email || "Usuário");

  const result = await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const activity = { id: snapshot.id, ...(snapshot.data() ?? {}) } as RepositionActivity;
    if (!snapshot.exists || !canReceiveAt(actor, activity.kioskDestinationId)) failure("NOT_FOUND", "Reposição não encontrada.", "NOT_FOUND");
    if (activity.status !== AWAITING_RECEIPT) {
      // A retry of a receipt this same person already recorded is not an error.
      const received = activity.status === "Recebido com divergência" || activity.status === "Recebido sem divergência";
      if (received && activity.updatedBy?.userId === actor.userDoc.id) return { activity, alreadyReceived: true };
      failure("NOT_AWAITING", "Esta reposição não está mais aguardando recebimento.");
    }
    const receipt = buildMobileReceipt(activity, input.rows);
    if (!receipt.ok) failure("ROWS_INVALID", receipt.error, "VALIDATION");
    const update = {
      status: receipt.status,
      items: receipt.items,
      receiptSignature: { signedBy: username, signedAt: now },
      receiptSource: "coala-notas-android",
      updatedAt: now,
      updatedBy: { userId: actor.userDoc.id, username },
    };
    transaction.set(reference, update, { merge: true });
    return { activity: { ...activity, ...update } as RepositionActivity, alreadyReceived: false };
  });

  if (!result.alreadyReceived) await syncRepositionTaskSafely({ context: actor, activity: result.activity, label: "mobile-receipt" });
  return { status: result.activity.status, hasDivergence: result.activity.status === "Recebido com divergência", alreadyReceived: result.alreadyReceived };
}
