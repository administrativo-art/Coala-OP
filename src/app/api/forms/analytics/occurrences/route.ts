import { type NextRequest, NextResponse } from "next/server";

import {
  assertAnalyticsContextPermission,
  requireAnalyticsContext,
  taxonomyErrorResponse,
} from "@/features/forms/analytics/api";
import {
  DashboardFilterError,
  dashboardFilterErrorResponse,
  parseDashboardFilters,
  parsePageSize,
} from "@/features/forms/analytics/dashboard-api";
import {
  listOccurrences,
  serializeOccurrenceListPage,
} from "@/features/forms/analytics/dashboard-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "view_occurrences");
    const filters = parseDashboardFilters(request, context.workspaceId);
    const includePersonalData =
      request.nextUrl.searchParams.get("include_personal") === "true";

    if (includePersonalData) {
      assertAnalyticsContextPermission(context, "view_personal_targets");
    }

    const page = await listOccurrences(context, filters, {
      cursor: request.nextUrl.searchParams.get("cursor"),
      pageSize: parsePageSize(request),
      includePersonalData,
    });

    return NextResponse.json(serializeOccurrenceListPage(page));
  } catch (error) {
    if (error instanceof DashboardFilterError) {
      return dashboardFilterErrorResponse(error);
    }

    return taxonomyErrorResponse(error, "Falha ao listar ocorrências.");
  }
}
