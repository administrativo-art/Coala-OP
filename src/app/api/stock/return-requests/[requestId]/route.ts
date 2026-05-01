import { NextRequest, NextResponse } from "next/server";

import { updateTaskDocument } from "@/features/tasks/lib/server";
import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { type ReturnRequest, type ReturnRequestHistoricoItem, type Task } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

function canUpdateRequests(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || !!context.permissions?.stock?.returns?.updateStatus;
}

function canDeleteRequests(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || !!context.permissions?.stock?.returns?.delete;
}

function cleanUndefined<T extends Record<string, unknown>>(value: T) {
  const next = { ...value };
  Object.keys(next).forEach((key) => {
    if (next[key] === undefined) {
      delete next[key];
    }
  });
  return next;
}

function mapReturnStatusToTaskStatus(status: ReturnRequest["status"]): Task["status"] {
  if (status === "finalizado_sucesso") return "completed";
  if (status === "finalizado_erro") return "rejected";
  return "in_progress";
}

export async function PATCH(request: NextRequest, routeContext: RouteContext) {
  try {
    const context = await requireUser(request);
    if (!canUpdateRequests(context)) {
      return NextResponse.json(
        { error: "Sem permissão para atualizar avarias." },
        { status: 403 }
      );
    }

    const { requestId } = await routeContext.params;
    const body = (await request.json().catch(() => null)) as
      | Partial<ReturnRequest>
      | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
    }

    const requestRef = dbAdmin.collection("returnRequests").doc(requestId);
    const snap = await requestRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Avaria não encontrada." }, { status: 404 });
    }

    const current = {
      id: snap.id,
      ...(snap.data() as Omit<ReturnRequest, "id">),
    };

    const now = new Date().toISOString();
    const updateData: Partial<ReturnRequest> = cleanUndefined({
      status: body.status,
      dataPrevisaoRetorno: body.dataPrevisaoRetorno,
      dataContatoRepresentante: body.dataContatoRepresentante,
      dataConclusao: body.dataConclusao,
      detalhesResultado: body.detalhesResultado,
      anexos: body.anexos,
      checklist: body.checklist,
      isArchived: body.isArchived,
      updatedAt: now,
    });

    if (body.status && body.status !== current.status) {
      const historyItem: ReturnRequestHistoricoItem = {
        statusAnterior: current.status,
        statusNovo: body.status,
        changedBy: {
          userId: context.userDoc.id,
          username: context.userDoc.username,
        },
        changedAt: now,
        ...(body.detalhesResultado
          ? { detalhes: body.detalhesResultado }
          : {}),
      };
      updateData.historico = [...current.historico, historyItem];
    } else {
      updateData.historico = current.historico;
    }

    await requestRef.set(updateData, { merge: true });

    const taskId =
      typeof (current as ReturnRequest & { taskId?: string }).taskId === "string"
        ? (current as ReturnRequest & { taskId?: string }).taskId
        : null;

    if (taskId && body.status) {
      await updateTaskDocument({
        context,
        taskId,
        updates: {
          status: mapReturnStatusToTaskStatus(body.status),
        },
      });
    }

    return NextResponse.json({
      request: {
        ...current,
        ...updateData,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao atualizar avaria.",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest, routeContext: RouteContext) {
  try {
    const context = await requireUser(request);
    if (!canDeleteRequests(context)) {
      return NextResponse.json(
        { error: "Sem permissão para excluir avarias." },
        { status: 403 }
      );
    }

    const { requestId } = await routeContext.params;
    await dbAdmin.collection("returnRequests").doc(requestId).delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao excluir avaria.",
      },
      { status: 400 }
    );
  }
}
