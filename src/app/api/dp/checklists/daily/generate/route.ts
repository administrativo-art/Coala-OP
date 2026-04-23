import { NextRequest, NextResponse } from "next/server";

import {
  buildChecklistExecutionId,
  buildChecklistExecutionItems,
  doesTemplateMatchShift,
  resolveShiftEndDate,
} from "@/features/dp-checklists/lib/core";
import { checklistDateSchema } from "@/features/dp-checklists/lib/schemas";
import { assertDPChecklistAccess } from "@/features/dp-checklists/lib/server-access";
import {
  appendChecklistAudit,
  checklistDbAdmin,
  loadChecklistActor,
  loadChecklistReferenceData,
} from "@/features/dp-checklists/lib/server";
import type { DPChecklistTemplate, DPShift } from "@/types";
import { dbAdmin } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ShiftCandidate = Pick<
  DPShift,
  | "id"
  | "scheduleId"
  | "unitId"
  | "userId"
  | "shiftDefinitionId"
  | "date"
  | "startTime"
  | "endTime"
  | "type"
> & { assignedUsername: string };

function asChecklistTemplate(
  id: string,
  data: Record<string, unknown>
): DPChecklistTemplate | null {
  if (
    typeof data.name !== "string" ||
    !Array.isArray(data.sections) ||
    typeof data.isActive !== "boolean"
  ) {
    return null;
  }

  return {
    id,
    name: data.name,
    description: typeof data.description === "string" ? data.description : undefined,
    unitIds: Array.isArray(data.unitIds)
      ? data.unitIds.filter((item): item is string => typeof item === "string")
      : [],
    unitNames: Array.isArray(data.unitNames)
      ? data.unitNames.filter((item): item is string => typeof item === "string")
      : [],
    shiftDefinitionIds: Array.isArray(data.shiftDefinitionIds)
      ? data.shiftDefinitionIds.filter((item): item is string => typeof item === "string")
      : [],
    shiftDefinitionNames: Array.isArray(data.shiftDefinitionNames)
      ? data.shiftDefinitionNames.filter((item): item is string => typeof item === "string")
      : [],
    isActive: data.isActive,
    sections: (data.sections as unknown[])
      .map((rawSection) => {
        if (!rawSection || typeof rawSection !== "object") return null;
        const section = rawSection as Record<string, unknown>;
        if (typeof section.id !== "string" || typeof section.title !== "string") {
          return null;
        }
        return {
          id: section.id,
          title: section.title,
          order: typeof section.order === "number" ? section.order : 0,
          items: Array.isArray(section.items)
            ? (section.items as unknown[])
                .map((rawItem) => {
                  if (!rawItem || typeof rawItem !== "object") return null;
                  const item = rawItem as Record<string, unknown>;
                  if (
                    typeof item.id !== "string" ||
                    typeof item.title !== "string" ||
                    typeof item.type !== "string" ||
                    typeof item.required !== "boolean"
                  ) {
                    return null;
                  }
                  return {
                    id: item.id,
                    order: typeof item.order === "number" ? item.order : 0,
                    title: item.title,
                    description:
                      typeof item.description === "string" ? item.description : undefined,
                    type: item.type as DPChecklistTemplate["sections"][0]["items"][0]["type"],
                    required: item.required,
                    weight: typeof item.weight === "number" ? item.weight : 1,
                    config:
                      item.config && typeof item.config === "object"
                        ? (item.config as DPChecklistTemplate["sections"][0]["items"][0]["config"])
                        : undefined,
                  };
                })
                .filter(<T>(x: T | null): x is T => x !== null)
            : [],
        };
      })
      .filter(<T>(x: T | null): x is T => x !== null),
    createdAt: "",
  };
}

async function loadUsernames(userIds: string[]) {
  const uniqueIds = [...new Set(userIds)];
  const userSnaps = await Promise.all(
    uniqueIds.map((userId) => dbAdmin.collection("users").doc(userId).get())
  );

  return new Map<string, string>(
    userSnaps.map((snap) => {
      const data = snap.data() ?? {};
      const username =
        typeof data.username === "string" && data.username.trim()
          ? data.username
          : snap.id;
      return [snap.id, username];
    })
  );
}

