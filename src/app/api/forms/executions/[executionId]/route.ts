import { NextRequest, NextResponse } from "next/server";

import { mirrorExecutionToLegacy } from "@/features/forms/lib/legacy-bridge";
import { buildFormExecutionPayload } from "@/features/forms/lib/service";
import { formExecutionUpdateSchema } from "@/features/forms/lib/schemas";
import { ensureTaskFromOrigin } from "@/features/tasks/lib/server";
import { requireUser } from "@/lib/auth-server";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { logAction } from "@/lib/log-action";
import {
  type FormConditionalRule,
  type FormExecution,
  type FormExecutionItem,
  type FormExecutionSection,
  type FormTaskTrigger,
  type FormTemplate,
  type FormTemplateItem,
} from "@/types/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ executionId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { executionId } = await context.params;
    const payload = await buildFormExecutionPayload({
      executionId,
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
            : "Falha ao carregar execução.",
      },
      { status: 403 }
    );
  }
}

function isItemCompleted(item: Record<string, unknown>) {
  const type = item.type;
  if (type === "checkbox") return typeof item.checked === "boolean";
  if (type === "yes_no") return typeof item.yes_no_value === "boolean";
  if (type === "text" || type === "select") {
    return typeof item.text_value === "string" && item.text_value.trim().length > 0;
  }
  if (type === "number" || type === "temperature") {
    return typeof item.number_value === "number";
  }
  if (type === "photo") return Array.isArray(item.photo_urls) && item.photo_urls.length > 0;
  if (type === "signature") {
    return typeof item.signature_url === "string" && item.signature_url.length > 0;
  }
  if (type === "multi_select") {
    return Array.isArray(item.multi_values) && item.multi_values.length > 0;
  }
  if (type === "date") return typeof item.date_value === "string" && item.date_value.length > 0;
  if (type === "file_upload") return Array.isArray(item.file_urls) && item.file_urls.length > 0;
  if (type === "location") return !!item.location;
  return false;
}

function isOutOfRange(item: Record<string, unknown>) {
  const numberValue = item.number_value;
  if (typeof numberValue !== "number") return false;
  const reference = item.reference_value;
  const tolerance = item.tolerance_percent;
  if (typeof reference !== "number" || typeof tolerance !== "number") return false;
  const delta = Math.abs(numberValue - reference);
  const maxDelta = Math.abs(reference) * (tolerance / 100);
  return delta > maxDelta;
}

function applyExecutionItemUpdate(
  item: Record<string, unknown>,
  update: Record<string, unknown>,
  nowIso: string,
  userId: string
) {
  const next = { ...item };

  if ("checked" in update) next.checked = update.checked ?? null;
  if ("yes_no_value" in update) next.yes_no_value = update.yes_no_value ?? null;
  if ("text_value" in update) next.text_value = update.text_value ?? "";
  if ("number_value" in update) next.number_value = update.number_value;
  if ("multi_values" in update) next.multi_values = update.multi_values ?? [];
  if ("date_value" in update) next.date_value = update.date_value ?? "";
  if ("photo_urls" in update) next.photo_urls = update.photo_urls ?? [];
  if ("file_urls" in update) next.file_urls = update.file_urls ?? [];
  if ("signature_url" in update) next.signature_url = update.signature_url ?? "";
  if ("location" in update) next.location = update.location ?? null;

  next.is_out_of_range = isOutOfRange(next);

  const completed = isItemCompleted(next);
  if (completed) {
    next.completed_at = nowIso;
    next.completed_by_user_id = userId;
  } else {
    next.completed_at = null;
    next.completed_by_user_id = null;
  }

  return next;
}

function buildSectionsSummary(items: Record<string, unknown>[]) {
  const summary: Record<string, { total_items: number; completed_items: number; score?: number }> = {};
  items.forEach((item) => {
    const sectionId = typeof item.section_id === "string" ? item.section_id : "unknown";
    summary[sectionId] ??= { total_items: 0, completed_items: 0, score: 0 };
    summary[sectionId].total_items += 1;
    if (isItemCompleted(item)) summary[sectionId].completed_items += 1;
  });
  return summary;
}

function buildExecutionScore(items: Record<string, unknown>[]) {
  const weighted = items.reduce<{ total: number; done: number }>(
    (acc, item) => {
      const weight = typeof item.weight === "number" ? item.weight : 1;
      acc.total += weight;
      if (isItemCompleted(item) && !item.is_out_of_range) {
        acc.done += weight;
      }
      return acc;
    },
    { total: 0, done: 0 }
  );

  if (weighted.total === 0) return 0;
  return Math.round((weighted.done / weighted.total) * 100);
}

