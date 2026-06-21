import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

import { mirrorExecutionToLegacy } from "@/features/forms/lib/legacy-bridge";
import {
  listFormExecutions,
  listFormExecutionsForAssignee,
  getFormTemplateById,
} from "@/features/forms/lib/server";
import {
  assertFormExecutionAccess,
  assertFormPermission,
  getUserFormUnitIds,
} from "@/features/forms/lib/server-access";
import { requireUser } from "@/lib/auth-server";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { logAction } from "@/lib/log-action";
import type { FormExecution, FormTemplate } from "@/types/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createExecutionSchema = z.object({
  template_id: z.string().min(1),
  unit_id: z.string().min(1),
  unit_name: z.string().optional(),
  assigned_user_id: z.string().min(1),
  assigned_username: z.string().optional(),
  collaborator_user_ids: z.array(z.string()).optional(),
  collaborator_usernames: z.array(z.string()).optional(),
  scheduled_for: z.string().optional(),
  schedule_id: z.string().optional(),
  shift_id: z.string().optional(),
  shift_definition_id: z.string().optional(),
  shift_definition_name: z.string().optional(),
  shift_start_time: z.string().optional(),
  shift_end_time: z.string().optional(),
  shift_end_date: z.string().optional(),
});

function buildExecutionSections(template: FormTemplate) {
  return template.sections.map((section, index) => ({
    id: section.id,
    template_section_id: section.id,
    title: section.title,
    order: typeof section.order === "number" ? section.order : index,
    show_if: section.show_if ?? undefined,
    require_photo: section.require_photo ?? false,
    require_signature: section.require_signature ?? false,
  }));
}

function buildExecutionItems(template: FormTemplate) {
  const items: Record<string, unknown>[] = [];

  function visitItems(templateItems: FormTemplate["sections"][number]["items"], section: FormTemplate["sections"][number], depth = 1): void {
    const sorted = [...templateItems].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const item of sorted) {
      items.push({
        id: `${section.id}-${item.id}`,
        template_item_id: item.id,
        template_section_id: section.id,
        section_id: section.id,
        section_title: section.title,
        order: item.order ?? 0,
        title: item.title,
        description: item.description ?? null,
        type: item.type,
        required: item.required,
        weight: item.weight ?? 1,
        block_next: item.block_next ?? false,
        criticality: item.criticality ?? "medium",
        reference_value: item.reference_value ?? null,
        tolerance_percent: item.tolerance_percent ?? null,
        action_required: item.action_required ?? false,
        notify_role_ids: item.notify_role_ids ?? [],
        escalation_minutes: item.escalation_minutes ?? null,
        show_if: item.show_if ?? null,
        section_show_if: section.show_if ?? null,
        config: item.config ?? null,
        checked: null,
        yes_no_value: null,
        text_value: null,
        number_value: null,
        multi_values: [],
        date_value: null,
        photo_urls: [],
        signature_url: null,
        is_out_of_range: false,
        completed_at: null,
        completed_by_user_id: null,
        linked_project_task_id: null,
        linked_project_task_status: null,
      });
      if (depth < 4 && item.conditional_branches?.length) {
        for (const branch of item.conditional_branches) {
          visitItems(branch.items, section, depth + 1);
        }
      }
    }
  }

  for (const section of template.sections) {
    visitItems(section.items, section);
  }
  return items;
}

