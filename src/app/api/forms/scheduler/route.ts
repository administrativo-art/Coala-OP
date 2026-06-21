import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

import { generateDueFormExecutions } from "@/features/forms/lib/generator";
import { requireUser } from "@/lib/auth-server";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const runSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dryRun: z.boolean().optional(),
});

function canRunScheduler(context: Awaited<ReturnType<typeof requireUser>>) {
  return (
    context.isDefaultAdmin ||
    context.permissions.forms.global.manage_templates ||
    context.permissions.forms.global.create_projects ||
    context.permissions.dp.checklists.manageTemplates
  );
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canRunScheduler(context)) {
      return NextResponse.json(
        { error: "Sem permissão para gerar execuções recorrentes." },
        { status: 403 }
      );
    }

    const parsed = runSchema.parse(await request.json().catch(() => ({})));
    const result = await generateDueFormExecutions({
      workspaceId: context.workspace_id,
      actor: {
        user_id: context.userDoc.id,
        username: context.userDoc.username,
      },
      fromDate: parsed.fromDate,
      toDate: parsed.toDate,
      dryRun: parsed.dryRun,
    });

    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "forms",
      action: parsed.dryRun ? "scheduler_dry_run" : "scheduler_run",
      metadata: {
        fromDate: parsed.fromDate ?? null,
        toDate: parsed.toDate ?? null,
        created_count: result.created.length,
        skipped_count: result.skipped.length,
        overdue_updated: result.overdueUpdated,
      },
    });

    return NextResponse.json({
      created_count: result.created.length,
      skipped_count: result.skipped.length,
      overdue_updated: result.overdueUpdated,
      created: result.created,
      skipped: result.skipped.slice(0, 100),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao gerar execuções recorrentes.",
      },
      { status: 400 }
    );
  }
}
