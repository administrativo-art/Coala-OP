import { dbAdmin } from "@/lib/firebase-admin";
import { type RepositionActivity, type MovementRecord, type LotEntry } from "@/types";

type Actor = {
  userId: string;
  username: string;
};

function destLotIdKey(params: {
  productId: string;
  kioskId: string;
  expiryDate?: string | null;
  lotNumber: string;
}) {
  const { productId, kioskId, lotNumber, expiryDate = "null" } = params;
  const cleanLotNumber = lotNumber.replace(/[\/\s]/g, "_");
  return `prod_${productId}__kiosk_${kioskId}__lot_${cleanLotNumber}__exp_${expiryDate}`;
}

function addMovementRecord(
  tx: FirebaseFirestore.Transaction,
  record: Omit<MovementRecord, "id">
) {
  const ref = dbAdmin.collection("movementHistory").doc();
  tx.set(ref, record);
}

export async function finalizeRepositionActivityServer(params: {
  activityId: string;
  resolution: "trust_receipt" | "trust_dispatch";
  actor: Actor;
}) {
  const activityRef = dbAdmin.collection("repositionActivities").doc(params.activityId);
  const now = new Date().toISOString();

  await dbAdmin.runTransaction(async (tx) => {
    const activitySnap = await tx.get(activityRef);
    if (!activitySnap.exists) {
      throw new Error("Reposição não encontrada.");
    }

    const activity = {
      id: activitySnap.id,
      ...(activitySnap.data() as Omit<RepositionActivity, "id">),
    };

    if (
      activity.status !== "Recebido com divergência" &&
      activity.status !== "Recebido sem divergência"
    ) {
      throw new Error("A atividade não está pronta para efetivação.");
    }

    const sourceRefs = new Map<string, FirebaseFirestore.DocumentReference>();
    for (const item of activity.items) {
      for (const lot of item.suggestedLots) {
        sourceRefs.set(lot.lotId, dbAdmin.collection("lots").doc(lot.lotId));
      }
    }
    const sourceDocs = await Promise.all(
      Array.from(sourceRefs.values()).map((ref) => tx.get(ref))
    );
    const sourceMap = new Map(sourceDocs.map((doc) => [doc.id, doc]));

    const destRefs = new Map<string, FirebaseFirestore.DocumentReference>();
    for (const item of activity.items) {
      for (const sentLot of item.suggestedLots) {
        const sourceSnap = sourceMap.get(sentLot.lotId);
        if (!sourceSnap?.exists) {
          throw new Error(`Lote ${sentLot.lotId} não encontrado.`);
        }
        const source = sourceSnap.data() as LotEntry;
        const destId = destLotIdKey({
          productId: sentLot.productId,
          kioskId: activity.kioskDestinationId,
          lotNumber: sentLot.lotNumber,
          expiryDate: source.expiryDate,
        });
        if (!destRefs.has(destId)) {
          destRefs.set(destId, dbAdmin.collection("lots").doc(destId));
        }
      }
    }
    const destDocs = await Promise.all(
      Array.from(destRefs.values()).map((ref) => tx.get(ref))
    );
    const destMap = new Map(destDocs.map((doc) => [doc.id, doc]));

    for (const item of activity.items) {
      for (const sentLot of item.suggestedLots) {
        const sourceSnap = sourceMap.get(sentLot.lotId);
        if (!sourceSnap?.exists) continue;

        const source = sourceSnap.data() as LotEntry;
        const receivedLot = item.receivedLots?.find((lot) => lot.lotId === sentLot.lotId);
        const receivedQty =
          activity.status === "Recebido com divergência" && receivedLot
            ? Number(receivedLot.receivedQuantity ?? 0)
            : sentLot.quantityToMove;
        const qtyToMove =
          params.resolution === "trust_receipt" ? receivedQty : sentLot.quantityToMove;
        const reserved = Number(source.reservedQuantity ?? 0);
        const quantity = Number(source.quantity ?? 0);
        const reserveToRelease = sentLot.quantityToMove;

        if (qtyToMove > 0) {
          const destId = destLotIdKey({
            productId: sentLot.productId,
            kioskId: activity.kioskDestinationId,
            lotNumber: sentLot.lotNumber,
            expiryDate: source.expiryDate,
          });
          const destRef = destRefs.get(destId)!;
          const destSnap = destMap.get(destId);

          tx.update(sourceRefs.get(sentLot.lotId)!, {
            quantity: quantity - qtyToMove,
            reservedQuantity: Math.max(0, reserved - reserveToRelease),
            updatedAt: now,
          });

          if (destSnap?.exists) {
            const destData = destSnap.data() as LotEntry;
            tx.update(destRef, {
              quantity: Number(destData.quantity ?? 0) + qtyToMove,
              updatedAt: now,
            });
          } else {
            tx.set(destRef, {
              ...source,
              kioskId: activity.kioskDestinationId,
              quantity: qtyToMove,
              reservedQuantity: 0,
              locationId: null,
              locationName: null,
              locationCode: null,
              createdAt: now,
              updatedAt: now,
            });
          }

          const common = {
            productId: sentLot.productId,
            productName: sentLot.productName,
            lotNumber: sentLot.lotNumber,
            quantityChange: qtyToMove,
            userId: params.actor.userId,
            username: params.actor.username,
            timestamp: now,
            activityId: activity.id,
            fromKioskId: activity.kioskOriginId,
            fromKioskName: activity.kioskOriginName,
            toKioskId: activity.kioskDestinationId,
            toKioskName: activity.kioskDestinationName,
          };
          addMovementRecord(tx, {
            ...common,
            lotId: sentLot.lotId,
            type: "TRANSFERENCIA_SAIDA",
          });
          addMovementRecord(tx, {
            ...common,
            lotId: destRef.id,
            type: "TRANSFERENCIA_ENTRADA",
          });
        } else {
          tx.update(sourceRefs.get(sentLot.lotId)!, {
            reservedQuantity: Math.max(0, reserved - reserveToRelease),
            updatedAt: now,
          });
        }
      }
    }

    tx.update(activityRef, {
      status: "Concluído",
      updatedAt: now,
      updatedBy: params.actor,
    });
  });
}

