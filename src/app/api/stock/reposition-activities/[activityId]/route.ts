import { NextRequest, NextResponse } from "next/server";

import { updateTaskDocument } from "@/features/tasks/lib/server";
import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { type RepositionActivity } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ activityId: string }>;
};

function canManage(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || !!context.permissions?.stock?.analysis?.restock;
}

function canCancel(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || !!context.permissions?.reposition?.cancel;
}

function mapRepositionStatusToTaskStatus(status: RepositionActivity["status"]) {
  if (status === "Concluído") return "completed" as const;
  if (status === "Cancelada") return "rejected" as const;
  if (
    status === "Recebido com divergência" ||
    status === "Recebido sem divergência"
  ) {
    return "in_progress" as const;
  }
  return "pending" as const;
}

function cleanUndefined<T extends Record<string, unknown>>(value: T) {
  const next = { ...value };
  Object.keys(next).forEach((key) => {
    if (next[key] === undefined) delete next[key];
  });
  return next;
}

export async function PATCH(request: NextRequest, routeContext: RouteContext) {
  try {
    const context = await requireUser(request);
    if (!canManage(context)) {
      return NextResponse.json(
        { error: "Sem permissão para atualizar reposições." },
        { status: 403 }
      );
    }

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

    const updateData = cleanUndefined({
      ...body,
      updatedAt: new Date().toISOString(),
      updatedBy: {
        userId: context.userDoc.id,
        username: context.userDoc.username,
      },
    });

    await ref.set(updateData, { merge: true });
    const nextActivity = {
      id: snap.id,
      ...(snap.data() as Omit<RepositionActivity, "id">),
      ...updateData,
    } as RepositionActivity;

    if (nextActivity.taskId && typeof updateData.status === "string") {
      await updateTaskDocument({
        context,
        taskId: nextActivity.taskId,
        allowOriginStatusChange: true,
        updates: { status: mapRepositionStatusToTaskStatus(nextActivity.status) },
      });
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
    if (current.status === "Concluído" || current.status === "Cancelada") {
      return NextResponse.json({ activity: current });
    }

    const cancelTimestamp = new Date().toISOString();
    await dbAdmin.runTransaction(async (tx) => {
      const activeStatuses = [
        "Aguardando despacho",
        "Aguardando recebimento",
        "Recebido com divergência",
        "Recebido sem divergência",
      ];

      if (activeStatuses.includes(current.status)) {
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
        
        // Finally perform all writes
        lotSnaps.forEach((snap, index) => {
          const entry = lotEntries[index];
          const currentReserved = Number(snap.data()?.reservedQuantity ?? 0);
          tx.update(entry.ref, {
            reservedQuantity: Math.max(0, currentReserved - entry.quantityToReturn),
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

    if (current.taskId) {
      await updateTaskDocument({
        context,
        taskId: current.taskId,
        allowOriginStatusChange: true,
        updates: { status: "rejected" },
      });
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
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao cancelar reposição.",
      },
      { status: 400 }
    );
  }
}
