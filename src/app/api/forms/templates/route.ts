import { NextRequest, NextResponse } from "next/server";

import { mirrorTemplateToLegacy } from "@/features/forms/lib/legacy-bridge";
import { listFormTemplates } from "@/features/forms/lib/server";
import { formTemplateSchema } from "@/features/forms/lib/schemas";
import { assertFormPermission } from "@/features/forms/lib/server-access";
import { requireUser } from "@/lib/auth-server";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { logAction } from "@/lib/log-action";
import { type FormTemplate } from "@/types/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const formProjectId = searchParams.get("formProjectId")?.trim() || null;
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

    const templates = await listFormTemplates({
      workspaceId: context.workspace_id,
      formProjectId,
      isActive,
    });

    return NextResponse.json({ templates });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao listar templates.",
      },
      { status: 403 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const parsed = formTemplateSchema.parse(await request.json());
    assertFormPermission(
      context.permissions,
      context.isDefaultAdmin,
      parsed.form_project_id,
      "manage"
    );

    const now = new Date();
    const ref = checklistDbAdmin.collection("form_templates").doc();
    const version = 1;
    const template = {
      ...parsed,
      workspace_id: context.workspace_id,
      version,
      version_history: [],
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

    await ref.set(template);
    await mirrorTemplateToLegacy({
      templateId: ref.id,
      template: template as unknown as FormTemplate,
    }).catch((error) => {
      console.error("Legacy dual-write failed for form template create:", error);
    });
    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "forms",
      action: "template_created",
      metadata: {
        template_id: ref.id,
        form_project_id: parsed.form_project_id,
        name: parsed.name,
      },
    });

    return NextResponse.json(
      {
        template: {
          id: ref.id,
          ...template,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar template." },
      { status: 400 }
    );
  }
}
