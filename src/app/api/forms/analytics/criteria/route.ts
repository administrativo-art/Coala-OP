import { type NextRequest, NextResponse } from "next/server";

import {
  parseActiveFilter,
  requireAnalyticsContext,
  taxonomyErrorResponse,
} from "@/features/forms/analytics/api";
import {
  createAnalyticsCriterion,
  listAnalyticsCriteria,
} from "@/features/forms/analytics/taxonomy-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "view");
    const criteria = await listAnalyticsCriteria(context, {
      isActive: parseActiveFilter(request),
      domainId: request.nextUrl.searchParams.get("domainId"),
    });

    return NextResponse.json({ criteria });
  } catch (error) {
    return taxonomyErrorResponse(error, "Falha ao listar quesitos.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "manage_taxonomy");
    const id = await createAnalyticsCriterion(context, await request.json());

    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return taxonomyErrorResponse(error, "Falha ao criar quesito.");
  }
}