export async function reopenDispatchServer(activityId: string, actor: Actor) {
  await dbAdmin.collection("repositionActivities").doc(activityId).set(
    {
      status: "Aguardando despacho",
      transportSignature: null,
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    },
    { merge: true }
  );
}

export async function reopenAuditServer(activityId: string, actor: Actor) {
  const ref = dbAdmin.collection("repositionActivities").doc(activityId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Reposição não encontrada.");
  const activity = snap.data() as Omit<RepositionActivity, "id">;

  await ref.set(
    {
      status: "Aguardando recebimento",
      receiptNotes: "",
      receiptSignature: null,
      items: activity.items.map((item) => ({
        ...item,
        receivedLots: [],
      })),
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    },
    { merge: true }
  );
}

export async function revertRepositionActivityServer(activityId: string, actor: Actor) {
  const activityRef = dbAdmin.collection("repositionActivities").doc(activityId);
  const movementsSnap = await dbAdmin
    .collection("movementHistory")
    .where("activityId", "==", activityId)
    .get();

  const activitySnap = await activityRef.get();
  if (!activitySnap.exists) {
    throw new Error("Reposição não encontrada.");
  }

  const activity = {
    id: activitySnap.id,
    ...(activitySnap.data() as Omit<RepositionActivity, "id">),
  };
  if (activity.status !== "Concluído") {
    throw new Error("Só é possível reverter atividades concluídas.");
  }

  const movements = movementsSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<MovementRecord, "id">) }))
    .filter((movement) => movement.reverted !== true);

  const entryMovements = movements.filter((movement) => movement.type === "TRANSFERENCIA_ENTRADA");
  const exitMovements = movements.filter((movement) => movement.type === "TRANSFERENCIA_SAIDA");
  const now = new Date().toISOString();

  await dbAdmin.runTransaction(async (tx) => {
    for (const entry of entryMovements) {
      const matchingExit = exitMovements.find(
        (movement) =>
          movement.productId === entry.productId &&
          movement.lotNumber === entry.lotNumber &&
          movement.quantityChange === entry.quantityChange &&
          movement.fromKioskId === entry.fromKioskId &&
          movement.toKioskId === entry.toKioskId
      );
      if (!matchingExit) continue;

      const destRef = dbAdmin.collection("lots").doc(entry.lotId);
      const sourceRef = dbAdmin.collection("lots").doc(matchingExit.lotId);
      const [destSnap, sourceSnap] = await Promise.all([tx.get(destRef), tx.get(sourceRef)]);
      if (!destSnap.exists || !sourceSnap.exists) continue;

      const destData = destSnap.data() as LotEntry;
      const sourceData = sourceSnap.data() as LotEntry;

      tx.update(destRef, {
        quantity: Number(destData.quantity ?? 0) - entry.quantityChange,
        updatedAt: now,
      });
      tx.update(sourceRef, {
        quantity: Number(sourceData.quantity ?? 0) + entry.quantityChange,
        updatedAt: now,
      });

      addMovementRecord(tx, {
        lotId: sourceRef.id,
        productId: entry.productId,
        productName: entry.productName,
        lotNumber: entry.lotNumber,
        type: "ENTRADA_ESTORNO",
        quantityChange: entry.quantityChange,
        fromKioskId: entry.toKioskId,
        fromKioskName: entry.toKioskName,
        toKioskId: entry.fromKioskId,
        toKioskName: entry.fromKioskName,
        userId: actor.userId,
        username: actor.username,
        timestamp: now,
        notes: `Estorno da atividade de reposição ${activityId}`,
        revertedFromId: entry.id,
        activityId,
      });
      addMovementRecord(tx, {
        lotId: destRef.id,
        productId: entry.productId,
        productName: entry.productName,
        lotNumber: entry.lotNumber,
        type: "SAIDA_ESTORNO",
        quantityChange: entry.quantityChange,
        fromKioskId: entry.fromKioskId,
        fromKioskName: entry.fromKioskName,
        toKioskId: entry.toKioskId,
        toKioskName: entry.toKioskName,
        userId: actor.userId,
        username: actor.username,
        timestamp: now,
        notes: `Estorno da atividade de reposição ${activityId}`,
        revertedFromId: matchingExit.id,
        activityId,
      });

      tx.update(dbAdmin.collection("movementHistory").doc(entry.id), { reverted: true });
      tx.update(dbAdmin.collection("movementHistory").doc(matchingExit.id), { reverted: true });
    }

    for (const item of activity.items) {
      for (const lot of item.suggestedLots) {
        const lotRef = dbAdmin.collection("lots").doc(lot.lotId);
        const lotSnap = await tx.get(lotRef);
        if (!lotSnap.exists) continue;
        const currentReserved = Number(lotSnap.data()?.reservedQuantity ?? 0);
        tx.update(lotRef, {
          reservedQuantity: currentReserved + lot.quantityToMove,
          updatedAt: now,
        });
      }
    }

    tx.update(activityRef, {
      status: "Aguardando despacho",
      isSeparated: false,
      receiptNotes: "",
      receiptSignature: null,
      transportSignature: null,
      updatedAt: now,
      updatedBy: actor,
    });
  });
}
