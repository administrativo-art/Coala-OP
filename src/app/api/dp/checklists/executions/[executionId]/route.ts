import { NextRequest, NextResponse } from "next/server";

import {
  calculateExecutionScore,
  isAfterShiftEnd,
  isChecklistExecutionItemCompleted,
  isChecklistExecutionItemSatisfied,
  isChecklistExecutionReadyToComplete,
} from "@/features/dp-checklists/lib/core";
import { checklistExecutionUpdateSchema } from "@/features/dp-checklists/lib/schemas";
import { assertDPChecklistAccess } from "@/features/dp-checklists/lib/server-access";
import {
  appendChecklistAudit,
  checklistDbAdmin,
  loadChecklistActor,
  normalizeChecklistExecutionForApi,
} from "@/features/dp-checklists/lib/server";
import type { DPChecklistExecutionItem } from "@/types";
import { DEFAULT_LOGIN_ACCESS_TIMEZONE } from "@/features/hr/lib/login-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ItemUpdate = {
  templateItemId: string;
  sectionId: string;
  checked?: boolean;
  textValue?: string;
  numberValue?: number;
  photoUrls?: string[];
  signatureUrl?: string;
};

function applyItemUpdate(
  item: DPChecklistExecutionItem,
  update: ItemUpdate,
  now: string,
  late: boolean,
  userId: string
): DPChecklistExecutionItem {
  const wasCompleted = isChecklistExecutionItemCompleted(item);

  const next: DPChecklistExecutionItem = {
    ...item,
    checked:
      item.type === "checkbox" && typeof update.checked === "boolean"
        ? update.checked
        : item.checked,
    textValue:
      (item.type === "text" || item.type === "select") &&
      typeof update.textValue === "string"
        ? update.textValue
        : item.textValue,
    numberValue:
      (item.type === "number" || item.type === "temperature") &&
      typeof update.numberValue === "number"
        ? update.numberValue
        : item.numberValue,
    photoUrls:
      item.type === "photo" && Array.isArray(update.photoUrls)
        ? update.photoUrls
        : item.photoUrls,
    signatureUrl:
      item.type === "signature" && typeof update.signatureUrl === "string"
        ? update.signatureUrl
        : item.signatureUrl,
  };

  const isNowCompleted = isChecklistExecutionItemCompleted(next);

  if (!wasCompleted && isNowCompleted) {
    next.completedAt = now;
    next.completedByUserId = userId;
    next.isLate = late;

    if (
      (item.type === "number" || item.type === "temperature") &&
      item.config &&
      typeof next.numberValue === "number"
    ) {
      const { min, max, alertOutOfRange } = item.config;
      if (alertOutOfRange) {
        next.isOutOfRange =
          (min !== undefined && next.numberValue < min) ||
          (max !== undefined && next.numberValue > max);
      }
    }
  }

  return next;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ executionId: string }> }
) {
  try {
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

    const executionData = await checklistDbAdmin.runTransaction<
      Record<string, unknown>
    >(async (transaction) => {
      const executionSnap = await transaction.get(executionRef);
      if (!executionSnap.exists) {
        throw new Error("Checklist não encontrado.");
      }

      const data = (executionSnap.data() ?? {}) as Record<string, unknown>;
      if (!Array.isArray(data.items)) {
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
      const late = isAfterShiftEnd({
        now,
        shiftEndDate,
        shiftEndTime,
        timeZone: DEFAULT_LOGIN_ACCESS_TIMEZONE,
      });

      const currentItems = data.items as DPChecklistExecutionItem[];
      const mergedItems = currentItems.map((item) => {
        const update = updateMap.get(item.templateItemId);
        if (!update) return item;
        return applyItemUpdate(item, update, nowIso, late, actor.userId);
      });

      if (parsed.action === "complete") {
        const ready = isChecklistExecutionReadyToComplete({ items: mergedItems });
        if (!ready) {
          const pendingTitles = mergedItems
            .filter((item) => !isChecklistExecutionItemSatisfied(item))
            .slice(0, 3)
            .map((item) => item.title);

          throw new Error(
            `Preencha os itens obrigatórios antes de concluir: ${pendingTitles.join(", ")}.`
          );
        }
      }

      const finalItems =
        parsed.action === "complete"
          ? mergedItems.map((item) => ({
              ...item,
              completedAt: item.completedAt ?? nowIso,
              completedByUserId: item.completedByUserId ?? actor.userId,
              isLate: item.isLate ?? late,
            }))
          : mergedItems;

      const score =
        parsed.action === "complete"
          ? calculateExecutionScore(finalItems)
          : undefined;

      const nextData: Record<string, unknown> = {
        ...data,
        items: finalItems,
        status: parsed.action === "complete" ? "completed" : "claimed",
        completedByUserId: parsed.action === "complete" ? actor.userId : null,
        completedByUsername: parsed.action === "complete" ? actor.username : null,
        completedAt: parsed.action === "complete" ? nowIso : null,
        score: score !== undefined ? score : data.score ?? null,
        updatedAt: now,
      };

      transaction.set(executionRef, nextData, { merge: true });
      return nextData;
    });

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