export async function POST(request: NextRequest) {
  try {
    const access = await assertDPChecklistAccess(request, "operate");
    const actor = await loadChecklistActor(access.decoded.uid);
    const rawBody = await request.json();
    const parsed = checklistDateSchema.parse(rawBody);

    const [templatesSnap, shiftsSnap, existingExecutionsSnap, references] =
      await Promise.all([
        checklistDbAdmin
          .collection("checklistTemplates")
          .where("isActive", "==", true)
          .get(),
        dbAdmin.collectionGroup("shifts").where("date", "==", parsed.date).get(),
        checklistDbAdmin
          .collection("checklistExecutions")
          .where("checklistDate", "==", parsed.date)
          .get(),
        loadChecklistReferenceData(),
      ]);

    const templates = templatesSnap.docs
      .map((doc) => asChecklistTemplate(doc.id, doc.data() ?? {}))
      .filter((item): item is DPChecklistTemplate => item !== null);

    const workShiftDocs = shiftsSnap.docs.filter((doc) => {
      const data = doc.data() ?? {};
      return data.type === "work";
    });

    const usernameById = await loadUsernames(
      workShiftDocs
        .map((doc) => doc.data()?.userId)
        .filter((item): item is string => typeof item === "string")
    );

    const shifts = workShiftDocs.reduce<ShiftCandidate[]>((accumulator, doc) => {
      const data = doc.data() ?? {};
      if (
        typeof data.scheduleId !== "string" ||
        typeof data.unitId !== "string" ||
        typeof data.userId !== "string" ||
        typeof data.date !== "string" ||
        typeof data.startTime !== "string" ||
        typeof data.endTime !== "string"
      ) {
        return accumulator;
      }

      accumulator.push({
        id: doc.id,
        scheduleId: data.scheduleId,
        unitId: data.unitId,
        userId: data.userId,
        shiftDefinitionId:
          typeof data.shiftDefinitionId === "string"
            ? data.shiftDefinitionId
            : undefined,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        type: "work",
        assignedUsername: usernameById.get(data.userId) ?? data.userId,
      });

      return accumulator;
    }, []);

    const existingIds = new Set(existingExecutionsSnap.docs.map((doc) => doc.id));
    const candidates = shifts.flatMap((shift) =>
      templates
        .filter((template) =>
          doesTemplateMatchShift(template, {
            unitId: shift.unitId,
            shiftDefinitionId: shift.shiftDefinitionId,
          })
        )
        .map((template) => ({ shift, template }))
    );

    let createdExecutions = 0;
    let skippedExecutions = 0;

    const chunks: Array<Array<{ id: string; data: Record<string, unknown> }>> = [];
    let currentChunk: Array<{ id: string; data: Record<string, unknown> }> = [];

    candidates.forEach(({ shift, template }) => {
      const executionId = buildChecklistExecutionId({
        date: parsed.date,
        scheduleId: shift.scheduleId,
        shiftId: shift.id,
        templateId: template.id,
      });

      if (existingIds.has(executionId)) {
        skippedExecutions += 1;
        return;
      }

      existingIds.add(executionId);
      createdExecutions += 1;

      currentChunk.push({
        id: executionId,
        data: {
          checklistDate: parsed.date,
          templateId: template.id,
          templateName: template.name,
          scheduleId: shift.scheduleId,
          shiftId: shift.id,
          unitId: shift.unitId,
          unitName: references.unitNameById.get(shift.unitId) ?? shift.unitId,
          shiftDefinitionId: shift.shiftDefinitionId ?? null,
          shiftDefinitionName: shift.shiftDefinitionId
            ? references.shiftDefinitionNameById.get(shift.shiftDefinitionId) ??
              shift.shiftDefinitionId
            : null,
          assignedUserId: shift.userId,
          assignedUsername: shift.assignedUsername,
          shiftStartTime: shift.startTime,
          shiftEndTime: shift.endTime,
          shiftEndDate: resolveShiftEndDate(
            shift.date,
            shift.startTime,
            shift.endTime
          ),
          status: "pending",
          score: null,
          items: buildChecklistExecutionItems(template.sections),
          claimedByUserId: null,
          claimedByUsername: null,
          claimedAt: null,
          completedByUserId: null,
          completedByUsername: null,
          completedAt: null,
          reviewedBy: null,
          reviewNotes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      if (currentChunk.length === 400) {
        chunks.push(currentChunk);
        currentChunk = [];
      }
    });

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    for (const chunk of chunks) {
      const batch = checklistDbAdmin.batch();
      chunk.forEach((entry) => {
        batch.set(
          checklistDbAdmin.collection("checklistExecutions").doc(entry.id),
          entry.data
        );
      });
      await batch.commit();
    }

    await appendChecklistAudit("executions_generated", {
      actorUserId: actor.userId,
      actorUsername: actor.username,
      checklistDate: parsed.date,
      matchedShifts: shifts.length,
      matchedTemplates: templates.length,
      createdExecutions,
      skippedExecutions,
    });

    return NextResponse.json({
      date: parsed.date,
      matchedShifts: shifts.length,
      createdExecutions,
      skippedExecutions,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro ao gerar os checklists do dia.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
