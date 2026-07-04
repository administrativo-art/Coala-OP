import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { assertTaskPermission, assertTasksModuleEnabled } from "@/features/tasks/lib/server-access";
import { logAction } from "@/lib/log-action";
import { type TaskLifecycleState, type TaskStatusCategory } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseLifecycleState(value: unknown): TaskLifecycleState | null {
  return value === "open" ||
    value === "in_progress" ||
    value === "waiting" ||
    value === "blocked" ||
    value === "completed" ||
    value === "cancelled"
    ? value
    : null;
}

function inferLifecycleState(
  category: TaskStatusCategory,
  slug: string
): TaskLifecycleState {
  if (slug === "in_progress") return "in_progress";
  if (slug === "awaiting_approval") return "waiting";
  if (slug === "completed") return "completed";
  if (slug === "cancelled" || slug === "canceled") return "cancelled";
  if (category === "active") return "in_progress";
  if (category === "done") return "completed";
  if (category === "canceled") return "cancelled";
  return "open";
}

function isTerminalLifecycle(lifecycleState: TaskLifecycleState) {
  return lifecycleState === "completed" || lifecycleState === "cancelled";
}

export async function PATCH(
  request: NextRequest,
  contextArg: { params: Promise<{ statusId: string }> }
) {
  try {
    const context = await requireUser(request);
    await assertTasksModuleEnabled(context.workspace_id);
    assertTaskPermission(context.permissions, context.isDefaultAdmin, null, "manage");
    const { statusId } = await contextArg.params;

    const ref = dbAdmin.collection("task_statuses").doc(statusId);
    const existing = await ref.get();
    if (!existing.exists) {
      return NextResponse.json({ error: "Status não encontrado." }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body ||
      typeof body.project_id !== "string" ||
      !body.project_id ||
      typeof body.subproject_id !== "string" ||
      !body.subproject_id ||
      typeof body.name !== "string" ||
      !body.name.trim() ||
      typeof body.slug !== "string" ||
      !body.slug.trim()
    ) {
      return NextResponse.json({ error: "Projeto, subprojeto, nome e slug são obrigatórios." }, { status: 400 });
    }

    const existingLifecycle = parseLifecycleState(
      existing.get("lifecycle_state")
    );
    const category =
      body.category === "not_started" ||
      body.category === "active" ||
      body.category === "done" ||
      body.category === "canceled"
        ? body.category
        : "active";
    const slug = body.slug.trim();
    const requestedLifecycle = parseLifecycleState(body.lifecycle_state);
    if (
      existingLifecycle &&
      requestedLifecycle &&
      requestedLifecycle !== existingLifecycle
    ) {
      return NextResponse.json(
        { error: "lifecycle_state de status existente não pode ser alterado." },
        { status: 409 }
      );
    }
    const lifecycleState =
      existingLifecycle ?? requestedLifecycle ?? inferLifecycleState(category, slug);

    const patch = {
      project_id: body.project_id,
      subproject_id: body.subproject_id,
      name: body.name.trim(),
      slug,
      category,
      lifecycle_state: lifecycleState,
      is_initial: body.is_initial === true,
      is_terminal: isTerminalLifecycle(lifecycleState),
      order: typeof body.order === "number" ? body.order : 0,
      color: typeof body.color === "string" ? body.color : null,
      requires_completion_note: body.requires_completion_note === true,
      requires_evidence: body.requires_evidence === true,
    };
    await ref.update(patch);

    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "tasks",
      action: "status_updated",
      metadata: { status_id: statusId, project_id: patch.project_id, subproject_id: patch.subproject_id, slug: patch.slug },
    });

    return NextResponse.json({ status: { id: statusId, ...(existing.data() ?? {}), ...patch } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar status." },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  contextArg: { params: Promise<{ statusId: string }> }
) {
  try {
    const context = await requireUser(request);
    await assertTasksModuleEnabled(context.workspace_id);
    assertTaskPermission(context.permissions, context.isDefaultAdmin, null, "manage");
    const { statusId } = await contextArg.params;

    const ref = dbAdmin.collection("task_statuses").doc(statusId);
    const existing = await ref.get();
    if (!existing.exists) {
      return NextResponse.json({ error: "Status não encontrado." }, { status: 404 });
    }

    const data = (existing.data() ?? {}) as Record<string, unknown>;
    if (data.is_initial === true) {
      return NextResponse.json(
        { error: "O status inicial do projeto não pode ser removido." },
        { status: 409 }
      );
    }

    const tasksSnap = await dbAdmin
      .collection("tasks")
      .where("status_id", "==", statusId)
      .limit(1)
      .get();

    if (!tasksSnap.empty) {
      return NextResponse.json(
        { error: "Não é possível excluir um status que já está em uso." },
        { status: 409 }
      );
    }

    await ref.delete();

    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "tasks",
      action: "status_deleted",
      metadata: { status_id: statusId, project_id: data.project_id ?? null },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir status." },
      { status: 400 }
    );
  }
}
