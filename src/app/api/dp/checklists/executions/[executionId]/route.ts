import { addMinutes } from "date-fns";
import { NextRequest, NextResponse } from "next/server";

import {
  calculateExecutionScore,
  isAfterShiftEnd,
  isChecklistExecutionItemCompleted,
  isChecklistExecutionItemSatisfied,
  isChecklistExecutionReadyToComplete,
  isItemOutOfRange,
  validateSectionAssetRequirements,
} from "@/features/dp-checklists/lib/core";
import { checklistExecutionUpdateSchema } from "@/features/dp-checklists/lib/schemas";
import {
  assertLegacyChecklistReadAllowed,
  assertLegacyChecklistWriteAllowed,
} from "@/features/dp-checklists/lib/rollout";
import { assertDPChecklistAccess } from "@/features/dp-checklists/lib/server-access";
import {
  appendChecklistAudit,
  checklistDbAdmin,
  loadChecklistActor,
  normalizeChecklistExecutionForApi,
} from "@/features/dp-checklists/lib/server";
import type { DPChecklistExecution, DPChecklistExecutionItem } from "@/types";
import { DEFAULT_LOGIN_ACCESS_TIMEZONE } from "@/features/hr/lib/login-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ executionId: string }> }
) {
  try {
    await assertLegacyChecklistReadAllowed();
    const access = await assertDPChecklistAccess(request, "operate");
    void access;
    const { executionId } = await context.params;

    if (!executionId) {
      return NextResponse.json({ error: "Checklist inválido." }, { status: 400 });
    }

    const executionSnap = await checklistDbAdmin
      .collection("checklistExecutions")
      .doc(executionId)
      .get();

    if (!executionSnap.exists) {
      return NextResponse.json({ error: "Checklist não encontrado." }, { status: 404 });
    }

    return NextResponse.json({
      execution: normalizeChecklistExecutionForApi(executionId, executionSnap.data() ?? {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao carregar o checklist.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

type ItemUpdate = {
  templateItemId: string;
  sectionId: string;
  value?: unknown;
  checked?: boolean;
  textValue?: string;
  numberValue?: number;
  photoUrls?: string[];
  signatureUrl?: string;
  multiValues?: string[];
  dateValue?: string;
  yesNoValue?: boolean | null;
};

function extractRawValue(item: DPChecklistExecutionItem, update: ItemUpdate) {
  if (update.value !== undefined) return update.value;

  switch (item.type) {
    case "checkbox":
      return update.checked;
    case "yes_no":
      return update.yesNoValue;
    case "text":
    case "select":
      return update.textValue;
    case "number":
    case "temperature":
      return update.numberValue;
    case "photo":
      return update.photoUrls;
    case "signature":
      return update.signatureUrl;
    case "multi_select":
      return update.multiValues;
    case "date":
      return update.dateValue;
    default:
      return undefined;
  }
}

function applyItemValue(
  item: DPChecklistExecutionItem,
  rawValue: unknown
): DPChecklistExecutionItem {
  const next: DPChecklistExecutionItem = {
    ...item,
  };

  switch (item.type) {
    case "checkbox":
      next.checked =
        typeof rawValue === "boolean" ? rawValue : rawValue === null ? null : item.checked;
      break;
    case "yes_no":
      next.yesNoValue =
        typeof rawValue === "boolean"
          ? rawValue
          : rawValue === null
            ? null
            : item.yesNoValue;
      break;
    case "text":
    case "select":
      next.textValue = typeof rawValue === "string" ? rawValue : item.textValue;
      break;
    case "number":
    case "temperature":
      next.numberValue =
        typeof rawValue === "number" && Number.isFinite(rawValue)
          ? rawValue
          : item.numberValue;
      break;
    case "photo":
      next.photoUrls = Array.isArray(rawValue)
        ? rawValue.filter((entry): entry is string => typeof entry === "string")
        : item.photoUrls;
      break;
    case "signature":
      next.signatureUrl =
        typeof rawValue === "string" ? rawValue : item.signatureUrl;
      break;
    case "multi_select":
      next.multiValues = Array.isArray(rawValue)
        ? rawValue.filter((entry): entry is string => typeof entry === "string")
        : item.multiValues;
      break;
    case "date":
      next.dateValue = typeof rawValue === "string" ? rawValue : item.dateValue;
      break;
    default:
      break;
  }

  if (
    (next.type === "number" || next.type === "temperature") &&
    typeof next.numberValue === "number"
  ) {
    next.isOutOfRange = isItemOutOfRange(next, next.numberValue);
  } else if (next.type !== "number" && next.type !== "temperature") {
    next.isOutOfRange = false;
  }

  return next;
}

function applyItemUpdate(
  item: DPChecklistExecutionItem,
  update: ItemUpdate,
  now: string,
  late: boolean,
  userId: string
): DPChecklistExecutionItem {
  const rawValue = extractRawValue(item, update);
  const wasCompleted = isChecklistExecutionItemCompleted(item);
  const next = applyItemValue(item, rawValue);
  const isNowCompleted = isChecklistExecutionItemCompleted(next);

  if (!wasCompleted && isNowCompleted) {
    next.completedAt = now;
    next.completedByUserId = userId;
    next.isLate = late;
  } else if (wasCompleted && !isNowCompleted) {
    next.completedAt = null;
    next.completedByUserId = null;
    next.isLate = false;
  } else if (wasCompleted && isNowCompleted) {
    next.isLate = next.isLate ?? late;
  }

  return next;
}

function shouldCreateTask(item: DPChecklistExecutionItem) {
  if (!item.actionRequired) return false;

  if (item.type === "number" || item.type === "temperature") {
    return item.isOutOfRange === true;
  }

  if (item.type === "checkbox") {
    return item.checked === false;
  }

  if (item.type === "yes_no") {
    return item.yesNoValue === false;
  }

  return false;
}

async function createOrReuseOperationalTask(params: {
  execution: Pick<DPChecklistExecution, "id" | "unitId" | "unitName">;
  item: DPChecklistExecutionItem;
}) {
  const querySnap = await checklistDbAdmin
    .collection("operationalTasks")
    .where("executionId", "==", params.execution.id)
    .where("sectionId", "==", params.item.sectionId)
    .where("itemId", "==", params.item.templateItemId)
    .get();

  const existingOpenTask = querySnap.docs.find((doc) => {
    const status = doc.data()?.status;
    return status === "open" || status === "in_progress" || status === "escalated";
  });

  if (existingOpenTask) {
    return { id: existingOpenTask.id, created: false };
  }

  const now = new Date();
  const taskRef = checklistDbAdmin.collection("operationalTasks").doc();
  const slaMinutes = params.item.escalationMinutes ?? 30;
  await taskRef.set({
    executionId: params.execution.id,
    sectionId: params.item.sectionId,
    itemId: params.item.templateItemId,
    itemTitle: params.item.title,
    unitId: params.execution.unitId,
    unitName: params.execution.unitName ?? "Sem unidade",
    description:
      params.item.description ||
      `Ação operacional obrigatória para "${params.item.title}".`,
    status: "open",
    assignedToRoleIds: params.item.notifyRoleIds ?? [],
    assignedToUserId: null,
    assignedToUserName: null,
    slaMinutes,
    slaDeadlineAt: addMinutes(now, slaMinutes),
    escalatedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNotes: null,
    createdAt: now,
    updatedAt: now,
  });

  return { id: taskRef.id, created: true };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ executionId: string }> }
) {
  try {
    await assertLegacyChecklistWriteAllowed();
    const access = await assertDPChecklistAccess(request, "operate");
    const actor = await loadChecklistActor(access.decoded.uid);
    const { executionId } = await context.params;

    if (!executionId) {
      return NextResponse.json(
        { error: "Checklist inválido." },
        { status: 400 }
      );
    }

    const rawBody = await request.json();
    const parsed = checklistExecutionUpdateSchema.parse(rawBody);
    const updateMap = new Map(
      parsed.items.map((item) => [item.templateItemId, item])
    );

    const now = new Date();
    const nowIso = now.toISOString();

    const executionRef = checklistDbAdmin
      .collection("checklistExecutions")
      .doc(executionId);

    const transactionResult = await checklistDbAdmin.runTransaction<{
      executionData: Record<string, unknown>;
      taskCandidates: DPChecklistExecutionItem[];
    }>(async (transaction) => {
      const executionSnap = await transaction.get(executionRef);
      if (!executionSnap.exists) {
        throw new Error("Checklist não encontrado.");
      }

      const data = (executionSnap.data() ?? {}) as Record<string, unknown>;
      if (!Array.isArray(data.items) || !Array.isArray(data.sections)) {
        throw new Error("Checklist inválido para edição.");
      }

      if (data.status === "completed") {
        throw new Error("Esse checklist já foi concluído.");
      }

      const claimedByUserId =
        typeof data.claimedByUserId === "string" ? data.claimedByUserId : null;

      if (!claimedByUserId) {
        throw new Error("Assuma o checklist antes de registrar a execução.");
      }

      if (claimedByUserId !== actor.userId) {
        throw new Error(
          "Esse checklist está sob responsabilidade de outro colaborador."
        );
      }

      const shiftEndDate =
        typeof data.shiftEndDate === "string" ? data.shiftEndDate : "";
      const shiftEndTime =
        typeof data.shiftEndTime === "string" ? data.shiftEndTime : "";
      const late =
        shiftEndDate && shiftEndTime
          ? isAfterShiftEnd({
              now,
              shiftEndDate,
              shiftEndTime,
              timeZone: DEFAULT_LOGIN_ACCESS_TIMEZONE,
            })
          : false;

      const currentItems = data.items as DPChecklistExecutionItem[];
      const mergedItems = currentItems.map((item) => {
        const update = updateMap.get(item.templateItemId);
        if (!update) return item;
        return applyItemUpdate(item, update, nowIso, late, actor.userId);
      });

      const execution: Pick<DPChecklistExecution, "items" | "sections"> = {
        items: mergedItems,
        sections: data.sections as DPChecklistExecution["sections"],
      };

      if (parsed.action === "complete") {
        const ready = isChecklistExecutionReadyToComplete(execution);
        if (!ready) {
          const pendingTitles = mergedItems
            .filter((item) => !isChecklistExecutionItemSatisfied(item))
            .slice(0, 3)
            .map((item) => item.title);
          const sectionErrors = validateSectionAssetRequirements(execution);
          const messageParts = [];
          if (pendingTitles.length > 0) {
            messageParts.push(
              `Preencha os itens obrigatórios antes de concluir: ${pendingTitles.join(", ")}.`
            );
          }
          if (sectionErrors.length > 0) {
            messageParts.push(sectionErrors.join(" "));
          }

          throw new Error(messageParts.join(" ").trim());
        }
      }

      const finalItems =
        parsed.action === "complete"
          ? mergedItems.map((item) =>
              isChecklistExecutionItemCompleted(item)
                ? {
                    ...item,
                    completedAt: item.completedAt ?? nowIso,
                    completedByUserId: item.completedByUserId ?? actor.userId,
                    isLate: item.isLate ?? late,
                  }
                : item
            )
          : mergedItems;

      const score = calculateExecutionScore(finalItems);
      const taskCandidates = finalItems.filter((item) => {
        const updated = updateMap.has(item.templateItemId);
        return updated && shouldCreateTask(item);
      });

      const nextData: Record<string, unknown> = {
        ...data,
        items: finalItems,
        status: parsed.action === "complete" ? "completed" : "claimed",
        completedByUserId: parsed.action === "complete" ? actor.userId : null,
        completedByUsername: parsed.action === "complete" ? actor.username : null,
        completedAt: parsed.action === "complete" ? nowIso : null,
        score,
        updatedAt: now,
      };

      transaction.set(executionRef, nextData, { merge: true });
      return { executionData: nextData, taskCandidates };
    });

    const executionData = transactionResult.executionData;
    const createdTaskIds: string[] = [];
    const itemTaskMap = new Map<string, string>();

    for (const item of transactionResult.taskCandidates) {
      const task = await createOrReuseOperationalTask({
        execution: {
          id: executionId,
          unitId:
            typeof executionData.unitId === "string" ? executionData.unitId : "",
          unitName:
            typeof executionData.unitName === "string"
              ? executionData.unitName
              : "Sem unidade",
        },
        item,
      });

      createdTaskIds.push(task.id);
      itemTaskMap.set(item.templateItemId, task.id);
      if (task.created) {
        await appendChecklistAudit("operational_task_created", {
          actorUserId: actor.userId,
          actorUsername: actor.username,
          executionId,
          taskId: task.id,
          itemId: item.templateItemId,
          itemTitle: item.title,
        });
      }
    }

    if (itemTaskMap.size > 0) {
      const updatedItems = (executionData.items as DPChecklistExecutionItem[]).map(
        (item) => {
          const taskId = itemTaskMap.get(item.templateItemId);
          return taskId ? { ...item, linkedTaskId: taskId } : item;
        }
      );
      await checklistDbAdmin
        .collection("checklistExecutions")
        .doc(executionId)
        .update({ items: updatedItems });
      executionData.items = updatedItems;
    }

    await appendChecklistAudit(
      parsed.action === "complete" ? "execution_completed" : "execution_saved",
      {
        actorUserId: actor.userId,
        actorUsername: actor.username,
        executionId,
        templateId:
          typeof executionData.templateId === "string"
            ? executionData.templateId
            : null,
        templateName:
          typeof executionData.templateName === "string"
            ? executionData.templateName
            : null,
        checklistDate:
          typeof executionData.checklistDate === "string"
            ? executionData.checklistDate
            : null,
        shiftId:
          typeof executionData.shiftId === "string" ? executionData.shiftId : null,
        score:
          typeof executionData.score === "number" ? executionData.score : null,
        createdTaskIds,
      }
    );

    return NextResponse.json({
      execution: normalizeChecklistExecutionForApi(executionId, executionData),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro ao atualizar a execução do checklist.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
