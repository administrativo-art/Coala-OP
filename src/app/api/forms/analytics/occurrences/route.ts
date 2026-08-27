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
  listOccurrencesForExecution,
  serializeOccurrenceListPage,
} from "@/features/forms/analytics/dashboard-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "view_occurrences");
    const includePersonalData =
      request.nextUrl.searchParams.get("include_personal") === "true";

    if (includePersonalData) {
      assertAnalyticsContextPermission(context, "view_personal_targets");
    }

    const executionId = request.nextUrl.searchParams.get("execution_id");
    if (executionId) {
      const items = await listOccurrencesForExecution(
        context,
        context.workspaceId,
        executionId,
        { includePersonalData }
      );
      return NextResponse.json({ items, next_cursor: null });
    }

    const filters = parseDashboardFilters(request, context.workspaceId);

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
