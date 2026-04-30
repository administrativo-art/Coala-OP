import { NextRequest, NextResponse } from "next/server";

import { assertLegacyChecklistReadAllowed } from "@/features/dp-checklists/lib/rollout";
import { assertDPChecklistAccess } from "@/features/dp-checklists/lib/server-access";
import {
  checklistDbAdmin,
  normalizeOperationalTaskForApi,
} from "@/features/dp-checklists/lib/server";
import type { OperationalTask } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = new Set(["open", "in_progress", "escalated"]);

function sortOperationalTasks(left: OperationalTask, right: OperationalTask) {
  const weight = (status: string) => {
    if (status === "escalated") return 0;
    if (status === "open") return 1;
    if (status === "in_progress") return 2;
    return 3;
  };

  const byStatus = weight(left.status) - weight(right.status);
  if (byStatus !== 0) return byStatus;

  return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
}

export async function GET(request: NextRequest) {
  try {
    await assertLegacyChecklistReadAllowed();
    await assertDPChecklistAccess(request, "view");

    const { searchParams } = new URL(request.url);
    const unitId = searchParams.get("unitId")?.trim() || null;
    const statusFilter = searchParams
      .get("status")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    const taskSnap = unitId
      ? await checklistDbAdmin
          .collection("operationalTasks")
          .where("unitId", "==", unitId)
          .get()
      : await checklistDbAdmin.collection("operationalTasks").get();

    const allowedStatuses = statusFilter?.length
      ? new Set(statusFilter)
      : ACTIVE_STATUSES;

    const tasks = taskSnap.docs
      .map((doc) => normalizeOperationalTaskForApi(doc.id, doc.data() ?? {}))
      .filter((task) => allowedStatuses.has(task.status))
      .sort(sortOperationalTasks);

    const summary = tasks.reduce(
      (accumulator, task) => {
        if (task.status === "open") accumulator.open += 1;
        if (task.status === "in_progress") accumulator.inProgress += 1;
        if (task.status === "escalated") accumulator.escalated += 1;
        return accumulator;
      },
      { open: 0, inProgress: 0, escalated: 0 }
    );

    return NextResponse.json({ tasks, summary });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao carregar as tarefas operacionais.",
      },
      { status: 403 }
    );
  }
}
