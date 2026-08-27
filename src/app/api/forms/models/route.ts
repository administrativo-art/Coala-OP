import { NextRequest, NextResponse } from "next/server";

import { formModelSchema } from "@/features/forms/lib/schemas";
import { listFormModels } from "@/features/forms/lib/server";
import { canAccessFormsModule } from "@/features/forms/lib/server-access";
import { requireUser } from "@/lib/auth-server";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canAccessFormsModule(context.permissions, context.isDefaultAdmin)) {
      return NextResponse.json({ error: "Sem permissão para acessar formulários." }, { status: 403 });
    }

    const models = await listFormModels({
      workspaceId: context.workspace_id,
      isActive: true,
    });

    return NextResponse.json({ models });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao listar modelos." },
      { status: 403 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const canManage =
      context.isDefaultAdmin ||
      context.permissions.forms.global.manage_templates;

    if (!canManage) {
      return NextResponse.json({ error: "Sem permissão para criar modelos." }, { status: 403 });
    }

    const parsed = formModelSchema.parse(await request.json());
    const now = new Date();
    const ref = checklistDbAdmin.collection("form_models").doc();
    const model = {
      ...parsed,
      workspace_id: context.workspace_id,
      created_at: now,
      updated_at: now,
      created_by: {
        user_id: context.userDoc.id,
        username: context.userDoc.username,
      },
      updated_by: {
        user_id: context.userDoc.id,
        username: context.userDoc.username,
      },
    };

    await ref.set(model);
    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "forms",
      action: "model_created",
      metadata: {
        model_id: ref.id,
        name: parsed.name,
      },
    });

    return NextResponse.json({ model: { id: ref.id, ...model } }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar modelo." },
      { status: 400 }
    );
  }
}
