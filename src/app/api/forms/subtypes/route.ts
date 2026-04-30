import { NextRequest, NextResponse } from "next/server";

import { listFormSubtypes, serializeFormValue } from "@/features/forms/lib/server";
import { formSubtypeSchema } from "@/features/forms/lib/schemas";
import { assertFormPermission } from "@/features/forms/lib/server-access";
import { requireUser } from "@/lib/auth-server";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const formProjectId = searchParams.get("formProjectId")?.trim() || null;
    const formTypeId = searchParams.get("formTypeId")?.trim() || null;
    const activeParam = searchParams.get("active");
    const isActive =
      activeParam === null ? undefined : activeParam.toLowerCase() === "true";

    if (formProjectId) {
      assertFormPermission(
        context.permissions,
        context.isDefaultAdmin,
        formProjectId,
        "view"
      );
    }

    const subtypes = await listFormSubtypes({
      workspaceId: context.workspace_id,
      formProjectId,
      formTypeId,
      isActive,
    });

    return NextResponse.json({ subtypes });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao listar subtipos.",
      },
      { status: 403 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const parsed = formSubtypeSchema.parse(await request.json());
    assertFormPermission(
      context.permissions,
      context.isDefaultAdmin,
      parsed.form_project_id,
      "manage"
    );

    const now = new Date();
    const ref = checklistDbAdmin.collection("form_subtypes").doc();
    const payload = {
      ...parsed,
      workspace_id: context.workspace_id,
      created_at: now,
      updated_at: now,
    };

    await ref.set(payload);
    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "forms",
      action: "subtype_created",
      metadata: {
        subtype_id: ref.id,
        form_project_id: parsed.form_project_id,
        form_type_id: parsed.form_type_id,
        name: parsed.name,
      },
    });

    return NextResponse.json(
      {
        subtype: {
          id: ref.id,
          ...((serializeFormValue(payload) as Record<string, unknown>) ?? {}),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao criar subtipo.",
      },
      { status: 400 }
    );
  }
}
