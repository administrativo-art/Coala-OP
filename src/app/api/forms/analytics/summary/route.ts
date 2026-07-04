import { type NextRequest, NextResponse } from "next/server";

import {
  DashboardFilterError,
  dashboardFilterErrorResponse,
  parseDashboardFilters,
} from "@/features/forms/analytics/dashboard-api";
import { getDashboardCards } from "@/features/forms/analytics/dashboard-service";
import {
  requireAnalyticsContext,
  taxonomyErrorResponse,
} from "@/features/forms/analytics/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "view");
    const filters = parseDashboardFilters(request, context.workspaceId);
    const cards = await getDashboardCards(context, filters);

    return NextResponse.json({ cards });
  } catch (error) {
    if (error instanceof DashboardFilterError) {
      return dashboardFilterErrorResponse(error);
    }

    return taxonomyErrorResponse(error, "Falha ao carregar resumo.");
  }
}
