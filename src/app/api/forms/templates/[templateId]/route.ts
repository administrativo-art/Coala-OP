import { NextRequest, NextResponse } from "next/server";

import { mirrorTemplateToLegacy } from "@/features/forms/lib/legacy-bridge";
import { buildFormTemplatePayload } from "@/features/forms/lib/service";
import { formTemplateSchema } from "@/features/forms/lib/schemas";
import { assertFormPermission } from "@/features/forms/lib/server-access";
import { requireUser } from "@/lib/auth-server";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { logAction } from "@/lib/log-action";
import { type FormTemplate } from "@/types/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { templateId } = await context.params;
    const payload = await buildFormTemplatePayload({
      templateId,
      permissions: user.permissions,
      isDefaultAdmin: user.isDefaultAdmin,
    });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao carregar template.",
      },
      { status: 403 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { templateId } = await context.params;
    const ref = checklistDbAdmin.collection("form_templates").doc(templateId);
    const existing = await ref.get();

    if (!existing.exists) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    const currentData = (existing.data() ?? {}) as Record<string, unknown>;
    const parsed = formTemplateSchema.parse(await request.json());
    assertFormPermission(
      user.permissions,
      user.isDefaultAdmin,
      parsed.form_project_id,
      "manage"
    );

    const currentVersion =
      typeof currentData.version === "number" ? currentData.version : 1;
    const history = Array.isArray(currentData.version_history)
      ? currentData.version_history
      : [];
    const patch = {
      ...parsed,
      version: currentVersion + 1,
      version_history: [
        ...history,
        {
          version: currentVersion,
          updated_by: user.userDoc.username,
          updated_at: new Date().toISOString(),
          change_notes: parsed.change_notes,
        },
      ],
      updated_at: new Date(),
      updated_by: {
        user_id: user.userDoc.id,
        username: user.userDoc.username,
      },
    };

    await ref.update(patch);
    await mirrorTemplateToLegacy({
      templateId,
      template: {
        ...(currentData as Record<string, unknown>),
        ...patch,
      } as unknown as FormTemplate,
    }).catch((error) => {
      console.error("Legacy dual-write failed for form template update:", error);
    });
    await logAction({
      workspace_id: user.workspace_id,
      user_id: user.userDoc.id,
      username: user.userDoc.username,
      module: "forms",
      action: "template_updated",
      metadata: {
        template_id: templateId,
        form_project_id: parsed.form_project_id,
        version: currentVersion + 1,
        name: parsed.name,
      },
    });

    return NextResponse.json({
      template: {
        id: templateId,
        ...currentData,
        ...patch,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar template." },
      { status: 400 }
    );
  }
}
