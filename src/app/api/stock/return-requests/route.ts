import { addDays, format } from "date-fns";
import { NextRequest, NextResponse } from "next/server";

import { createManualTask } from "@/features/tasks/lib/server";
import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { type ReturnRequest } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canReadRequests(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || !!context.permissions?.stock?.returns?.view;
}

function canCreateRequests(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || !!context.permissions?.stock?.returns?.add;
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canReadRequests(context)) {
      return NextResponse.json(
        { error: "Sem permissão para visualizar avarias." },
        { status: 403 }
      );
    }

    const snap = await dbAdmin.collection("returnRequests").get();
    const requests = snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<ReturnRequest, "id">) }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return NextResponse.json({ requests });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao carregar avarias.",
      },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canCreateRequests(context)) {
      return NextResponse.json(
        { error: "Sem permissão para criar avarias." },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (
      !body ||
      (body.tipo !== "devolucao" && body.tipo !== "bonificacao") ||
      typeof body.insumoId !== "string" ||
      !body.insumoId ||
      typeof body.lote !== "string" ||
      !body.lote.trim() ||
      typeof body.quantidade !== "number" ||
      body.quantidade <= 0 ||
      typeof body.motivo !== "string" ||
      body.motivo.trim().length < 10
    ) {
      return NextResponse.json(
        { error: "Payload inválido para abertura da avaria." },
        { status: 400 }
      );
    }

    const tipo = body.tipo;
    const insumoId = body.insumoId;
    const lote = body.lote.trim();
    const quantidade = body.quantidade;
    const motivo = body.motivo.trim();

    const productSnap = await dbAdmin.collection("products").doc(insumoId).get();
    if (!productSnap.exists) {
      return NextResponse.json({ error: "Insumo não encontrado." }, { status: 404 });
    }

    const productData = productSnap.data() ?? {};
    const productName =
      typeof productData.name === "string" && productData.name.trim()
        ? productData.name
        : body.insumoId;

    const today = format(new Date(), "yyyy-MM-dd");
    const counterRef = dbAdmin.collection("counters").doc(`returnRequests_${today}`);
    const requestRef = dbAdmin.collection("returnRequests").doc();

    const { requestPayload, newCount } = await dbAdmin.runTransaction(async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const currentCount = Number(counterSnap.data()?.count ?? 0);
      const nextCount = currentCount + 1;
      const prefix = body.tipo === "devolucao" ? "DEV" : "BON";
      const sequence = String(nextCount).padStart(4, "0");
      const numero = `${prefix}-${today.replace(/-/g, "")}-${sequence}`;
      const now = new Date();
      const nowIso = now.toISOString();

      const payload: Omit<ReturnRequest, "id"> = {
        numero,
        insumoId,
        insumoNome: productName,
        lote,
        quantidade,
        tipo,
        motivo,
        status: "em_andamento",
        dataPrevisaoRetorno: addDays(now, 45).toISOString(),
        historico: [
          {
            statusAnterior: "em_andamento",
            statusNovo: "em_andamento",
            changedBy: {
              userId: context.userDoc.id,
              username: context.userDoc.username,
            },
            changedAt: nowIso,
            detalhes: "Chamado criado.",
          },
        ],
        checklist: {},
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: {
          userId: context.userDoc.id,
          username: context.userDoc.username,
        },
      } as Omit<ReturnRequest, "id">;

      return { requestPayload: payload, newCount: nextCount };
    });

    const task = await createManualTask({
      context,
      input: {
        title: `Avaria ${requestPayload.numero}: ${productName}`,
        description: motivo,
        assigneeType: "profile",
        assigneeId: "admin",
        origin: {
          kind: "legacy",
          type: "return_request",
          id: requestRef.id,
        },
      },
    });

    const finalPayload = { ...requestPayload, taskId: task.id };
    await dbAdmin.runTransaction(async (tx) => {
      tx.set(requestRef, finalPayload);
      tx.set(counterRef, { count: newCount }, { merge: true });
    });

    const created = { id: requestRef.id, ...finalPayload } as ReturnRequest;

    return NextResponse.json({ request: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao criar avaria.",
      },
      { status: 400 }
    );
  }
}
