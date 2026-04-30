import { NextRequest, NextResponse } from "next/server";

import { listFormExecutions } from "@/features/forms/lib/server";
import { assertFormPermission } from "@/features/forms/lib/server-access";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const formProjectId = searchParams.get("formProjectId")?.trim() || null;
    const status = searchParams.get("status")?.trim() || null;
    const limit = Number(searchParams.get("limit") ?? "50");

    if (formProjectId) {
      assertFormPermission(
        context.permissions,
        context.isDefaultAdmin,
        formProjectId,
        "view"
      );
    }

    const executions = await listFormExecutions({
      workspaceId: context.workspace_id,
      formProjectId,
      status,
      limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 50,
    });

    return NextResponse.json({ executions });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao listar execuções.",
      },
      { status: 403 }
    );
  }
}
