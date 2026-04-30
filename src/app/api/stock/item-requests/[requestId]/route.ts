import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { updateTaskDocument } from "@/features/tasks/lib/server";
import { type ItemAdditionRequest, type Task, type TaskHistoryItem } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canApproveRequests(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || context.permissions.itemRequests.approve;
}

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function PATCH(request: NextRequest, contextArg: RouteContext) {
  try {
    const context = await requireUser(request);
    if (!canApproveRequests(context)) {
      return NextResponse.json(
        { error: "Sem permissão para atualizar solicitações." },
        { status: 403 }
      );
    }

    const { requestId } = await contextArg.params;
    const body = (await request.json().catch(() => null)) as
      | { status?: "completed" | "rejected" }
      | null;

    if (body?.status !== "completed" && body?.status !== "rejected") {
      return NextResponse.json(
        { error: "Status inválido para a solicitação." },
        { status: 400 }
      );
    }

    const requestRef = dbAdmin.collection("itemAdditionRequests").doc(requestId);
    const snap = await requestRef.get();
    if (!snap.exists) {
      return NextResponse.json(
        { error: "Solicitação não encontrada." },
        { status: 404 }
      );
    }

    const currentRequest = {
      id: snap.id,
      ...(snap.data() as Omit<ItemAdditionRequest, "id">),
    };
    const now = new Date().toISOString();
    const payload: Partial<ItemAdditionRequest> = {
      status: body.status,
      reviewedBy: {
        userId: context.userDoc.id,
        username: context.userDoc.username,
      },
      reviewedAt: now,
    };

    await requestRef.set(payload, { merge: true });

    if (currentRequest.taskId) {
      const taskSnap = await dbAdmin.collection("tasks").doc(currentRequest.taskId).get();
      const currentTaskData = (taskSnap.data() ?? {}) as Partial<Task>;
      const currentHistory = Array.isArray(currentTaskData.history)
        ? (currentTaskData.history as TaskHistoryItem[])
        : [];

      await updateTaskDocument({
        context,
        taskId: currentRequest.taskId,
        updates: {
          status: "completed",
          completedAt: now,
          history: [
            ...currentHistory,
            {
              timestamp: now,
              author: { id: context.userDoc.id, name: context.userDoc.username },
              action: "completed",
              details: `Solicitação marcada como '${body.status === "completed" ? "Concluída" : "Rejeitada"}'.`,
            },
          ],
        },
      });
    }

    return NextResponse.json({
      request: {
        ...currentRequest,
        ...payload,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao atualizar solicitação.",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest, contextArg: RouteContext) {
  try {
    const context = await requireUser(request);
    if (!context.isDefaultAdmin) {
      return NextResponse.json(
        { error: "Sem permissão para excluir solicitações." },
        { status: 403 }
      );
    }

    const { requestId } = await contextArg.params;
    await dbAdmin.collection("itemAdditionRequests").doc(requestId).delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao excluir solicitação.",
      },
      { status: 400 }
    );
  }
}