function buildItemsByTemplateId(items: Record<string, unknown>[]) {
  return new Map(items.map((item) => [String(item.template_item_id), item]));
}

function normalizeComparableValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  return value;
}

function getExecutionItemAnswer(item: Record<string, unknown>) {
  if (typeof item.checked === "boolean") return item.checked;
  if (typeof item.yes_no_value === "boolean") return item.yes_no_value;
  if (typeof item.text_value === "string" && item.text_value.trim()) return item.text_value.trim();
  if (typeof item.number_value === "number") return item.number_value;
  if (Array.isArray(item.multi_values) && item.multi_values.length > 0) return item.multi_values;
  if (typeof item.date_value === "string" && item.date_value.trim()) return item.date_value.trim();
  return null;
}

function evaluateCondition(
  rule: FormConditionalRule | undefined,
  itemsByTemplateId: Map<string, Record<string, unknown>>
): boolean {
  if (!rule) return true;
  const item = itemsByTemplateId.get(rule.item_id);
  if (!item) return false;
  const answer = getExecutionItemAnswer(item);
  const expected = normalizeComparableValue(rule.value);

  switch (rule.operator) {
    case "equals":
      return normalizeComparableValue(answer) === expected;
    case "not_equals":
      return normalizeComparableValue(answer) !== expected;
    case "gt":
      return typeof answer === "number" && typeof expected === "number" && answer > expected;
    case "lt":
      return typeof answer === "number" && typeof expected === "number" && answer < expected;
    case "gte":
      return typeof answer === "number" && typeof expected === "number" && answer >= expected;
    case "lte":
      return typeof answer === "number" && typeof expected === "number" && answer <= expected;
    case "contains":
      if (Array.isArray(answer)) return answer.includes(expected as never);
      if (typeof answer === "string" && typeof expected === "string") {
        return answer.includes(expected);
      }
      return false;
    case "is_empty":
      return (
        answer === null ||
        answer === undefined ||
        answer === "" ||
        (Array.isArray(answer) && answer.length === 0)
      );
    case "is_not_empty":
      return !evaluateCondition({ ...rule, operator: "is_empty" }, itemsByTemplateId);
    default:
      return false;
  }
}

function shouldCreateTaskForItem(item: Record<string, unknown>) {
  if (item.action_required !== true) return false;

  if (item.type === "number" || item.type === "temperature") {
    return item.is_out_of_range === true;
  }

  if (item.type === "checkbox") {
    return item.checked === false;
  }

  if (item.type === "yes_no") {
    return item.yes_no_value === false;
  }

  return false;
}

function flattenTemplateItems(template: FormTemplate | undefined) {
  const items: FormTemplateItem[] = [];
  if (!template?.sections) return items;

  const visitItems = (templateItems: FormTemplateItem[]) => {
    templateItems.forEach((item) => {
      items.push(item);
      item.conditional_branches?.forEach((branch) => visitItems(branch.items));
    });
  };

  template.sections.forEach((section) => visitItems(section.items));
  return items;
}

function isSectionVisible(
  section: Record<string, unknown>,
  itemsByTemplateId: Map<string, Record<string, unknown>>
) {
  const rule = section.show_if ?? section.section_show_if;
  return evaluateCondition(rule as FormConditionalRule | undefined, itemsByTemplateId);
}

function isExecutionItemVisible(
  item: Record<string, unknown>,
  visibleSections: Set<string>,
  itemsByTemplateId: Map<string, Record<string, unknown>>
) {
  const sectionId = String(item.section_id ?? "");
  if (!visibleSections.has(sectionId)) return false;
  return evaluateCondition(item.show_if as FormConditionalRule | undefined, itemsByTemplateId);
}

