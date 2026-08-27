import { FieldValue } from "firebase-admin/firestore";

import { type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { type MovementType, type StockAuditItem, type StockAuditSession } from "@/types";

const NEGATIVE_MOVEMENT_TYPES = new Set<MovementType>([
  "SAIDA_CONSUMO",
  "SAIDA_DESCARTE_VENCIMENTO",
  "SAIDA_DESCARTE_AVARIA",
  "SAIDA_DESCARTE_PERDA",
  "SAIDA_DESCARTE_OUTROS",
  "SAIDA_CORRECAO",
  "Divergência na contagem do turno - decréscimo",
]);

type StockCountError = Error & { code?: number };

function fail(message: string, code: number): never {
  const error = new Error(message) as StockCountError;
  error.code = code;
  throw error;
}

export function getStockCountOwnerId(session: Pick<StockAuditSession, "auditedBy">) {
  return String(session.auditedBy?.userId ?? "").trim();
}

export function isStockCountOwner(
  context: Pick<ServerUserContext, "decoded" | "userDoc">,
  session: Pick<StockAuditSession, "auditedBy">,
) {
  const ownerId = getStockCountOwnerId(session);
  return ownerId.length > 0 && (ownerId === context.decoded.uid || ownerId === context.userDoc.id);
}

function numberAtLeastZero(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    fail(`${label} deve ser um número maior ou igual a zero.`, 400);
  }
  return number;
}

function sanitizeCompletionItems(existingItems: StockAuditItem[], proposedValue: unknown) {
  if (!Array.isArray(proposedValue) || proposedValue.length !== existingItems.length) {
    fail("A conclusão deve conter exatamente os itens da sessão iniciada.", 400);
  }

  const proposedByLotId = new Map<string, Record<string, unknown>>();
  for (const rawItem of proposedValue) {
    if (!rawItem || typeof rawItem !== "object") fail("Item de contagem inválido.", 400);
    const item = rawItem as Record<string, unknown>;
    const lotId = String(item.lotId ?? "").trim();
    if (!lotId || proposedByLotId.has(lotId)) fail("Lote ausente ou duplicado na contagem.", 400);
    proposedByLotId.set(lotId, item);
  }

  return existingItems.map((existingItem) => {
    const proposed = proposedByLotId.get(existingItem.lotId);
    if (!proposed) fail(`O lote ${existingItem.lotNumber} não foi informado.`, 400);

    const finalQuantity = numberAtLeastZero(
      proposed.finalQuantity,
      `A quantidade final de ${existingItem.productName}`,
    );
    const divergences = Array.isArray(proposed.divergences)
      ? proposed.divergences.flatMap((raw, index) => {
          if (!raw || typeof raw !== "object") fail("Divergência inválida.", 400);
          const value = raw as Record<string, unknown>;
          if (value.quantity === undefined || value.quantity === null || value.quantity === "") return [];
          const reason = String(value.reason ?? "") as MovementType;
          if (!NEGATIVE_MOVEMENT_TYPES.has(reason)) fail("Motivo de saída inválido.", 400);
          return [{
            id: String(value.id ?? `div-${index}`),
            reason,
            quantity: numberAtLeastZero(value.quantity, "A quantidade da saída"),
            notes: typeof value.notes === "string" ? value.notes.trim() : "",
          }];
        })
      : [];
    const adjustments = Array.isArray(proposed.adjustments)
      ? proposed.adjustments.flatMap((raw, index) => {
          if (!raw || typeof raw !== "object") fail("Ajuste inválido.", 400);
          const value = raw as Record<string, unknown>;
          if (value.quantity === undefined || value.quantity === null || value.quantity === "") return [];
          if (value.reason !== "ENTRADA_CORRECAO") fail("Motivo de entrada inválido.", 400);
          return [{
            id: String(value.id ?? `adj-${index}`),
            reason: "ENTRADA_CORRECAO" as const,
            quantity: numberAtLeastZero(value.quantity, "A quantidade da entrada"),
            notes: typeof value.notes === "string" ? value.notes.trim() : "",
          }];
        })
      : [];

    const delta = finalQuantity - Number(existingItem.systemQuantity ?? 0);
    const detailedDelta =
      adjustments.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0) -
      divergences.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
    if ((divergences.length > 0 || adjustments.length > 0) && Math.abs(delta - detailedDelta) > 0.000001) {
      fail(`As justificativas de ${existingItem.productName} não correspondem à quantidade final.`, 400);
    }

    return {
      ...existingItem,
      finalQuantity,
      divergences,
      adjustments,
    } satisfies StockAuditItem;
  });
}

