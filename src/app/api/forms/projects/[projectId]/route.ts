import { NextRequest, NextResponse } from "next/server";

import { serializeFormValue } from "@/features/forms/lib/server";
import { formProjectSchema } from "@/features/forms/lib/schemas";
import { assertFormPermission } from "@/features/forms/lib/server-access";
import { requireUser } from "@/lib/auth-server";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { projectId } = await context.params;
    assertFormPermission(user.permissions, user.isDefaultAdmin, projectId, "manage");

    const ref = checklistDbAdmin.collection("form_projects").doc(projectId);
    const existing = await ref.get();
    if (!existing.exists) {
      return NextResponse.json({ error: "Projeto não encontrado." }, { status: 404 });
    }
    if (existing.data()?.workspace_id !== user.workspace_id) {
      return NextResponse.json({ error: "Projeto não encontrado neste workspace." }, { status: 404 });
    }

    const parsed = formProjectSchema.parse(await request.json());
    const patch = {
      name: parsed.name,
      description: parsed.description ?? null,
      color: parsed.color ?? null,
      icon: parsed.icon ?? null,
      is_active: parsed.is_active,
      members: parsed.members,
      updated_at: new Date(),
    };

    await ref.update(patch);
    await logAction({
      workspace_id: user.workspace_id,
      user_id: user.userDoc.id,
      username: user.userDoc.username,
      module: "forms",
      action: "project_updated",
      metadata: { project_id: projectId, name: parsed.name },
    });

    return NextResponse.json({
      project: {
        id: projectId,
        ...((serializeFormValue({ ...(existing.data() ?? {}), ...patch }) as Record<
          string,
          unknown
        >) ?? {}),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar projeto." },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { projectId } = await context.params;
    assertFormPermission(user.permissions, user.isDefaultAdmin, projectId, "manage");

    const ref = checklistDbAdmin.collection("form_projects").doc(projectId);
    const existing = await ref.get();
    if (!existing.exists) {
      return NextResponse.json({ error: "Projeto não encontrado." }, { status: 404 });
    }
    if (existing.data()?.workspace_id !== user.workspace_id) {
      return NextResponse.json({ error: "Projeto não encontrado neste workspace." }, { status: 404 });
    }

    await ref.update({
      is_active: false,
      updated_at: new Date(),
      deleted_at: new Date(),
      deleted_by: {
        user_id: user.userDoc.id,
        username: user.userDoc.username,
      },
    });

    await logAction({
      workspace_id: user.workspace_id,
      user_id: user.userDoc.id,
      username: user.userDoc.username,
      module: "forms",
      action: "project_deleted",
      metadata: { project_id: projectId, name: existing.data()?.name ?? projectId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao excluir projeto." },
      { status: 400 }
    );
  }
}
