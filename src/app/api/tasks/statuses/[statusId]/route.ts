import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { assertTaskPermission, assertTasksModuleEnabled } from "@/features/tasks/lib/server-access";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      typeof body.name !== "string" ||
      !body.name.trim() ||
      typeof body.slug !== "string" ||
      !body.slug.trim()
    ) {
      return NextResponse.json({ error: "Projeto, nome e slug são obrigatórios." }, { status: 400 });
    }

    const patch = {
      project_id: body.project_id,
      name: body.name.trim(),
      slug: body.slug.trim(),
      category: typeof body.category === "string" ? body.category : "active",
      is_initial: body.is_initial === true,
      is_terminal: body.is_terminal === true,
      order: typeof body.order === "number" ? body.order : 0,
      color: typeof body.color === "string" ? body.color : null,
    };
    await ref.update(patch);

    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "tasks",
      action: "status_updated",
      metadata: { status_id: statusId, project_id: patch.project_id, slug: patch.slug },
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