function movementBase(params: {
  session: StockAuditSession;
  item: StockAuditItem;
  context: ServerUserContext;
  now: string;
}) {
  return {
    lotId: params.item.lotId,
    productId: params.item.productId,
    productName: params.item.productName,
    lotNumber: params.item.lotNumber,
    userId: params.context.userDoc.id,
    username: params.context.userDoc.username,
    timestamp: params.now,
    sourceType: "stock_count",
    sourceId: params.session.id,
  };
}

export async function completeStockCountSession(params: {
  context: ServerUserContext;
  sessionId: string;
  items: unknown;
}) {
  const sessionRef = dbAdmin.collection("stockAuditSessions").doc(params.sessionId);

  return dbAdmin.runTransaction(async (transaction) => {
    const sessionSnap = await transaction.get(sessionRef);
    if (!sessionSnap.exists) fail("Sessão de contagem não encontrada.", 404);

    const session = {
      id: sessionSnap.id,
      ...(sessionSnap.data() ?? {}),
    } as StockAuditSession;
    if (!isStockCountOwner(params.context, session)) {
      fail("Somente a pessoa que iniciou a contagem pode concluí-la.", 403);
    }
    if (session.status === "completed") {
      return { session, alreadyCompleted: true };
    }

    const items = sanitizeCompletionItems(session.items ?? [], params.items);
    const lotRefs = items.map((item) => dbAdmin.collection("lots").doc(item.lotId));
    const lotSnaps = [];
    for (const lotRef of lotRefs) {
      lotSnaps.push(await transaction.get(lotRef));
    }
    lotSnaps.forEach((lotSnap, index) => {
      if (!lotSnap.exists) fail(`O lote ${items[index].lotNumber} não existe mais.`, 409);
      const lotKioskId = String(lotSnap.get("kioskId") ?? "");
      if (lotKioskId && lotKioskId !== session.kioskId) {
        fail(`O lote ${items[index].lotNumber} não pertence mais à unidade da contagem.`, 409);
      }
    });

    const now = new Date().toISOString();
    items.forEach((item, index) => {
      const delta = Number(item.finalQuantity) - Number(item.systemQuantity);
      if (delta !== 0) {
        transaction.update(lotRefs[index], {
          quantity: FieldValue.increment(delta),
          updatedAt: now,
        });
      }

      const base = movementBase({ session, item, context: params.context, now });
      const hasDetailedMovements = item.divergences.length > 0 || item.adjustments.length > 0;

      if (hasDetailedMovements) {
        item.divergences.forEach((divergence) => {
          if (!divergence.quantity) return;
          transaction.set(dbAdmin.collection("movementHistory").doc(), {
            ...base,
            type: divergence.reason,
            quantityChange: Number(divergence.quantity),
            fromKioskId: session.kioskId,
            notes: `Ajuste de contagem: ${divergence.notes || ""}`.trim(),
          });
        });
        item.adjustments.forEach((adjustment) => {
          if (!adjustment.quantity) return;
          transaction.set(dbAdmin.collection("movementHistory").doc(), {
            ...base,
            type: "ENTRADA_CORRECAO",
            quantityChange: Number(adjustment.quantity),
            toKioskId: session.kioskId,
            notes: `Ajuste de contagem: ${adjustment.notes || ""}`.trim(),
          });
        });
      } else if (delta !== 0) {
        transaction.set(dbAdmin.collection("movementHistory").doc(), {
          ...base,
          type: delta > 0 ? "ENTRADA_CORRECAO" : "SAIDA_CORRECAO",
          quantityChange: Math.abs(delta),
          ...(delta > 0 ? { toKioskId: session.kioskId } : { fromKioskId: session.kioskId }),
          notes: "Ajuste automático pela quantidade física informada na contagem.",
        });
      }
    });

    const completedSession = {
      ...session,
      items,
      status: "completed" as const,
      completedAt: now,
    };
    transaction.update(sessionRef, {
      items,
      status: "completed",
      completedAt: now,
      completedBy: params.context.userDoc.id,
      completedByUsername: params.context.userDoc.username,
      updatedAt: now,
      updatedBy: params.context.userDoc.id,
    });

    return { session: completedSession, alreadyCompleted: false };
  });
}
