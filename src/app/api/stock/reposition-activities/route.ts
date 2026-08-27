import { NextRequest, NextResponse } from "next/server";

import { syncRepositionTaskSafely } from "@/features/reposition/lib/task-sync";
import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { canAccessAnyUnit, canAccessUnit } from "@/lib/unit-access";
import { type RepositionActivity } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE_REPOSITION_STATUSES: RepositionActivity["status"][] = [
  "Aguardando despacho",
  "Aguardando recebimento",
  "Recebido com divergência",
  "Recebido sem divergência",
];

function toSummary(activity: RepositionActivity): RepositionActivity {
  const stripEmbeddedSignature = (signature?: RepositionActivity["receiptSignature"]) => {
    if (!signature) return undefined;
    const { dataUrl: _dataUrl, ...metadata } = signature;
    return metadata;
  };

  return {
    ...activity,
    items: ACTIVE_REPOSITION_STATUSES.includes(activity.status) ? activity.items : [],
    transportSignature: stripEmbeddedSignature(activity.transportSignature),
    receiptSignature: stripEmbeddedSignature(activity.receiptSignature),
    separationSignature: stripEmbeddedSignature(activity.separationSignature),
    separationChecklist: undefined,
  };
}

function toFullListItem(activity: RepositionActivity): RepositionActivity {
  if (ACTIVE_REPOSITION_STATUSES.includes(activity.status)) return activity;
  const stripEmbeddedSignature = (signature?: RepositionActivity["receiptSignature"]) => {
    if (!signature) return undefined;
    const { dataUrl: _dataUrl, ...metadata } = signature;
    return metadata;
  };
  return {
    ...activity,
    transportSignature: stripEmbeddedSignature(activity.transportSignature),
    receiptSignature: stripEmbeddedSignature(activity.receiptSignature),
    separationSignature: stripEmbeddedSignature(activity.separationSignature),
  };
}

function canManage(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || !!context.permissions?.reposition?.prepareDispatch || !!context.permissions?.stock?.analysis?.restock;
}

function canView(context: Awaited<ReturnType<typeof requireUser>>) {
  return canManage(context) || !!context.permissions?.reposition?.view || !!context.permissions?.reposition?.receive;
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canView(context)) {
      return NextResponse.json(
        { error: "Sem permissão para visualizar reposições." },
        { status: 403 }
      );
    }

    const detail = request.nextUrl.searchParams.get("detail") === "full" ? "full" : "summary";
    const snap = await dbAdmin.collection("repositionActivities").get();
    const activities = snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<RepositionActivity, "id">) }))
      .filter((activity) => canAccessAnyUnit(
        context.userDoc,
        [activity.kioskOriginId, activity.kioskDestinationId],
        { isDefaultAdmin: context.isDefaultAdmin }
      ))
      .map((activity) => detail === "full" ? toFullListItem(activity) : toSummary(activity))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return NextResponse.json(
      { activities },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Reposition-Detail": detail,
        },
      }
    );
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

    const canAccessOrigin = canAccessUnit(context.userDoc, body.kioskOriginId, {
      isDefaultAdmin: context.isDefaultAdmin,
    });
    const canAccessDestination = canAccessUnit(context.userDoc, body.kioskDestinationId, {
      isDefaultAdmin: context.isDefaultAdmin,
    });
    if (!canAccessOrigin || !canAccessDestination) {
      return NextResponse.json(
        { error: "A origem e o destino precisam estar dentro do seu escopo de unidades." },
        { status: 403 }
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
      requestId: typeof body.requestId === "string" ? body.requestId : undefined,
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

    const task = await syncRepositionTaskSafely({
      context,
      activity: payload,
      label: "create",
    });
    if (task) {
      payload.taskId = task.id;
    }

    if (payload.requestId) {
      await dbAdmin.collection("repositionRequests").doc(payload.requestId).set(
        {
          status: "Em separação",
          activityId: activityRef.id,
          reviewedBy: {
            userId: context.userDoc.id,
            username: context.userDoc.username,
          },
          reviewedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    return NextResponse.json({ activity: payload }, { status: 201 });
  } catch (error) {
    console.error("[REPOSITION POST] Erro ao criar reposição", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao criar reposição.",
      },
      { status: 400 }
    );
  }
}
