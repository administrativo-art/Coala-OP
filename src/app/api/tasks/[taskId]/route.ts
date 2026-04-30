import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import {
  assertTaskPermission,
  assertTasksModuleEnabled,
} from "@/features/tasks/lib/server-access";
import {
  deleteTaskDocument,
  updateTaskDocument,
} from "@/features/tasks/lib/server";
import { type Task } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

export async function PATCH(request: NextRequest, contextArg: RouteContext) {
  try {
    const context = await requireUser(request);
    await assertTasksModuleEnabled(context.workspace_id);
    assertTaskPermission(
      context.permissions,
      context.isDefaultAdmin,
      null,
      "manage"
    );

    const { taskId } = await contextArg.params;
    const body = (await request.json().catch(() => null)) as
      | { updates?: Partial<Task> }
      | null;

    if (!body?.updates) {
      return NextResponse.json(
        { error: "Payload de atualização inválido." },
        { status: 400 }
      );
    }

    const task = await updateTaskDocument({
      context,
      taskId,
      updates: body.updates,
    });

    return NextResponse.json(task);
  } catch (error) {
    const code =
      typeof error === "object" &&
      error &&
      "code" in error &&
      typeof error.code === "number"
        ? error.code
        : undefined;
    const status = code ?? 400;

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao atualizar a tarefa.",
      },
      { status }
    );
  }
}

export async function DELETE(request: NextRequest, contextArg: RouteContext) {
  try {
    const context = await requireUser(request);
    await assertTasksModuleEnabled(context.workspace_id);
    assertTaskPermission(
      context.permissions,
      context.isDefaultAdmin,
      null,
      "manage"
    );

    const { taskId } = await contextArg.params;
    await deleteTaskDocument(taskId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao excluir a tarefa.",
      },
      { status: 400 }
    );
  }
}
