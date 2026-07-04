import { type NextRequest, NextResponse } from "next/server";

import {
  requireAnalyticsContext,
  taxonomyErrorResponse,
} from "@/features/forms/analytics/api";
import {
  deactivateAnalyticsResult,
  updateAnalyticsResult,
} from "@/features/forms/analytics/taxonomy-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  contextArg: { params: Promise<{ resultId: string }> }
) {
  try {
    const context = await requireAnalyticsContext(request, "manage_taxonomy");
    const { resultId } = await contextArg.params;

    await updateAnalyticsResult(context, resultId, await request.json());

    return NextResponse.json({ ok: true });
  } catch (error) {
    return taxonomyErrorResponse(error, "Falha ao atualizar resultado.");
  }
}

export async function DELETE(
  request: NextRequest,
  contextArg: { params: Promise<{ resultId: string }> }
) {
  try {
    const context = await requireAnalyticsContext(request, "manage_taxonomy");
    const { resultId } = await contextArg.params;

    await deactivateAnalyticsResult(context, resultId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return taxonomyErrorResponse(error, "Falha ao desativar resultado.");
  }
}
