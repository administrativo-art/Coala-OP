import { type NextRequest, NextResponse } from "next/server";

import {
  requireAnalyticsContext,
  taxonomyErrorResponse,
} from "@/features/forms/analytics/api";
import {
  deactivateAnalyticsCriterion,
  updateAnalyticsCriterion,
} from "@/features/forms/analytics/taxonomy-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  contextArg: { params: Promise<{ criterionId: string }> }
) {
  try {
    const context = await requireAnalyticsContext(request, "manage_taxonomy");
    const { criterionId } = await contextArg.params;

    await updateAnalyticsCriterion(context, criterionId, await request.json());

    return NextResponse.json({ ok: true });
  } catch (error) {
    return taxonomyErrorResponse(error, "Falha ao atualizar quesito.");
  }
}

export async function DELETE(
  request: NextRequest,
  contextArg: { params: Promise<{ criterionId: string }> }
) {
  try {
    const context = await requireAnalyticsContext(request, "manage_taxonomy");
    const { criterionId } = await contextArg.params;

    await deactivateAnalyticsCriterion(context, criterionId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return taxonomyErrorResponse(error, "Falha ao desativar quesito.");
  }
}
