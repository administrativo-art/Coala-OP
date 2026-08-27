import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { assertTaskPermission, assertTasksModuleEnabled } from "@/features/tasks/lib/server-access";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ subprojectId: string }>;
};

export async function PATCH(request: NextRequest, contextArg: RouteContext) {
  try {
    const context = await requireUser(request);
    await assertTasksModuleEnabled(context.workspace_id);
    assertTaskPermission(context.permissions, context.isDefaultAdmin, null, "manage");

    const { subprojectId } = await contextArg.params;
    const ref = dbAdmin.collection("task_subprojects").doc(subprojectId);
    const existing = await ref.get();
    if (!existing.exists) {
      return NextResponse.json({ error: "Subprojeto não encontrado." }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "Nome do subprojeto é obrigatório." }, { status: 400 });
    }

    const patch = {
      name: body.name.trim(),
      description: typeof body.description === "string" ? body.description.trim() : "",
      order: typeof body.order === "number" ? body.order : 0,
      updated_at: new Date().toISOString(),
    };
    await ref.update(patch);

    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "tasks",
      action: "subproject_updated",
      metadata: { subproject_id: subprojectId, name: patch.name },
    });

    return NextResponse.json({ subproject: { id: subprojectId, ...(existing.data() ?? {}), ...patch } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar subprojeto." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest, contextArg: RouteContext) {
  try {
    const context = await requireUser(request);
    await assertTasksModuleEnabled(context.workspace_id);
    assertTaskPermission(context.permissions, context.isDefaultAdmin, null, "manage");

    const { subprojectId } = await contextArg.params;
    const ref = dbAdmin.collection("task_subprojects").doc(subprojectId);
    const existing = await ref.get();
    if (!existing.exists) {
      return NextResponse.json({ error: "Subprojeto não encontrado." }, { status: 404 });
    }

    const tasksSnap = await dbAdmin
      .collection("tasks")
      .where("subproject_id", "==", subprojectId)
      .limit(1)
      .get();

    if (!tasksSnap.empty) {
      return NextResponse.json(
        { error: "Não é possível excluir um subprojeto com tarefas vinculadas." },
        { status: 409 }
      );
    }

    const statusesSnap = await dbAdmin
      .collection("task_statuses")
      .where("subproject_id", "==", subprojectId)
      .get();

    const batch = dbAdmin.batch();
    batch.delete(ref);
    statusesSnap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "tasks",
      action: "subproject_deleted",
      metadata: { subproject_id: subprojectId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir subprojeto." },
      { status: 400 }
    );
  }
}
