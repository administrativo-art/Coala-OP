import { z } from "zod";
import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { generateDueFormExecutions } from "@/features/forms/lib/generator";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { logAction } from "@/lib/log-action";
import { WORKSPACE_ID } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const runSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dryRun: z.boolean().optional(),
});

type SchedulerContext =
  | (ServerUserContext & { authMethod: "user" })
  | {
      authMethod: "machine";
      workspace_id: string;
      userDoc: {
        id: string;
        username: string;
      };
      isDefaultAdmin: true;
      permissions: null;
    };

const SCHEDULER_SECRET_HEADER = "x-scheduler-secret";
const SCHEDULER_ACTOR_ID = "forms-scheduler";
const SCHEDULER_ACTOR_NAME = "Agendador de formulários";

function timingSafeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

async function resolveSchedulerContext(request: NextRequest): Promise<SchedulerContext> {
  const providedSecret = request.headers.get(SCHEDULER_SECRET_HEADER)?.trim();

  if (providedSecret) {
    const expectedSecret = process.env.FORMS_SCHEDULER_SECRET?.trim();
    if (!expectedSecret || !timingSafeStringEqual(providedSecret, expectedSecret)) {
      throw new Error("Credencial do agendador inválida.");
    }

    return {
      authMethod: "machine",
      workspace_id: process.env.FORMS_SCHEDULER_WORKSPACE_ID?.trim() || WORKSPACE_ID,
      userDoc: {
        id: SCHEDULER_ACTOR_ID,
        username: SCHEDULER_ACTOR_NAME,
      },
      isDefaultAdmin: true,
      permissions: null,
    };
  }

  return {
    ...(await requireUser(request)),
    authMethod: "user",
  };
}

function canRunScheduler(context: SchedulerContext) {
  if (context.authMethod === "machine") return true;

  return (
    context.isDefaultAdmin ||
    context.permissions.forms.global.manage_templates ||
    context.permissions.forms.global.create_projects ||
    context.permissions.dp.checklists.manageTemplates
  );
}

export async function POST(request: NextRequest) {
  try {
    const context = await resolveSchedulerContext(request);
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
        auth_method: context.authMethod,
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
