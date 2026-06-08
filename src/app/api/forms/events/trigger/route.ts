import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

import { listFormTemplates } from "@/features/forms/lib/server";
import { assertFormPermission } from "@/features/forms/lib/server-access";
import { requireUser } from "@/lib/auth-server";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { logAction } from "@/lib/log-action";
import type { FormExecution, FormTemplate } from "@/types/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const triggerSchema = z.object({
  event_key: z.string().trim().min(1),
  unit_id: z.string().trim().min(1),
  unit_name: z.string().trim().optional(),
  assigned_user_id: z.string().trim().optional(),
  assigned_username: z.string().trim().optional(),
  metadata: z.record(z.unknown()).optional(),
});

function buildSections(template: FormTemplate) {
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

function buildItems(template: FormTemplate) {
  return template.sections.flatMap((section) =>
    section.items.map((item) => ({
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
      show_if: item.show_if ?? null,
      section_show_if: section.show_if ?? null,
      config: item.config ?? null,
      checked: null,
      yes_no_value: null,
      text_value: undefined,
      number_value: undefined,
      multi_values: [],
      date_value: undefined,
      photo_urls: [],
      signature_url: undefined,
      is_out_of_range: false,
      completed_at: null,
      completed_by_user_id: null,
      linked_project_task_id: undefined,
      linked_project_task_status: undefined,
    }))
  );
}

function buildSummary(template: FormTemplate) {
  return Object.fromEntries(
    template.sections.map((section) => [
      section.id,
      { total_items: section.items.length, completed_items: 0, score: 0 },
    ])
  );
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = triggerSchema.parse(await request.json());
    const templates = await listFormTemplates({
      workspaceId: user.workspace_id,
      isActive: true,
    });
    const eventTemplates = templates.filter(
      (template) =>
        template.application_mode === "event" &&
        (template.unit_ids?.length ? template.unit_ids.includes(body.unit_id) : true)
    );

    const created: FormExecution[] = [];
    const now = new Date().toISOString();

    for (const template of eventTemplates) {
      assertFormPermission(user.permissions, user.isDefaultAdmin, template.form_project_id, "operate");
      const ref = checklistDbAdmin.collection("form_executions").doc();
      const execution: Omit<FormExecution, "id"> = {
        workspace_id: user.workspace_id,
        form_project_id: template.form_project_id,
        form_type_id: template.form_type_id,
        form_subtype_id: template.form_subtype_id,
        context: template.context,
        template_id: template.id,
        assignment_id: template.active_assignment_id ?? null,
        form_version_id: template.current_version_id ?? null,
        template_name: template.name,
        template_version: template.version,
        template_snapshot: template,
        occurrence_type: template.occurrence_type,
        unit_id: body.unit_id,
        unit_name: body.unit_name,
        assigned_user_id: body.assigned_user_id ?? user.userDoc.id,
        assigned_username: body.assigned_username ?? user.userDoc.username,
        collaborator_user_ids: [],
        collaborator_usernames: [],
        created_by_user_id: user.userDoc.id,
        created_by_username: user.userDoc.username,
        scheduled_for: now.slice(0, 10),
        sections: buildSections(template),
        items: buildItems(template) as FormExecution["items"],
        sections_summary: buildSummary(template),
        status: "pending",
        claimed_by_user_id: null,
        claimed_by_username: null,
        claimed_at: null,
        completed_by_user_id: null,
        completed_by_username: null,
        completed_at: null,
        canceled_by_user_id: null,
        canceled_at: null,
        created_at: now,
        updated_at: now,
      };

      await ref.set({
        ...execution,
        origin_event_key: body.event_key,
        origin_event_metadata: body.metadata ?? {},
      });
      created.push({ id: ref.id, ...execution });
    }

    await logAction({
      workspace_id: user.workspace_id,
      user_id: user.userDoc.id,
      username: user.userDoc.username,
      module: "forms",
      action: "event_triggered",
      metadata: {
        event_key: body.event_key,
        unit_id: body.unit_id,
        created_count: created.length,
      },
    });

    return NextResponse.json({ executions: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao disparar evento." },
      { status: 400 }
    );
  }
}
