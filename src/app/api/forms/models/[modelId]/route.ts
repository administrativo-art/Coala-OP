import { NextRequest, NextResponse } from "next/server";

import { formModelSchema } from "@/features/forms/lib/schemas";
import { requireUser } from "@/lib/auth-server";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canManageModels(context: Awaited<ReturnType<typeof requireUser>>) {
  return (
    context.isDefaultAdmin ||
    context.permissions.forms.global.manage_templates ||
    context.permissions.dp.checklists.manageTemplates
  );
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ modelId: string }> }
) {
  try {
    const user = await requireUser(request);
    if (!canManageModels(user)) {
      return NextResponse.json({ error: "Sem permissão para editar modelos." }, { status: 403 });
    }

    const { modelId } = await context.params;
    const parsed = formModelSchema.parse(await request.json());
    const ref = checklistDbAdmin.collection("form_models").doc(modelId);
    const existing = await ref.get();
    if (!existing.exists) {
      return NextResponse.json({ error: "Modelo não encontrado." }, { status: 404 });
    }

    const patch = {
      ...parsed,
      updated_at: new Date(),
      updated_by: {
        user_id: user.userDoc.id,
        username: user.userDoc.username,
      },
    };

    await ref.update(patch);
    await logAction({
      workspace_id: user.workspace_id,
      user_id: user.userDoc.id,
      username: user.userDoc.username,
      module: "forms",
      action: "model_updated",
      metadata: {
        model_id: modelId,
        name: parsed.name,
      },
    });

    return NextResponse.json({
      model: {
        id: modelId,
        ...existing.data(),
        ...patch,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao editar modelo." },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ modelId: string }> }
) {
  try {
    const user = await requireUser(request);
    if (!canManageModels(user)) {
      return NextResponse.json({ error: "Sem permissão para arquivar modelos." }, { status: 403 });
    }

    const { modelId } = await context.params;
    const ref = checklistDbAdmin.collection("form_models").doc(modelId);
    const existing = await ref.get();
    if (!existing.exists) {
      return NextResponse.json({ error: "Modelo não encontrado." }, { status: 404 });
    }

    await ref.update({
      is_active: false,
      updated_at: new Date(),
      updated_by: {
        user_id: user.userDoc.id,
        username: user.userDoc.username,
      },
    });
    await logAction({
      workspace_id: user.workspace_id,
      user_id: user.userDoc.id,
      username: user.userDoc.username,
      module: "forms",
      action: "model_archived",
      metadata: { model_id: modelId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao arquivar modelo." },
      { status: 400 }
    );
  }
}
