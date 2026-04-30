import { NextRequest, NextResponse } from "next/server";

import {
  getFormTypeById,
  serializeFormValue,
} from "@/features/forms/lib/server";
import { formTypeSchema } from "@/features/forms/lib/schemas";
import { assertFormPermission } from "@/features/forms/lib/server-access";
import { requireUser } from "@/lib/auth-server";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  contextArg: { params: Promise<{ typeId: string }> }
) {
  try {
    const context = await requireUser(request);
    const { typeId } = await contextArg.params;
    const type = await getFormTypeById(typeId);
    if (!type) {
      return NextResponse.json({ error: "Tipo não encontrado." }, { status: 404 });
    }

    assertFormPermission(
      context.permissions,
      context.isDefaultAdmin,
      type.form_project_id,
      "view"
    );

    return NextResponse.json(type);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar tipo." },
      { status: 403 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  contextArg: { params: Promise<{ typeId: string }> }
) {
  try {
    const context = await requireUser(request);
    const { typeId } = await contextArg.params;
    const existing = await checklistDbAdmin.collection("form_types").doc(typeId).get();
    if (!existing.exists) {
      return NextResponse.json({ error: "Tipo não encontrado." }, { status: 404 });
    }

    const parsed = formTypeSchema.parse(await request.json());
    assertFormPermission(
      context.permissions,
      context.isDefaultAdmin,
      parsed.form_project_id,
      "manage"
    );

    const patch = {
      ...parsed,
      updated_at: new Date(),
    };

    await checklistDbAdmin.collection("form_types").doc(typeId).update(patch);
    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "forms",
      action: "type_updated",
      metadata: {
        type_id: typeId,
        form_project_id: parsed.form_project_id,
        name: parsed.name,
      },
    });

    return NextResponse.json({
      type: {
        id: typeId,
        ...((serializeFormValue({ ...(existing.data() ?? {}), ...patch }) as Record<
          string,
          unknown
        >) ?? {}),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar tipo." },
      { status: 400 }
    );
  }
}
