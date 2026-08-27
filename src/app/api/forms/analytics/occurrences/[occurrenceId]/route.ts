import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  assertAnalyticsContextPermission,
  occurrenceActionErrorResponse,
  requireAnalyticsContext,
} from "@/features/forms/analytics/api";
import { getOccurrenceDetail } from "@/features/forms/analytics/dashboard-service";
import { analyticsSeveritySchema } from "@/features/forms/analytics/schemas";
import { ANALYTICS_COLLECTIONS } from "@/features/forms/analytics/types";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ occurrenceId: string }> };

export async function GET(request: NextRequest, contextArg: RouteContext) {
  try {
    const context = await requireAnalyticsContext(request, "view_occurrences");
    const { occurrenceId } = await contextArg.params;
    const includePersonalData =
      request.nextUrl.searchParams.get("include_personal") === "true";
    if (includePersonalData) {
      assertAnalyticsContextPermission(context, "view_personal_targets");
    }

    const occurrence = await getOccurrenceDetail(
      context,
      context.workspaceId,
      occurrenceId,
      { includePersonalData }
    );
    if (!occurrence) {
      return NextResponse.json(
        { error: "Ocorrência não encontrada." },
        { status: 404 }
      );
    }

    return NextResponse.json({ occurrence });
  } catch (error) {
    return occurrenceActionErrorResponse(error, "Falha ao carregar ocorrência.");
  }
}

const adminPatchSchema = z
  .object({
    severity: analyticsSeveritySchema.optional(),
    description: z.string().trim().max(4000).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

export async function PATCH(request: NextRequest, contextArg: RouteContext) {
  try {
    const context = await requireAnalyticsContext(
      request,
      "edit_occurrences_admin"
    );
    const { occurrenceId } = await contextArg.params;
    const patch = adminPatchSchema.parse(await request.json());

    const ref = context.db
      .collection(ANALYTICS_COLLECTIONS.occurrences)
      .doc(occurrenceId);
    const snap = await ref.get();
    if (
      !snap.exists ||
      String(snap.get("workspace_id") ?? "") !== context.workspaceId
    ) {
      return NextResponse.json(
        { error: "Ocorrência não encontrada." },
        { status: 404 }
      );
    }

    await ref.update({
      ...patch,
      updated_at: new Date(),
      updated_by: context.userId,
    });

    await logAction({
      workspace_id: context.workspaceId,
      user_id: context.userId,
      username: context.username,
      module: "forms",
      action: "analytics_occurrence_admin_edit",
      metadata: { occurrence_id: occurrenceId, patch },
    });

    const occurrence = await getOccurrenceDetail(
      context,
      context.workspaceId,
      occurrenceId,
      { includePersonalData: false }
    );
    return NextResponse.json({ occurrence });
  } catch (error) {
    return occurrenceActionErrorResponse(error, "Falha ao editar ocorrência.");
  }
}
