import { type NextRequest, NextResponse } from "next/server";

import {
  requireAnalyticsContext,
  taxonomyErrorResponse,
} from "@/features/forms/analytics/api";
import {
  deactivateAnalyticsTarget,
  updateAnalyticsTarget,
} from "@/features/forms/analytics/taxonomy-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  contextArg: { params: Promise<{ targetId: string }> }
) {
  try {
    const context = await requireAnalyticsContext(request, "manage_taxonomy");
    const { targetId } = await contextArg.params;

    await updateAnalyticsTarget(context, targetId, await request.json());

    return NextResponse.json({ ok: true });
  } catch (error) {
    return taxonomyErrorResponse(error, "Falha ao atualizar alvo.");
  }
}

export async function DELETE(
  request: NextRequest,
  contextArg: { params: Promise<{ targetId: string }> }
) {
  try {
    const context = await requireAnalyticsContext(request, "manage_taxonomy");
    const { targetId } = await contextArg.params;

    await deactivateAnalyticsTarget(context, targetId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return taxonomyErrorResponse(error, "Falha ao desativar alvo.");
  }
}
