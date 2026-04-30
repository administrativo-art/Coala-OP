import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { assertTaskPermission, assertTasksModuleEnabled } from "@/features/tasks/lib/server-access";
import { isDefaultTaskProjectId } from "@/features/tasks/lib/server";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  contextArg: { params: Promise<{ projectId: string }> }
) {
  try {
    const context = await requireUser(request);
    await assertTasksModuleEnabled(context.workspace_id);
    assertTaskPermission(context.permissions, context.isDefaultAdmin, null, "manage");
    const { projectId } = await contextArg.params;

    const ref = dbAdmin.collection("task_projects").doc(projectId);
    const existing = await ref.get();
    if (!existing.exists) {
      return NextResponse.json({ error: "Projeto não encontrado." }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "Nome do projeto é obrigatório." }, { status: 400 });
    }

    const patch = {
      name: body.name.trim(),
      description: typeof body.description === "string" ? body.description.trim() : "",
      members: Array.isArray(body.members) ? body.members : [],
      updated_at: new Date().toISOString(),
    };
    await ref.update(patch);

    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "tasks",
      action: "project_updated",
      metadata: { project_id: projectId, name: patch.name },
    });

    return NextResponse.json({ project: { id: projectId, ...(existing.data() ?? {}), ...patch } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar projeto." },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  contextArg: { params: Promise<{ projectId: string }> }
) {
  try {
    const context = await requireUser(request);
    await assertTasksModuleEnabled(context.workspace_id);
    assertTaskPermission(context.permissions, context.isDefaultAdmin, null, "manage");
    const { projectId } = await contextArg.params;

    if (isDefaultTaskProjectId(context.workspace_id, projectId)) {
      return NextResponse.json(
        { error: "O projeto padrão do motor de tarefas não pode ser removido." },
        { status: 409 }
      );
    }

    const ref = dbAdmin.collection("task_projects").doc(projectId);
    const existing = await ref.get();
    if (!existing.exists) {
      return NextResponse.json({ error: "Projeto não encontrado." }, { status: 404 });
    }

    const [tasksSnap, statusesSnap] = await Promise.all([
      dbAdmin.collection("tasks").where("project_id", "==", projectId).limit(1).get(),
      dbAdmin.collection("task_statuses").where("project_id", "==", projectId).get(),
    ]);

    if (!tasksSnap.empty) {
      return NextResponse.json(
        { error: "Não é possível excluir um projeto com tarefas vinculadas." },
        { status: 409 }
      );
    }

    const batch = dbAdmin.batch();
    batch.delete(ref);
    statusesSnap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "tasks",
      action: "project_deleted",
      metadata: { project_id: projectId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir projeto." },
      { status: 400 }
    );
  }
}
