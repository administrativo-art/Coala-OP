import { type NextRequest, NextResponse } from "next/server";

import {
  parseActiveFilter,
  requireAnalyticsContext,
  taxonomyErrorResponse,
} from "@/features/forms/analytics/api";
import {
  createAnalyticsTarget,
  listAnalyticsTargets,
} from "@/features/forms/analytics/taxonomy-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "view");
    const targets = await listAnalyticsTargets(context, {
      isActive: parseActiveFilter(request),
      type: request.nextUrl.searchParams.get("type"),
    });

    return NextResponse.json({ targets });
  } catch (error) {
    return taxonomyErrorResponse(error, "Falha ao listar alvos.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "manage_taxonomy");
    const id = await createAnalyticsTarget(context, await request.json());

    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return taxonomyErrorResponse(error, "Falha ao criar alvo.");
  }
}
