import { type NextRequest, NextResponse } from "next/server";

import {
  parseActiveFilter,
  requireAnalyticsContext,
  taxonomyErrorResponse,
} from "@/features/forms/analytics/api";
import {
  createAnalyticsDomain,
  listAnalyticsDomains,
} from "@/features/forms/analytics/taxonomy-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "view");
    const domains = await listAnalyticsDomains(context, {
      isActive: parseActiveFilter(request),
    });

    return NextResponse.json({ domains });
  } catch (error) {
    return taxonomyErrorResponse(error, "Falha ao listar domínios.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "manage_taxonomy");
    const id = await createAnalyticsDomain(context, await request.json());

    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return taxonomyErrorResponse(error, "Falha ao criar domínio.");
  }
}
