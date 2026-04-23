import { NextRequest, NextResponse } from "next/server";

import { assertDPChecklistAccess } from "@/features/dp-checklists/lib/server-access";
import {
  checklistDbAdmin,
  normalizeChecklistExecutionForApi,
  normalizeChecklistTemplateForApi,
} from "@/features/dp-checklists/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getDefaultDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const access = await assertDPChecklistAccess(request, "view");
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date")?.trim() || getDefaultDate();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "A data deve estar no formato YYYY-MM-DD." },
        { status: 400 }
      );
    }

    const [templatesSnap, executionsSnap] = await Promise.all([
      checklistDbAdmin.collection("checklistTemplates").orderBy("name").get(),
      checklistDbAdmin
        .collection("checklistExecutions")
        .where("checklistDate", "==", date)
        .get(),
    ]);

    const templates = templatesSnap.docs
      .map((doc) => normalizeChecklistTemplateForApi(doc.id, doc.data() ?? {}))
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

    return NextResponse.json({
      date,
      templates,
      executions,
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
