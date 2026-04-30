import { NextRequest, NextResponse } from "next/server";

import { assertDPChecklistAccess } from "@/features/dp-checklists/lib/server-access";
import { assertLegacyChecklistReadAllowed } from "@/features/dp-checklists/lib/rollout";
import {
  checklistDbAdmin,
  normalizeChecklistExecutionForApi,
  normalizeOperationalTaskForApi,
  normalizeChecklistTemplateForApi,
  normalizeChecklistTypeForApi,
  loadChecklistReferenceData,
} from "@/features/dp-checklists/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getDefaultDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    await assertLegacyChecklistReadAllowed();
    const access = await assertDPChecklistAccess(request, "view");
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date")?.trim() || getDefaultDate();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "A data deve estar no formato YYYY-MM-DD." },
        { status: 400 }
      );
    }

    const [templatesSnap, executionsSnap, allExecutionsSnap, tasksSnap, typesSnap, references] =
      await Promise.all([
      checklistDbAdmin.collection("checklistTemplates").orderBy("name").get(),
      checklistDbAdmin
        .collection("checklistExecutions")
        .where("checklistDate", "==", date)
        .get(),
      checklistDbAdmin
        .collection("checklistExecutions")
        .orderBy("checklistDate", "desc")
        .get(),
      checklistDbAdmin.collection("operationalTasks").get(),
      checklistDbAdmin.collection("checklistTypes").orderBy("name").get(),
      loadChecklistReferenceData(),
    ]);

    const lastExecutionByTemplateId = new Map<string, string>();
    for (const doc of allExecutionsSnap.docs) {
      const execution = normalizeChecklistExecutionForApi(doc.id, doc.data() ?? {});
      if (!execution.templateId || lastExecutionByTemplateId.has(execution.templateId)) {
        continue;
      }

      const timestamp =
        typeof execution.updatedAt === "string"
          ? execution.updatedAt
          : typeof execution.createdAt === "string"
            ? execution.createdAt
            : execution.checklistDate;

      lastExecutionByTemplateId.set(execution.templateId, timestamp);
    }

    const templates = templatesSnap.docs
      .map((doc) => ({
        ...normalizeChecklistTemplateForApi(doc.id, doc.data() ?? {}),
        lastExecutionAt: lastExecutionByTemplateId.get(doc.id) ?? null,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

    const executions = executionsSnap.docs
      .map((doc) => normalizeChecklistExecutionForApi(doc.id, doc.data() ?? {}))
      .sort((left, right) => {
        const byStatus = left.status.localeCompare(right.status, "pt-BR");
        if (byStatus !== 0) return byStatus;
        const byUnit = (left.unitName ?? "").localeCompare(right.unitName ?? "", "pt-BR");
        if (byUnit !== 0) return byUnit;
        const byStart = left.shiftStartTime.localeCompare(right.shiftStartTime);
        if (byStart !== 0) return byStart;
        return left.templateName.localeCompare(right.templateName, "pt-BR");
      });

    const tasks = tasksSnap.docs
      .map((doc) => normalizeOperationalTaskForApi(doc.id, doc.data() ?? {}))
      .filter(
        (task) =>
          task.status === "open" ||
          task.status === "in_progress" ||
          task.status === "escalated"
      )
      .sort((left, right) => {
        const statusWeight = (value: string) => {
          if (value === "escalated") return 0;
          if (value === "open") return 1;
          if (value === "in_progress") return 2;
          return 3;
        };

        const byStatus = statusWeight(left.status) - statusWeight(right.status);
        if (byStatus !== 0) return byStatus;

        return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
      });
    const taskSummary = tasks.reduce(
      (accumulator, task) => {
        if (task.status === "open") accumulator.open += 1;
        if (task.status === "in_progress") accumulator.inProgress += 1;
        if (task.status === "escalated") accumulator.escalated += 1;
        return accumulator;
      },
      { open: 0, inProgress: 0, escalated: 0 }
    );

    const checklistTypes = typesSnap.docs
      .map((doc) => normalizeChecklistTypeForApi(doc.id, doc.data() ?? {}))
      .filter((t) => t.isActive !== false);

    return NextResponse.json({
      date,
      templates,
      executions,
      checklistTypes,
      roles: references.roles,
      functions: references.functions,
      tasks,
      taskSummary,
      access: {
        canView: access.canView,
        canOperate: access.canOperate,
        canManageTemplates: access.canManageTemplates,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro ao carregar os checklists do DP.",
      },
      { status: 403 }
    );
  }
}