function validateExecutionCompletion(params: {
  items: Record<string, unknown>[];
  sections: FormExecutionSection[];
}) {
  const itemsByTemplateId = buildItemsByTemplateId(params.items);
  const visibleSections = new Set(
    params.sections
      .filter((section) => isSectionVisible(section as unknown as Record<string, unknown>, itemsByTemplateId))
      .map((section) => section.id)
  );

  const visibleItems = params.items.filter((item) =>
    isExecutionItemVisible(item, visibleSections, itemsByTemplateId)
  );

  const missingRequired = visibleItems.some(
    (item) => item.required === true && !isItemCompleted(item)
  );

  const sectionMap = new Map(params.sections.map((section) => [section.id, section]));
  const sectionEvidenceMissing = Array.from(visibleSections).some((sectionId) => {
    const section = sectionMap.get(sectionId);
    if (!section) return false;
    const requiresPhoto = section.require_photo === true;
    const requiresSignature = section.require_signature === true;
    const missingPhoto = requiresPhoto && !(typeof section.photo_url === "string" && section.photo_url.trim());
    const missingSignature =
      requiresSignature &&
      !(typeof section.signature_url === "string" && section.signature_url.trim());
    return missingPhoto || missingSignature;
  });

  const itemsBySection = new Map<string, Record<string, unknown>[]>();
  visibleItems.forEach((item) => {
    const sectionId = String(item.section_id ?? "");
    const sectionItems = itemsBySection.get(sectionId) ?? [];
    sectionItems.push(item);
    itemsBySection.set(sectionId, sectionItems);
  });

  const blocked = Array.from(itemsBySection.values()).some((sectionItems) => {
    const orderedItems = [...sectionItems].sort(
      (left, right) => Number(left.order ?? 0) - Number(right.order ?? 0)
    );
    let foundIncompleteBlock = false;
    for (const item of orderedItems) {
      if (foundIncompleteBlock && isItemCompleted(item)) {
        return true;
      }
      if (item.block_next === true && !isItemCompleted(item)) {
        foundIncompleteBlock = true;
      }
    }
    return false;
  });

  if (missingRequired || blocked || sectionEvidenceMissing) {
    throw new Error(
      sectionEvidenceMissing
        ? "Existem seções visíveis sem foto ou assinatura obrigatória."
        : "Existem itens obrigatórios pendentes na execução."
    );
  }

  return { visibleItems, visibleSections };
}

