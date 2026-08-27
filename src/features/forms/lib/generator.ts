import { createHash } from "crypto";

import { FORM_UNIT_POOL_ASSIGNEE_ID } from "@/features/forms/lib/server-access";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import type {
  FormAssignment,
  FormExecution,
  FormTemplate,
  FormTemplateItem,
} from "@/types/forms";

function executionIdFor(parts: string[]) {
  return createHash("sha256").update(parts.join("::")).digest("hex");
}

function ymd(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function parseYmd(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dayOfWeek(value: string) {
  return parseYmd(value).getUTCDay();
}

function dayOfMonth(value: string) {
  return parseYmd(value).getUTCDate();
}

function addDays(value: string, days: number) {
  const date = parseYmd(value);
  date.setUTCDate(date.getUTCDate() + days);
  return ymd(date);
}

function minutesToIso(dateYmd: string, hhmm?: string, fallback = "23:59") {
  const [hoursRaw, minutesRaw] = (hhmm || fallback).split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  const date = parseYmd(dateYmd);
  date.setUTCHours(Number.isFinite(hours) ? hours : 23, Number.isFinite(minutes) ? minutes : 59, 0, 0);
  return date.toISOString();
}

function dueAtFor(params: {
  scheduledFor: string;
  dueRule?: FormAssignment["due_rule"] | FormTemplate["due_rule"];
  shiftStartTime?: string;
  createdAt: Date;
}) {
  const rule = params.dueRule;
  if (!rule || rule.type === "none") return null;
  if (rule.type === "fixed_time") return minutesToIso(params.scheduledFor, rule.time, "23:59");
  if (rule.type === "after_shift_start") {
    const base = new Date(minutesToIso(params.scheduledFor, params.shiftStartTime, "00:00"));
    base.setUTCMinutes(base.getUTCMinutes() + (rule.minutes ?? 0));
    return base.toISOString();
  }
  const base = new Date(params.createdAt);
  base.setUTCMinutes(base.getUTCMinutes() + (rule.minutes ?? 0));
  return base.toISOString();
}

function shouldGenerateOnDate(assignment: FormAssignment, template: FormTemplate, dateYmd: string) {
  const occurrence = assignment.occurrence_type ?? template.occurrence_type ?? "manual";
  if (occurrence === "manual") return false;
  if (occurrence === "daily") return true;
  if (occurrence === "weekly") return dayOfWeek(dateYmd) === 1;
  if (occurrence === "biweekly") {
    const startsAt = (assignment.starts_at || template.created_at || dateYmd).toString().slice(0, 10);
    const diffDays = Math.floor((parseYmd(dateYmd).getTime() - parseYmd(startsAt).getTime()) / 86_400_000);
    return diffDays >= 0 && diffDays % 14 === 0;
  }
  if (occurrence === "monthly") return dayOfMonth(dateYmd) === 1;
  if (occurrence === "annual") {
    const schedule = template.annual_schedule;
    if (!schedule) return false;
    const date = parseYmd(dateYmd);
    return date.getUTCMonth() + 1 === schedule.month && date.getUTCDate() === schedule.day;
  }
  if (occurrence === "custom") {
    const schedule = template.custom_schedule;
    if (!schedule) return false;
    const modes = new Set(schedule.modes ?? []);
    if (modes.has("weekdays") && schedule.weekdays?.includes(dayOfWeek(dateYmd))) return true;
    if (modes.has("monthdays") && schedule.monthdays?.includes(dayOfMonth(dateYmd))) return true;
    if (modes.has("once") && schedule.once_dates?.includes(dateYmd)) return true;
    if (modes.has("interval") && schedule.interval_days) {
      const startsAt = (assignment.starts_at || template.created_at || dateYmd).toString().slice(0, 10);
      const diffDays = Math.floor((parseYmd(dateYmd).getTime() - parseYmd(startsAt).getTime()) / 86_400_000);
      return diffDays >= 0 && diffDays % schedule.interval_days === 0;
    }
  }
  return false;
}

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

  function visitItems(templateItems: FormTemplateItem[], section: FormTemplate["sections"][number], depth = 1) {
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
        file_urls: [],
        signature_url: null,
        is_out_of_range: false,
        completed_at: null,
        completed_by_user_id: null,
        linked_project_task_id: null,
        linked_project_task_status: null,
      });
      if (depth < 4 && item.conditional_branches?.length) {
        item.conditional_branches.forEach((branch) => visitItems(branch.items, section, depth + 1));
      }
    }
  }

  template.sections.forEach((section) => visitItems(section.items, section));
  return items;
}

function buildSectionsSummary(template: FormTemplate) {
  return Object.fromEntries(
    template.sections.map((section) => [
      section.id,
      { total_items: section.items.length, completed_items: 0, score: 0 },
    ])
  );
}

