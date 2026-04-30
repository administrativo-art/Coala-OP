import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import {
  assertTaskPermission,
  assertTasksModuleEnabled,
} from "@/features/tasks/lib/server-access";
import { updateTaskStatus } from "@/features/tasks/lib/server";
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
      | { status?: Task["status"]; details?: string }
      | null;

    if (!body?.status) {
      return NextResponse.json(
        { error: "Status da tarefa é obrigatório." },
        { status: 400 }
      );
    }

    const task = await updateTaskStatus({
      context,
      taskId,
      status: body.status,
      ...(typeof body.details === "string" ? { details: body.details } : {}),
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

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao atualizar o status da tarefa.",
      },
      { status: code ?? 400 }
    );
  }
}
