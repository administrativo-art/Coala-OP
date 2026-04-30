import { NextRequest, NextResponse } from "next/server";

import {
  getFormSubtypeById,
  serializeFormValue,
} from "@/features/forms/lib/server";
import { formSubtypeSchema } from "@/features/forms/lib/schemas";
import { assertFormPermission } from "@/features/forms/lib/server-access";
import { requireUser } from "@/lib/auth-server";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  contextArg: { params: Promise<{ subtypeId: string }> }
) {
  try {
    const context = await requireUser(request);
    const { subtypeId } = await contextArg.params;
    const subtype = await getFormSubtypeById(subtypeId);
    if (!subtype) {
      return NextResponse.json(
        { error: "Subtipo não encontrado." },
        { status: 404 }
      );
    }

    assertFormPermission(
      context.permissions,
      context.isDefaultAdmin,
      subtype.form_project_id,
      "view"
    );

    return NextResponse.json(subtype);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao carregar subtipo.",
      },
      { status: 403 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  contextArg: { params: Promise<{ subtypeId: string }> }
) {
  try {
    const context = await requireUser(request);
    const { subtypeId } = await contextArg.params;
    const existing = await checklistDbAdmin.collection("form_subtypes").doc(subtypeId).get();
    if (!existing.exists) {
      return NextResponse.json(
        { error: "Subtipo não encontrado." },
        { status: 404 }
      );
    }

    const parsed = formSubtypeSchema.parse(await request.json());
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

    await checklistDbAdmin.collection("form_subtypes").doc(subtypeId).update(patch);
    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "forms",
      action: "subtype_updated",
      metadata: {
        subtype_id: subtypeId,
        form_project_id: parsed.form_project_id,
        form_type_id: parsed.form_type_id,
        name: parsed.name,
      },
    });

    return NextResponse.json({
      subtype: {
        id: subtypeId,
        ...((serializeFormValue({ ...(existing.data() ?? {}), ...patch }) as Record<
          string,
          unknown
        >) ?? {}),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao atualizar subtipo.",
      },
      { status: 400 }
    );
  }
}