function renderTemplateString(
  value: string,
  params: {
    executionId: string;
    execution: Record<string, unknown>;
    item: Record<string, unknown>;
    templateItem: FormTemplateItem;
  }
) {
  const replacements: Record<string, string> = {
    execution_id: params.executionId,
    item_title: params.templateItem.title,
    section_title:
      typeof params.item.section_title === "string" ? params.item.section_title : "",
    unit_name:
      typeof params.execution.unit_name === "string"
        ? params.execution.unit_name
        : typeof params.execution.unitName === "string"
          ? params.execution.unitName
          : "",
    template_name:
      typeof params.execution.template_name === "string"
        ? params.execution.template_name
        : typeof params.execution.templateName === "string"
          ? params.execution.templateName
          : "",
    answer: String(getExecutionItemAnswer(params.item) ?? ""),
  };

  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    return replacements[key] ?? "";
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ executionId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { executionId } = await context.params;
    const parsed = formExecutionUpdateSchema.parse(await request.json());
    const ref = checklistDbAdmin.collection("form_executions").doc(executionId);
    const now = new Date();
    const nowIso = now.toISOString();

    const result = (await checklistDbAdmin.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new Error("Execução não encontrada.");
      }

      const data = (snap.data() ?? {}) as Record<string, unknown>;
      const currentItems = Array.isArray(data.items)
        ? (data.items as Record<string, unknown>[])
        : [];

      if (currentItems.length === 0) {
        throw new Error("Execução sem itens para atualização.");
      }

      if (
        parsed.action !== "reopen" &&
        parsed.action !== "cancel" &&
        typeof data.claimed_by_user_id === "string" &&
        data.claimed_by_user_id !== user.userDoc.id
      ) {
        throw new Error("Essa execução está sob responsabilidade de outro colaborador.");
      }

      const updateMap = new Map(
        parsed.items.map((item) => [
          `${item.template_item_id}::${item.section_id}`,
          item as Record<string, unknown>,
        ])
      );

      const nextItems = currentItems.map((item) => {
        const key = `${String(item.template_item_id)}::${String(item.section_id)}`;
        const update = updateMap.get(key);
        if (!update) return item;
        return applyExecutionItemUpdate(item, update, nowIso, user.userDoc.id);
      });

      const sections = Array.isArray(data.sections)
        ? (data.sections as FormExecutionSection[])
        : [];

      const visibleContext =
        parsed.action === "complete"
          ? validateExecutionCompletion({ items: nextItems, sections })
          : {
              visibleItems: nextItems,
              visibleSections: new Set(
                sections.map((section) => section.id)
              ),
            };

      const nextStatus =
        parsed.action === "complete"
          ? "completed"
          : parsed.action === "reopen"
            ? "in_progress"
            : parsed.action === "cancel"
              ? "canceled"
              : (typeof data.status === "string" && data.status) || "in_progress";

      const next = {
        ...data,
        items: nextItems,
        status: nextStatus,
        sections_summary: buildSectionsSummary(visibleContext.visibleItems),
        score: buildExecutionScore(visibleContext.visibleItems),
        updated_at: now,
        completed_by_user_id:
          parsed.action === "complete" ? user.userDoc.id : data.completed_by_user_id ?? null,
        completed_by_username:
          parsed.action === "complete"
            ? user.userDoc.username
            : data.completed_by_username ?? null,
        completed_at: parsed.action === "complete" ? nowIso : data.completed_at ?? null,
        canceled_by_user_id:
          parsed.action === "cancel" ? user.userDoc.id : data.canceled_by_user_id ?? null,
        canceled_at: parsed.action === "cancel" ? nowIso : data.canceled_at ?? null,
      };

      tx.set(ref, next, { merge: true });
      tx.set(ref.collection("events").doc(), {
        type:
          parsed.action === "save"
            ? "item_updated"
            : parsed.action === "complete"
              ? "completed"
              : parsed.action === "reopen"
                ? "reopened"
                : "canceled",
        user_id: user.userDoc.id,
        username: user.userDoc.username,
        timestamp: now,
        metadata: {
          item_count: parsed.items.length,
        },
      });

      return next;
    })) as Record<string, unknown>;

    let createdTaskIds: string[] = [];
    if (parsed.action === "complete") {
      const templateSnapshot = result.template_snapshot as FormTemplate | undefined;
      const templateItems = flattenTemplateItems(templateSnapshot);
      const templateItemsById = new Map(templateItems.map((item) => [item.id, item]));
      const items = Array.isArray(result.items) ? (result.items as Record<string, unknown>[]) : [];
      const itemsByTemplateId = new Map(
        items.map((item) => [String(item.template_item_id), item])
      );
      const taskEvents: Array<Record<string, unknown>> = [];

      const nextItems = [...items];
      for (let index = 0; index < nextItems.length; index += 1) {
        const item = nextItems[index];
        const templateItem = templateItemsById.get(String(item.template_item_id));
        if (!templateItem || !shouldCreateTaskForItem(item)) continue;

        const triggers = Array.isArray(templateItem.task_triggers)
          ? (templateItem.task_triggers as FormTaskTrigger[])
          : [];

        for (const trigger of triggers) {
          if (!evaluateCondition(trigger.condition, itemsByTemplateId)) continue;

          const dueDate =
            typeof trigger.sla_hours === "number"
              ? new Date(now.getTime() + trigger.sla_hours * 3600000).toISOString()
              : undefined;

          const ensured = await ensureTaskFromOrigin({
            workspaceId: user.workspace_id,
            actor: {
              user_id: user.userDoc.id,
              username: user.userDoc.username,
            },
            trigger,
            origin: {
              kind: "form_trigger",
              execution_id: executionId,
              template_item_id: String(item.template_item_id),
              template_section_id: String(item.template_section_id ?? item.section_id),
            },
            title: renderTemplateString(trigger.title_template, {
              executionId,
              execution: result,
              item,
              templateItem,
            }),
            description: trigger.description_template
              ? renderTemplateString(trigger.description_template, {
                  executionId,
                  execution: result,
                  item,
                  templateItem,
                })
              : undefined,
            dueDate,
          });

          createdTaskIds.push(ensured.task.id);
          taskEvents.push({
            type: "task_created",
            user_id: user.userDoc.id,
            username: user.userDoc.username,
            timestamp: now,
            metadata: {
              execution_id: executionId,
              task_id: ensured.task.id,
              template_item_id: item.template_item_id,
              template_section_id: item.template_section_id ?? item.section_id,
              trigger_id: trigger.id,
              created: ensured.created,
            },
          });

          nextItems[index] = {
            ...nextItems[index],
            linked_project_task_id: ensured.task.id,
            linked_project_task_status: ensured.task.status,
          };
        }
      }

      if (taskEvents.length > 0) {
        const batch = checklistDbAdmin.batch();
        batch.set(ref, { items: nextItems }, { merge: true });
        taskEvents.forEach((event) => {
          batch.set(ref.collection("events").doc(), event);
        });
        await batch.commit();
        result.items = nextItems as FormExecutionItem[];
      }
    }

    await mirrorExecutionToLegacy({
      executionId,
      execution: result as unknown as FormExecution,
    }).catch((error) => {
      console.error("Legacy dual-write failed for form execution update:", error);
    });

    await logAction({
      workspace_id: user.workspace_id,
      user_id: user.userDoc.id,
      username: user.userDoc.username,
      module: "forms",
      action: `execution_${parsed.action}`,
      metadata: {
        execution_id: executionId,
        item_count: parsed.items.length,
        created_task_ids: createdTaskIds,
      },
    });

    return NextResponse.json({
      execution: {
        id: executionId,
        ...result,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar execução." },
      { status: 400 }
    );
  }
}
