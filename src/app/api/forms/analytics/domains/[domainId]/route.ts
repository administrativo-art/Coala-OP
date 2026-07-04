import { type NextRequest, NextResponse } from "next/server";

import {
  requireAnalyticsContext,
  taxonomyErrorResponse,
} from "@/features/forms/analytics/api";
import {
  deactivateAnalyticsDomain,
  updateAnalyticsDomain,
} from "@/features/forms/analytics/taxonomy-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  contextArg: { params: Promise<{ domainId: string }> }
) {
  try {
    const context = await requireAnalyticsContext(request, "manage_taxonomy");
    const { domainId } = await contextArg.params;

    await updateAnalyticsDomain(context, domainId, await request.json());

    return NextResponse.json({ ok: true });
  } catch (error) {
    return taxonomyErrorResponse(error, "Falha ao atualizar domínio.");
  }
}

export async function DELETE(
  request: NextRequest,
  contextArg: { params: Promise<{ domainId: string }> }
) {
  try {
    const context = await requireAnalyticsContext(request, "manage_taxonomy");
    const { domainId } = await contextArg.params;

    await deactivateAnalyticsDomain(context, domainId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return taxonomyErrorResponse(error, "Falha ao desativar domínio.");
  }
}