function buildInitialSectionsSummary(template: FormTemplate) {
  const summary: Record<string, { total_items: number; completed_items: number; score: number }> = {};
  for (const section of template.sections) {
    summary[section.id] = { total_items: section.items.length, completed_items: 0, score: 0 };
  }
  return summary;
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const formProjectId = searchParams.get("formProjectId")?.trim() || null;
    const status = searchParams.get("status")?.trim() || null;
    const assignedToMe = searchParams.get("assignedToMe") === "true";
    const limit = Number(searchParams.get("limit") ?? "50");

    if (assignedToMe) {
      const executions = await listFormExecutionsForAssignee({
        workspaceId: context.workspace_id,
        userId: context.userDoc.id,
        unitIds: getUserFormUnitIds(context.userDoc as unknown as Record<string, unknown>),
        limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 100,
      });
      return NextResponse.json({ executions });
    }

    if (formProjectId) {
      assertFormPermission(
        context.permissions,
        context.isDefaultAdmin,
        formProjectId,
        "view"
      );
    }

    const executions = await listFormExecutions({
      workspaceId: context.workspace_id,
      formProjectId,
      status,
      assignedUserId: null,
      limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 50,
    });

    const visibleExecutions = executions.filter((execution) => {
      try {
        assertFormExecutionAccess({
          permissions: context.permissions,
          isDefaultAdmin: context.isDefaultAdmin,
          userId: context.userDoc.id,
          userDoc: context.userDoc as unknown as Record<string, unknown>,
          workspaceId: context.workspace_id,
          execution,
          level: "view",
        });
        return true;
      } catch {
        return false;
      }
    });

    return NextResponse.json({ executions: visibleExecutions });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao listar execuções.",
      },
      { status: 403 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = createExecutionSchema.parse(await request.json());

    const template = await getFormTemplateById(body.template_id, user.workspace_id);
    if (!template) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    assertFormPermission(user.permissions, user.isDefaultAdmin, template.form_project_id, "operate");

    const now = new Date();
    const ref = checklistDbAdmin.collection("form_executions").doc();
    const sections = buildExecutionSections(template);
    const items = buildExecutionItems(template);
    const sections_summary = buildInitialSectionsSummary(template);

    const execution: Omit<FormExecution, "id"> = {
      workspace_id: user.workspace_id,
      form_project_id: template.form_project_id,
      form_type_id: template.form_type_id,
      form_subtype_id: template.form_subtype_id,
      context: template.context,
      template_id: body.template_id,
      assignment_id: template.active_assignment_id ?? null,
      form_version_id: template.current_version_id ?? null,
      template_name: template.name,
      template_version: template.version,
      template_snapshot: template,
      occurrence_type: template.occurrence_type,
      unit_id: body.unit_id,
      unit_name: body.unit_name,
      assigned_user_id: body.assigned_user_id,
      assigned_username: body.assigned_username ?? body.assigned_user_id,
      collaborator_user_ids: body.collaborator_user_ids ?? [],
      collaborator_usernames: body.collaborator_usernames ?? [],
      created_by_user_id: user.userDoc.id,
      created_by_username: user.userDoc.username,
      scheduled_for: body.scheduled_for,
      schedule_id: body.schedule_id,
      shift_id: body.shift_id,
      shift_definition_id: body.shift_definition_id,
      shift_definition_name: body.shift_definition_name,
      shift_start_time: body.shift_start_time,
      shift_end_time: body.shift_end_time,
      shift_end_date: body.shift_end_date,
      sections,
      items: items as FormExecution["items"],
      sections_summary,
      status: "pending",
      claimed_by_user_id: null,
      claimed_by_username: null,
      claimed_at: null,
      completed_by_user_id: null,
      completed_by_username: null,
      completed_at: null,
      canceled_by_user_id: null,
      canceled_at: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    await ref.set(execution);

    await mirrorExecutionToLegacy({
      executionId: ref.id,
      execution: { id: ref.id, ...execution } as FormExecution,
    }).catch((error) => {
      console.error("Legacy dual-write failed for form execution create:", error);
    });

    await logAction({
      workspace_id: user.workspace_id,
      user_id: user.userDoc.id,
      username: user.userDoc.username,
      module: "forms",
      action: "execution_created",
      metadata: {
        execution_id: ref.id,
        template_id: body.template_id,
        unit_id: body.unit_id,
      },
    });

    return NextResponse.json({ execution: { id: ref.id, ...execution } }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Dados inválidos." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar execução." },
      { status: 400 }
    );
  }
}
