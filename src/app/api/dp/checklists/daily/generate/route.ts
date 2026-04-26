import { differenceInCalendarDays, format, getDate, lastDayOfMonth, parseISO } from "date-fns";
import { NextRequest, NextResponse } from "next/server";

import {
  buildChecklistExecutionId,
  buildChecklistExecutionItems,
  buildChecklistExecutionSections,
  doesTemplateMatchShift,
  doesTemplateSupportAutomaticGeneration,
  resolveShiftEndDate,
} from "@/features/dp-checklists/lib/core";
import { checklistDateSchema } from "@/features/dp-checklists/lib/schemas";
import { assertDPChecklistAccess } from "@/features/dp-checklists/lib/server-access";
import {
  appendChecklistAudit,
  checklistDbAdmin,
  loadChecklistActor,
  loadChecklistReferenceData,
  normalizeChecklistTemplateForApi,
} from "@/features/dp-checklists/lib/server";
import type { DPChecklistTemplate, DPShift, User } from "@/types";
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
> & {
  assignedUsername: string;
  userJobRoleId?: string | null;
  userJobFunctionIds?: string[];
};

function getTemplateAnchorDate(template: Pick<DPChecklistTemplate, "createdAt">) {
  const raw =
    typeof template.createdAt === "string"
      ? template.createdAt
      : typeof (template.createdAt as { toDate?: () => Date })?.toDate === "function"
        ? (template.createdAt as { toDate: () => Date }).toDate().toISOString()
        : null;

  if (!raw) return null;
  try {
    return format(parseISO(raw), "yyyy-MM-dd");
  } catch {
    return null;
  }
}

function matchesTemplateOccurrence(
  template: Pick<DPChecklistTemplate, "occurrenceType" | "createdAt">,
  date: string
) {
  const occurrenceType = template.occurrenceType ?? "manual";
  if (occurrenceType === "daily") return true;
  if (occurrenceType === "manual") return false;

  const anchorDate = getTemplateAnchorDate(template);
  if (!anchorDate) return false;

  const target = parseISO(`${date}T12:00:00.000Z`);
  const anchor = parseISO(`${anchorDate}T12:00:00.000Z`);

  if (occurrenceType === "weekly") {
    const delta = differenceInCalendarDays(target, anchor);
    return delta >= 0 && delta % 7 === 0;
  }

  if (occurrenceType === "biweekly") {
    const delta = differenceInCalendarDays(target, anchor);
    return delta >= 0 && delta % 14 === 0;
  }

  if (occurrenceType === "monthly") {
    if (target < anchor) return false;
    const anchorDay = getDate(anchor);
    const monthLastDay = getDate(lastDayOfMonth(target));
    return getDate(target) === Math.min(anchorDay, monthLastDay);
  }

  return false;
}

async function loadUsers(userIds: string[]) {
  const uniqueIds = [...new Set(userIds)];
  const userSnaps = await Promise.all(
    uniqueIds.map((userId) => dbAdmin.collection("users").doc(userId).get())
  );

  return new Map<string, User>(
    userSnaps
      .filter((snap) => snap.exists)
      .map((snap) => [
        snap.id,
        {
          id: snap.id,
          ...(snap.data() as Omit<User, "id">),
        } as User,
      ])
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
      .map((doc) => normalizeChecklistTemplateForApi(doc.id, doc.data() ?? {}))
      .filter((template) => doesTemplateSupportAutomaticGeneration(template))
      .filter((template) => matchesTemplateOccurrence(template, parsed.date));

    const workShiftDocs = shiftsSnap.docs.filter((doc) => {
      const data = doc.data() ?? {};
      return data.type === "work";
    });

    const userById = await loadUsers(
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

      const user = userById.get(data.userId);
      if (!user || user.isActive === false) {
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
        assignedUsername:
          typeof user.username === "string" && user.username.trim()
            ? user.username
            : data.userId,
        userJobRoleId:
          typeof user.jobRoleId === "string" ? user.jobRoleId : undefined,
        userJobFunctionIds: Array.isArray(user.jobFunctionIds)
          ? user.jobFunctionIds
          : [],
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
            userJobRoleId: shift.userJobRoleId,
            userJobFunctionIds: shift.userJobFunctionIds,
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
          templateType: template.templateType,
          templateVersion: template.version ?? 1,
          occurrenceType: template.occurrenceType ?? null,
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
          sections: buildChecklistExecutionSections(template.sections),
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
          incidentContext: null,
          supplierName: null,
          invoiceNumber: null,
          scheduledDate: null,
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
