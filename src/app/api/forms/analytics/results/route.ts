import { type NextRequest, NextResponse } from "next/server";

import {
  parseActiveFilter,
  requireAnalyticsContext,
  taxonomyErrorResponse,
} from "@/features/forms/analytics/api";
import {
  createAnalyticsResult,
  listAnalyticsResults,
} from "@/features/forms/analytics/taxonomy-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "view");
    const results = await listAnalyticsResults(context, {
      isActive: parseActiveFilter(request),
    });

    return NextResponse.json({ results });
  } catch (error) {
    return taxonomyErrorResponse(error, "Falha ao listar resultados.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "manage_taxonomy");
    const id = await createAnalyticsResult(context, await request.json());

    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return taxonomyErrorResponse(error, "Falha ao criar resultado.");
  }
}
