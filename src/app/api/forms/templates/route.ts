import { NextRequest, NextResponse } from "next/server";

import { getFormProjectById, listFormTemplates } from "@/features/forms/lib/server";
import { formTemplateSchema } from "@/features/forms/lib/schemas";
import {
  assertFormAnalyticsPermission,
  assertFormPermission,
} from "@/features/forms/lib/server-access";
import {
  hasEnabledAnalyticsConfig,
  validateTemplateAnalyticsPublication,
} from "@/features/forms/analytics/template-publication";
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
    const project = await getFormProjectById(parsed.form_project_id, context.workspace_id);
    if (!project) {
      return NextResponse.json({ error: "Projeto não encontrado neste workspace." }, { status: 404 });
    }
    assertFormPermission(
      context.permissions,
      context.isDefaultAdmin,
      parsed.form_project_id,
      "manage"
    );
    if (hasEnabledAnalyticsConfig(parsed.sections)) {
      assertFormAnalyticsPermission(
        context.permissions,
        context.isDefaultAdmin,
        "configure_templates"
      );
      const analyticsReport = await validateTemplateAnalyticsPublication({
        db: checklistDbAdmin,
        workspaceId: context.workspace_id,
        sections: parsed.sections,
      });
      if (!analyticsReport.ok) {
        return NextResponse.json(
          {
            error: "Configuração analítica inválida.",
            validation: analyticsReport,
          },
          { status: 422 }
        );
      }
    }

    const now = new Date();
    const ref = checklistDbAdmin.collection("form_templates").doc();
    const versionRef = checklistDbAdmin.collection("form_versions").doc();
    const version = 1;
    const template = {
      ...parsed,
      workspace_id: context.workspace_id,
      version,
      current_version_id: versionRef.id,
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

    await checklistDbAdmin.runTransaction(async (transaction) => {
      transaction.set(ref, template);
      transaction.set(versionRef, {
        workspace_id: context.workspace_id,
        form_template_id: ref.id,
        form_project_id: parsed.form_project_id,
        version,
        name: parsed.name,
        description: parsed.description ?? "",
        sections: parsed.sections,
        created_at: now,
        created_by: {
          user_id: context.userDoc.id,
          username: context.userDoc.username,
        },
      });
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