export async function generateDueFormExecutions(params: {
  workspaceId: string;
  actor: { user_id: string; username: string };
  fromDate?: string;
  toDate?: string;
  dryRun?: boolean;
}) {
  const fromDate = params.fromDate ?? ymd();
  const toDate = params.toDate ?? fromDate;
  const dates: string[] = [];
  for (let cursor = fromDate; cursor <= toDate; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }

  const [assignmentsSnap, templatesSnap] = await Promise.all([
    checklistDbAdmin
      .collection("form_assignments")
      .where("workspace_id", "==", params.workspaceId)
      .where("status", "==", "active")
      .get(),
    checklistDbAdmin
      .collection("form_templates")
      .where("workspace_id", "==", params.workspaceId)
      .where("is_active", "==", true)
      .get(),
  ]);

  const templatesById = new Map(
    templatesSnap.docs.map((doc) => [doc.id, { id: doc.id, ...(doc.data() ?? {}) } as FormTemplate])
  );
  const assignments = assignmentsSnap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() ?? {}),
  })) as FormAssignment[];

  const created: FormExecution[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const now = new Date();
  let overdueUpdated = 0;

  if (!params.dryRun) {
    const pendingSnap = await checklistDbAdmin
      .collection("form_executions")
      .where("workspace_id", "==", params.workspaceId)
      .where("status", "in", ["pending", "in_progress"])
      .limit(300)
      .get();
    const overdueBatch = checklistDbAdmin.batch();
    pendingSnap.docs.forEach((doc) => {
      const dueAt = doc.data()?.due_at;
      if (typeof dueAt === "string" && new Date(dueAt).getTime() < now.getTime()) {
        overdueBatch.update(doc.ref, {
          status: "overdue",
          updated_at: now.toISOString(),
        });
        overdueUpdated += 1;
      }
    });
    if (overdueUpdated > 0) await overdueBatch.commit();
  }

  for (const assignment of assignments) {
    const template = templatesById.get(assignment.form_template_id);
    if (!template) {
      skipped.push({ id: assignment.id, reason: "template_not_found" });
      continue;
    }
    if (assignment.application_mode === "manual" || assignment.application_mode === "event") continue;

    const unitIds = assignment.unit_ids?.length ? assignment.unit_ids : template.unit_ids ?? [];
    const unitNames = assignment.unit_names?.length ? assignment.unit_names : template.unit_names ?? [];
    if (unitIds.length === 0) {
      skipped.push({ id: assignment.id, reason: "no_units" });
      continue;
    }

    const shiftIds = assignment.application_mode === "schedule"
      ? assignment.shift_definition_ids ?? []
      : [""];
    const normalizedShiftIds = shiftIds.length ? shiftIds : [""];

    for (const date of dates) {
      if (!shouldGenerateOnDate(assignment, template, date)) continue;

      for (const [unitIndex, unitId] of unitIds.entries()) {
        for (const shiftDefinitionId of normalizedShiftIds) {
          const executionId = executionIdFor([
            params.workspaceId,
            assignment.id,
            template.id,
            date,
            unitId,
            shiftDefinitionId || "unit",
          ]);
          const ref = checklistDbAdmin.collection("form_executions").doc(executionId);
          const existing = await ref.get();
          if (existing.exists) {
            skipped.push({ id: executionId, reason: "already_exists" });
            continue;
          }

          const shiftIndex = assignment.shift_definition_ids?.indexOf(shiftDefinitionId) ?? -1;
          const due_at = dueAtFor({
            scheduledFor: date,
            dueRule: assignment.due_rule ?? template.due_rule,
            createdAt: now,
          });
          const execution: Omit<FormExecution, "id"> = {
            workspace_id: params.workspaceId,
            form_project_id: template.form_project_id,
            form_type_id: template.form_type_id,
            form_subtype_id: template.form_subtype_id,
            context: template.context,
            template_id: template.id,
            assignment_id: assignment.id,
            form_version_id: template.current_version_id ?? null,
            template_name: template.name,
            template_version: template.version,
            template_snapshot: template,
            occurrence_type: assignment.occurrence_type ?? template.occurrence_type,
            unit_id: unitId,
            unit_name: unitNames[unitIndex] ?? unitId,
            shift_definition_id: shiftDefinitionId || undefined,
            shift_definition_name:
              shiftIndex >= 0 ? assignment.shift_definition_names?.[shiftIndex] : undefined,
            assigned_user_id: FORM_UNIT_POOL_ASSIGNEE_ID,
            assigned_username: "Usuários vinculados à unidade",
            collaborator_user_ids: [],
            collaborator_usernames: [],
            created_by_user_id: params.actor.user_id,
            created_by_username: params.actor.username,
            scheduled_for: date,
            due_at,
            sections: buildExecutionSections(template),
            items: buildExecutionItems(template) as FormExecution["items"],
            sections_summary: buildSectionsSummary(template),
            status: due_at && new Date(due_at).getTime() < now.getTime() ? "overdue" : "pending",
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

          if (!params.dryRun) {
            await ref.create(execution);
            await ref.collection("events").doc().set({
              type: "created",
              user_id: params.actor.user_id,
              username: params.actor.username,
              timestamp: now,
              metadata: {
                assignment_id: assignment.id,
                scheduled_for: date,
                unit_id: unitId,
                shift_definition_id: shiftDefinitionId || null,
                generated: true,
              },
            });
          }
          created.push({ id: executionId, ...execution });
        }
      }
    }
  }

  return { created, skipped, overdueUpdated };
}
