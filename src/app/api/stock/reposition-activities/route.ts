import { NextRequest, NextResponse } from "next/server";

import { createManualTask } from "@/features/tasks/lib/server";
import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { type RepositionActivity } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canManage(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || !!context.permissions?.stock?.analysis?.restock;
}

function buildRepositionTaskDescription(activity: Pick<
  RepositionActivity,
  "kioskOriginName" | "kioskDestinationName" | "items" | "status"
>) {
  const totalItems = activity.items.length;
  return `${activity.kioskOriginName} -> ${activity.kioskDestinationName}. ${totalItems} ${totalItems === 1 ? "item" : "itens"}. Status: ${activity.status}.`;
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canManage(context)) {
      return NextResponse.json(
        { error: "Sem permissão para visualizar reposições." },
        { status: 403 }
      );
    }

    const snap = await dbAdmin.collection("repositionActivities").get();
    const activities = snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<RepositionActivity, "id">) }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return NextResponse.json({ activities });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao carregar reposições.",
      },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canManage(context)) {
      return NextResponse.json(
        { error: "Sem permissão para criar reposições." },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => null)) as
      | Partial<RepositionActivity>
      | null;
    if (
      !body ||
      typeof body.kioskOriginId !== "string" ||
      typeof body.kioskOriginName !== "string" ||
      typeof body.kioskDestinationId !== "string" ||
      typeof body.kioskDestinationName !== "string" ||
      !Array.isArray(body.items) ||
      body.items.length === 0
    ) {
      return NextResponse.json(
        { error: "Payload inválido para criação da reposição." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const activityRef = dbAdmin.collection("repositionActivities").doc();
    const payload: RepositionActivity = {
      id: activityRef.id,
      kioskOriginId: body.kioskOriginId,
      kioskOriginName: body.kioskOriginName,
      kioskDestinationId: body.kioskDestinationId,
      kioskDestinationName: body.kioskDestinationName,
      items: body.items,
      status: "Aguardando despacho",
      isSeparated: false,
      requestedBy: {
        userId: context.userDoc.id,
        username: context.userDoc.username,
      },
      createdAt: now,
      updatedAt: now,
    };

    await dbAdmin.runTransaction(async (tx) => {
      const lotMap = new Map<string, { ref: FirebaseFirestore.DocumentReference; quantityToReserve: number }>();
      
      for (const item of payload.items) {
        for (const lot of item.suggestedLots) {
          const existing = lotMap.get(lot.lotId);
          if (existing) {
            existing.quantityToReserve += lot.quantityToMove;
          } else {
            lotMap.set(lot.lotId, {
              ref: dbAdmin.collection("lots").doc(lot.lotId),
              quantityToReserve: lot.quantityToMove
            });
          }
        }
      }

      const lotEntries = Array.from(lotMap.values());
      const lotSnaps = await Promise.all(lotEntries.map(entry => tx.get(entry.ref)));
      const lotDataMap = new Map(lotSnaps.map((snap) => [snap.id, snap.data()]));

      for (const entry of lotEntries) {
        const currentData = lotDataMap.get(entry.ref.id);
        if (!currentData) {
          throw new Error(`Lote ${entry.ref.id} não encontrado.`);
        }

        const reserved = Number(currentData.reservedQuantity ?? 0);
        const quantity = Number(currentData.quantity ?? 0);
        const available = quantity - reserved;
        if (available < entry.quantityToReserve) {
          throw new Error(
            `Estoque insuficiente para reservar no lote ${currentData.lotNumber || entry.ref.id}.`
          );
        }
      }

      tx.set(activityRef, payload);
      for (const entry of lotEntries) {
        tx.update(entry.ref, {
          reservedQuantity: Number(
            (lotDataMap.get(entry.ref.id)?.reservedQuantity as number | undefined) ?? 0
          ) + entry.quantityToReserve,
        });
      }
    });

    const task = await createManualTask({
      context,
      input: {
        title: `Reposição ${payload.kioskOriginName} -> ${payload.kioskDestinationName}`,
        description: buildRepositionTaskDescription(payload),
        assigneeType: "user",
        assigneeId: context.userDoc.id,
        origin: {
          kind: "legacy",
          type: "reposition_activity",
          id: activityRef.id,
        },
      },
    });

    payload.taskId = task.id;
    await activityRef.set({ taskId: task.id }, { merge: true });

    return NextResponse.json({ activity: payload }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao criar reposição.",
      },
      { status: 400 }
    );
  }
}
