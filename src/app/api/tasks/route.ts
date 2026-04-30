import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import {
  assertTaskPermission,
  assertTasksModuleEnabled,
} from "@/features/tasks/lib/server-access";
import {
  createManualTask,
  ensureDefaultTaskProject,
  listTaskProjects,
  listTaskStatuses,
  listTasks,
} from "@/features/tasks/lib/server";
import { type TaskOrigin } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    await assertTasksModuleEnabled(context.workspace_id);
    assertTaskPermission(
      context.permissions,
      context.isDefaultAdmin,
      null,
      "view"
    );

    await ensureDefaultTaskProject(context);
    const projects = await listTaskProjects(context.workspace_id);
    const statuses = await listTaskStatuses(projects.map((project) => project.id));
    const tasks = await listTasks(context.workspace_id);

    return NextResponse.json({ projects, statuses, tasks });
  } catch (error) {
    const status =
      error instanceof Error &&
      error.message.toLowerCase().includes("permiss")
        ? 403
        : 400;

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao carregar as tarefas.",
      },
      { status }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    await assertTasksModuleEnabled(context.workspace_id);
    assertTaskPermission(
      context.permissions,
      context.isDefaultAdmin,
      null,
      "manage"
    );

    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!body || typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json(
        { error: "Título da tarefa é obrigatório." },
        { status: 400 }
      );
    }

    const origin =
      body?.origin &&
      typeof body.origin === "object" &&
      body.origin !== null &&
      "kind" in body.origin
        ? (body.origin as TaskOrigin)
        : undefined;

    const task = await createManualTask({
      context,
      input: {
        title: body.title.trim(),
        ...(typeof body.description === "string"
          ? { description: body.description.trim() }
          : {}),
        ...(body.assigneeType === "profile" || body.assigneeType === "user"
          ? { assigneeType: body.assigneeType }
          : {}),
        ...(typeof body.assigneeId === "string" ? { assigneeId: body.assigneeId } : {}),
        ...(typeof body.requiresApproval === "boolean"
          ? { requiresApproval: body.requiresApproval }
          : {}),
        ...(body.approverType === "profile" || body.approverType === "user"
          ? { approverType: body.approverType }
          : {}),
        ...(typeof body.approverId === "string" ? { approverId: body.approverId } : {}),
        ...(typeof body.dueDate === "string" ? { dueDate: body.dueDate } : {}),
        ...(typeof body.projectId === "string" ? { projectId: body.projectId } : {}),
        ...(origin && (origin.kind === "manual" || origin.kind === "legacy")
          ? { origin }
          : {}),
      },
    });

    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    const status =
      error instanceof Error &&
      error.message.toLowerCase().includes("permiss")
        ? 403
        : 400;

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao criar a tarefa.",
      },
      { status }
    );
  }
}
