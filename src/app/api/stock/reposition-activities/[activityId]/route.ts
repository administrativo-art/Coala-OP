import { NextRequest, NextResponse } from "next/server";

import { syncRepositionTaskSafely } from "@/features/reposition/lib/task-sync";
import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { canAccessAnyUnit, canAccessUnit } from "@/lib/unit-access";
import { type RepositionActivity } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ activityId: string }>;
};

function canManage(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || !!context.permissions?.reposition?.prepareDispatch || !!context.permissions?.stock?.analysis?.restock;
}

function canCancel(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || !!context.permissions?.reposition?.cancel;
}

function canReceiveActivity(
  context: Awaited<ReturnType<typeof requireUser>>,
  activity: RepositionActivity
) {
  if (!context.permissions?.reposition?.receive) return false;
  return canAccessUnit(context.userDoc, activity.kioskDestinationId, {
    isDefaultAdmin: context.isDefaultAdmin,
  });
}

function canAccessActivity(
  context: Awaited<ReturnType<typeof requireUser>>,
  activity: Pick<RepositionActivity, "kioskOriginId" | "kioskDestinationId">
) {
  return canAccessAnyUnit(
    context.userDoc,
    [activity.kioskOriginId, activity.kioskDestinationId],
    { isDefaultAdmin: context.isDefaultAdmin }
  );
}

function isReceiptUpdate(body: Partial<RepositionActivity>) {
  return (
    body.status === "Recebido com divergência" ||
    body.status === "Recebido sem divergência" ||
    body.receiptSignature !== undefined
  );
}

function cleanUndefined<T extends Record<string, unknown>>(value: T) {
  const next = { ...value };
  Object.keys(next).forEach((key) => {
    if (next[key] === undefined) delete next[key];
  });
  return next;
}

const ACTIVE_REPOSITION_RESERVATION_STATUSES: RepositionActivity["status"][] = [
  "Aguardando despacho",
  "Aguardando recebimento",
  "Recebido com divergência",
  "Recebido sem divergência",
];

function computeActiveReservationsByLot(
  activities: RepositionActivity[],
  lotIds: Set<string>,
  excludeActivityId: string
) {
  const totals = new Map<string, number>();

  for (const activity of activities) {
    if (activity.id === excludeActivityId) continue;
    if (!ACTIVE_REPOSITION_RESERVATION_STATUSES.includes(activity.status)) continue;

    for (const item of activity.items ?? []) {
      for (const lot of item.suggestedLots ?? []) {
        if (!lotIds.has(lot.lotId)) continue;
        totals.set(lot.lotId, (totals.get(lot.lotId) ?? 0) + Number(lot.quantityToMove ?? 0));
      }
    }
  }

  return totals;
}

