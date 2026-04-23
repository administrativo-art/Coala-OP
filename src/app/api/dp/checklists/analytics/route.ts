import { NextRequest, NextResponse } from "next/server";
import { addDays, format } from "date-fns";

import { getChecklistExecutionMetrics } from "@/features/dp-checklists/lib/core";
import { assertDPChecklistAccess } from "@/features/dp-checklists/lib/server-access";
import {
  checklistDbAdmin,
  normalizeChecklistExecutionForApi,
} from "@/features/dp-checklists/lib/server";
import type { DPChecklistExecution } from "@/types";
import { DEFAULT_LOGIN_ACCESS_TIMEZONE } from "@/features/hr/lib/login-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function defaultDateFrom() {
  return format(addDays(new Date(), -30), "yyyy-MM-dd");
}

function defaultDateTo() {
  return format(new Date(), "yyyy-MM-dd");
}

function isExecutionStatus(value: string): value is DPChecklistExecution["status"] {
  return (
    value === "pending" ||
    value === "claimed" ||
    value === "completed" ||
    value === "overdue"
  );
}

function roundMetric(value: number) {
  return Number(value.toFixed(1));
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return roundMetric(values.reduce((sum, item) => sum + item, 0) / values.length);
}

export async function GET(request: NextRequest) {
  try {
    await assertDPChecklistAccess(request, "view");

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom")?.trim() || defaultDateFrom();
    const dateTo = searchParams.get("dateTo")?.trim() || defaultDateTo();
    const unitId = searchParams.get("unitId")?.trim() || null;
    const templateId = searchParams.get("templateId")?.trim() || null;
    const rawStatus = searchParams.get("status")?.trim() || "all";
    const status = isExecutionStatus(rawStatus) ? rawStatus : "all";
    const timeZone =
      searchParams.get("timeZone")?.trim() || DEFAULT_LOGIN_ACCESS_TIMEZONE;

    if (!ISO_DATE_PATTERN.test(dateFrom) || !ISO_DATE_PATTERN.test(dateTo)) {
      return NextResponse.json(
        { error: "As datas devem estar no formato YYYY-MM-DD." },
        { status: 400 }
      );
    }

    if (dateFrom > dateTo) {
      return NextResponse.json(
        { error: "O período informado é inválido." },
        { status: 400 }
      );
    }

    const executionSnaps = await checklistDbAdmin
      .collection("checklistExecutions")
      .where("checklistDate", ">=", dateFrom)
      .where("checklistDate", "<=", dateTo)
      .get();

    const now = new Date();
    const executions = executionSnaps.docs
      .map((doc) => normalizeChecklistExecutionForApi(doc.id, doc.data() ?? {}))
      .filter((execution) => (unitId ? execution.unitId === unitId : true))
      .filter((execution) => (templateId ? execution.templateId === templateId : true))
      .filter((execution) => (status === "all" ? true : execution.status === status));

    const evaluatedExecutions = executions.map((execution) => ({
      execution,
      metrics: getChecklistExecutionMetrics({ execution, at: now, timeZone }),
    }));

    const completedExecutions = evaluatedExecutions.filter(
      ({ execution }) => execution.status === "completed"
    );
    const claimedExecutions = evaluatedExecutions.filter(
      ({ execution }) => execution.status === "claimed"
    );
    const pendingExecutions = evaluatedExecutions.filter(
      ({ execution }) => execution.status === "pending"
    );
    const overdueExecutions = evaluatedExecutions.filter(
      ({ metrics }) => metrics.isOverdue
    );

    const summary = {
      totalExecutions: evaluatedExecutions.length,
      completedExecutions: completedExecutions.length,
      claimedExecutions: claimedExecutions.length,
      pendingExecutions: pendingExecutions.length,
      overdueExecutions: overdueExecutions.length,
      completionRate:
        evaluatedExecutions.length > 0
          ? roundMetric(
              (completedExecutions.length / evaluatedExecutions.length) * 100
            )
          : 0,
      averageScore: average(evaluatedExecutions.map(({ metrics }) => metrics.score)),
      averageRequiredScore: average(
        evaluatedExecutions.map(({ metrics }) => metrics.requiredCompletionPercent)
      ),
      uniqueTemplates: new Set(
        evaluatedExecutions.map(({ execution }) => execution.templateId)
      ).size,
      uniqueUsers: new Set(
        evaluatedExecutions.map(({ execution }) => execution.assignedUserId)
      ).size,
    };

    const dailyTrend = Array.from(
      evaluatedExecutions.reduce((map, entry) => {
        const key = entry.execution.checklistDate;
        const current = map.get(key) ?? {
          date: key,
          totalExecutions: 0,
          completedExecutions: 0,
          overdueExecutions: 0,
          scores: [] as number[],
        };

        current.totalExecutions += 1;
        if (entry.execution.status === "completed") current.completedExecutions += 1;
        if (entry.metrics.isOverdue) current.overdueExecutions += 1;
        current.scores.push(entry.metrics.score);
        map.set(key, current);
        return map;
      }, new Map<string, { date: string; totalExecutions: number; completedExecutions: number; overdueExecutions: number; scores: number[] }>())
    )
      .map(([, value]) => ({
        date: value.date,
        totalExecutions: value.totalExecutions,
        completedExecutions: value.completedExecutions,
        overdueExecutions: value.overdueExecutions,
        averageScore: average(value.scores),
      }))
      .sort((left, right) => left.date.localeCompare(right.date));

    const byUnit = Array.from(
      evaluatedExecutions.reduce((map, entry) => {
        const key = entry.execution.unitId || "__none__";
        const current = map.get(key) ?? {
          unitId: entry.execution.unitId,
          unitName: entry.execution.unitName ?? "Sem unidade",
          totalExecutions: 0,
          completedExecutions: 0,
          overdueExecutions: 0,
          scores: [] as number[],
        };

        current.totalExecutions += 1;
        if (entry.execution.status === "completed") current.completedExecutions += 1;
        if (entry.metrics.isOverdue) current.overdueExecutions += 1;
        current.scores.push(entry.metrics.score);
        map.set(key, current);
        return map;
      }, new Map<string, { unitId: string; unitName: string; totalExecutions: number; completedExecutions: number; overdueExecutions: number; scores: number[] }>())
    )
      .map(([, value]) => ({
        unitId: value.unitId,
        unitName: value.unitName,
        totalExecutions: value.totalExecutions,
        completedExecutions: value.completedExecutions,
        overdueExecutions: value.overdueExecutions,
        averageScore: average(value.scores),
      }))
      .sort((left, right) => right.totalExecutions - left.totalExecutions);

    const byTemplate = Array.from(
      evaluatedExecutions.reduce((map, entry) => {
        const key = entry.execution.templateId;
        const current = map.get(key) ?? {
          templateId: entry.execution.templateId,
          templateName: entry.execution.templateName,
          totalExecutions: 0,
          completedExecutions: 0,
          overdueExecutions: 0,
          scores: [] as number[],
        };

        current.totalExecutions += 1;
        if (entry.execution.status === "completed") current.completedExecutions += 1;
        if (entry.metrics.isOverdue) current.overdueExecutions += 1;
        current.scores.push(entry.metrics.score);
        map.set(key, current);
        return map;
      }, new Map<string, { templateId: string; templateName: string; totalExecutions: number; completedExecutions: number; overdueExecutions: number; scores: number[] }>())
    )
      .map(([, value]) => ({
        templateId: value.templateId,
        templateName: value.templateName,
        totalExecutions: value.totalExecutions,
        completedExecutions: value.completedExecutions,
        overdueExecutions: value.overdueExecutions,
        averageScore: average(value.scores),
      }))
      .sort((left, right) => right.totalExecutions - left.totalExecutions);

    const byUser = Array.from(
      evaluatedExecutions.reduce((map, entry) => {
        const key = entry.execution.assignedUserId;
        const current = map.get(key) ?? {
          userId: entry.execution.assignedUserId,
          username: entry.execution.assignedUsername,
          totalExecutions: 0,
          completedExecutions: 0,
          overdueExecutions: 0,
          scores: [] as number[],
        };

        current.totalExecutions += 1;
        if (entry.execution.status === "completed") current.completedExecutions += 1;
        if (entry.metrics.isOverdue) current.overdueExecutions += 1;
        current.scores.push(entry.metrics.score);
        map.set(key, current);
        return map;
      }, new Map<string, { userId: string; username: string; totalExecutions: number; completedExecutions: number; overdueExecutions: number; scores: number[] }>())
    )
      .map(([, value]) => ({
        userId: value.userId,
        username: value.username,
        totalExecutions: value.totalExecutions,
        completedExecutions: value.completedExecutions,
        overdueExecutions: value.overdueExecutions,
        averageScore: average(value.scores),
      }))
      .sort((left, right) => right.totalExecutions - left.totalExecutions);

    const overdueItems = overdueExecutions
      .map(({ execution, metrics }) => ({
        id: execution.id,
        checklistDate: execution.checklistDate,
        templateId: execution.templateId,
        templateName: execution.templateName,
        unitId: execution.unitId,
        unitName: execution.unitName ?? "Sem unidade",
        assignedUserId: execution.assignedUserId,
        assignedUsername: execution.assignedUsername,
        claimedByUsername: execution.claimedByUsername ?? null,
        status: execution.status,
        shiftStartTime: execution.shiftStartTime,
        shiftEndTime: execution.shiftEndTime,
        shiftEndDate: execution.shiftEndDate,
        completionPercent: metrics.completionPercent,
        requiredCompletionPercent: metrics.requiredCompletionPercent,
        overdueSinceLocal: metrics.overdueSinceLocal,
      }))
      .sort((left, right) => {
        if ((left.overdueSinceLocal ?? "") !== (right.overdueSinceLocal ?? "")) {
          return (right.overdueSinceLocal ?? "").localeCompare(
            left.overdueSinceLocal ?? ""
          );
        }
        return right.checklistDate.localeCompare(left.checklistDate);
      })
      .slice(0, 25);

    return NextResponse.json({
      filters: { dateFrom, dateTo, unitId, templateId, status, timeZone },
      summary,
      dailyTrend,
      byUnit,
      byTemplate,
      byUser,
      overdueExecutions: overdueItems,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro ao carregar o painel gerencial dos checklists.",
      },
      { status: 400 }
    );
  }
}
