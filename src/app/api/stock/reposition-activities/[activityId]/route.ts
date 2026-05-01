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
      tx.update(ref, {
        status: "Cancelada",
        updatedAt: cancelTimestamp,
        updatedBy: {
          userId: context.userDoc.id,
          username: context.userDoc.username,
        },
      });

      const activeStatuses = [
        "Aguardando despacho",
        "Aguardando recebimento",
        "Recebido com divergência",
        "Recebido sem divergência",
      ];

      if (activeStatuses.includes(current.status)) {
        for (const item of current.items) {
          for (const lot of item.suggestedLots) {
            const lotRef = dbAdmin.collection("lots").doc(lot.lotId);
            const lotSnap = await tx.get(lotRef);
            const currentReserved = Number(lotSnap.data()?.reservedQuantity ?? 0);
            tx.update(lotRef, {
              reservedQuantity: Math.max(0, currentReserved - lot.quantityToMove),
            });
          }
        }
      }
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