export async function PATCH(request: NextRequest, routeContext: RouteContext) {
  try {
    const context = await requireUser(request);
    const { activityId } = await routeContext.params;
    const body = (await request.json().catch(() => null)) as
      | Partial<RepositionActivity>
      | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
    }

    const ref = dbAdmin.collection("repositionActivities").doc(activityId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json(
        { error: "Reposição não encontrada." },
        { status: 404 }
      );
    }
    const currentActivity = {
      id: snap.id,
      ...(snap.data() as Omit<RepositionActivity, "id">),
    } as RepositionActivity;

    if (!canAccessActivity(context, currentActivity)) {
      return NextResponse.json(
        { error: "Reposição fora do seu escopo de unidades." },
        { status: 403 }
      );
    }

    const hasManagePermission = canManage(context);
    const isAllowed =
      hasManagePermission ||
      (isReceiptUpdate(body) && canReceiveActivity(context, currentActivity));

    if (!isAllowed) {
      return NextResponse.json(
        { error: "Sem permissão para atualizar reposições." },
        { status: 403 }
      );
    }

    const allowedBody = hasManagePermission
      ? body
      : {
          status: body.status,
          items: body.items,
          receiptNotes: body.receiptNotes,
          receiptSignature: body.receiptSignature,
        };

    const nextOriginId = allowedBody.kioskOriginId ?? currentActivity.kioskOriginId;
    const nextDestinationId = allowedBody.kioskDestinationId ?? currentActivity.kioskDestinationId;
    if (
      hasManagePermission &&
      (!canAccessUnit(context.userDoc, nextOriginId, { isDefaultAdmin: context.isDefaultAdmin }) ||
        !canAccessUnit(context.userDoc, nextDestinationId, { isDefaultAdmin: context.isDefaultAdmin }))
    ) {
      return NextResponse.json(
        { error: "A origem e o destino precisam estar dentro do seu escopo de unidades." },
        { status: 403 }
      );
    }

    const updateData = cleanUndefined({
      ...allowedBody,
      updatedAt: new Date().toISOString(),
      updatedBy: {
        userId: context.userDoc.id,
        username: context.userDoc.username,
      },
    });

    await ref.set(updateData, { merge: true });
    const nextActivity = {
      ...currentActivity,
      ...updateData,
    } as RepositionActivity;

    if (typeof updateData.status === "string") {
      const task = await syncRepositionTaskSafely({
        context,
        activity: nextActivity,
        label: "patch",
      });
      if (task && nextActivity.taskId !== task.id) {
        nextActivity.taskId = task.id;
      }
    }

    return NextResponse.json({
      activity: nextActivity,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao atualizar reposição.",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest, routeContext: RouteContext) {
  try {
    const context = await requireUser(request);
    if (!canCancel(context) && !canManage(context)) {
      return NextResponse.json(
        { error: "Sem permissão para cancelar reposições." },
        { status: 403 }
      );
    }

    const { activityId } = await routeContext.params;
    const ref = dbAdmin.collection("repositionActivities").doc(activityId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json(
        { error: "Reposição não encontrada." },
        { status: 404 }
      );
    }

    const current = {
      id: snap.id,
      ...(snap.data() as Omit<RepositionActivity, "id">),
    };
    if (!canAccessActivity(context, current)) {
      return NextResponse.json(
        { error: "Reposição fora do seu escopo de unidades." },
        { status: 403 }
      );
    }
    if (current.status === "Concluído" || current.status === "Cancelada") {
      return NextResponse.json({ activity: current });
    }

    const cancelTimestamp = new Date().toISOString();
    await dbAdmin.runTransaction(async (tx) => {
      if (ACTIVE_REPOSITION_RESERVATION_STATUSES.includes(current.status)) {
        // First gather all unique lot IDs and their references
        const lotMap = new Map<string, { ref: FirebaseFirestore.DocumentReference; quantityToReturn: number }>();
        
        for (const item of current.items) {
          for (const lot of item.suggestedLots) {
            const existing = lotMap.get(lot.lotId);
            if (existing) {
              existing.quantityToReturn += lot.quantityToMove;
            } else {
              lotMap.set(lot.lotId, {
                ref: dbAdmin.collection("lots").doc(lot.lotId),
                quantityToReturn: lot.quantityToMove
              });
            }
          }
        }

        // Then perform all reads
        const lotEntries = Array.from(lotMap.values());
        const lotSnaps = await Promise.all(lotEntries.map(entry => tx.get(entry.ref)));
        const activitiesSnap = await tx.get(dbAdmin.collection("repositionActivities"));
        const recalculatedReservations = computeActiveReservationsByLot(
          activitiesSnap.docs.map((doc) => ({
            id: doc.id,
            ...(doc.data() as Omit<RepositionActivity, "id">),
          })),
          new Set(lotMap.keys()),
          activityId
        );
        
        // Finally perform all writes
        lotSnaps.forEach((snap, index) => {
          if (!snap.exists) return;
          const entry = lotEntries[index];
          tx.update(entry.ref, {
            reservedQuantity: recalculatedReservations.get(entry.ref.id) ?? 0,
          });
        });
      }

      tx.update(ref, {
        status: "Cancelada",
        updatedAt: cancelTimestamp,
        updatedBy: {
          userId: context.userDoc.id,
          username: context.userDoc.username,
        },
      });
    });

    await syncRepositionTaskSafely({
      context,
      activity: {
        ...(current as RepositionActivity),
        status: "Cancelada",
        updatedAt: cancelTimestamp,
        updatedBy: {
          userId: context.userDoc.id,
          username: context.userDoc.username,
        },
      },
      label: "cancel",
    });

    if (current.requestId) {
      await dbAdmin.collection("repositionRequests").doc(current.requestId).set(
        {
          status: "Cancelada",
          activityId,
          updatedAt: cancelTimestamp,
          reviewedBy: {
            userId: context.userDoc.id,
            username: context.userDoc.username,
          },
          reviewedAt: cancelTimestamp,
        },
        { merge: true }
      );
    }

    return NextResponse.json({
      activity: {
        ...current,
        status: "Cancelada",
        updatedAt: cancelTimestamp,
        updatedBy: {
          userId: context.userDoc.id,
          username: context.userDoc.username,
        },
      },
    });
  } catch (error) {
    console.error("[REPOSITION DELETE] Erro ao cancelar reposição", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao cancelar reposição.",
      },
      { status: 400 }
    );
  }
}
