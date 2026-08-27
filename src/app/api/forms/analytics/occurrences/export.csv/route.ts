import { type NextRequest } from "next/server";

import {
  assertAnalyticsContextPermission,
  requireAnalyticsContext,
  taxonomyErrorResponse,
} from "@/features/forms/analytics/api";
import {
  DashboardFilterError,
  dashboardFilterErrorResponse,
  parseDashboardFilters,
} from "@/features/forms/analytics/dashboard-api";
import {
  listOccurrences,
  toCsv,
  type OccurrenceListItem,
} from "@/features/forms/analytics/dashboard-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EXPORT_ROWS = 10_000;
const EXPORT_PAGE_SIZE = 100;

export async function GET(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "export_occurrences");
    const filters = parseDashboardFilters(request, context.workspaceId);
    const includePersonalData =
      request.nextUrl.searchParams.get("include_personal") === "true";

    if (includePersonalData) {
      assertAnalyticsContextPermission(context, "export_personal_targets");
    }

    const rows: OccurrenceListItem[] = [];
    let cursor = request.nextUrl.searchParams.get("cursor");

    while (rows.length < MAX_EXPORT_ROWS) {
      const page = await listOccurrences(context, filters, {
        cursor,
        pageSize: Math.min(EXPORT_PAGE_SIZE, MAX_EXPORT_ROWS - rows.length),
        includePersonalData,
      });
      rows.push(...page.items);

      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }

    return new Response(toCsv(rows, { includePersonalData }), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="ocorrencias.csv"',
      },
    });
  } catch (error) {
    if (error instanceof DashboardFilterError) {
      return dashboardFilterErrorResponse(error);
    }

    return taxonomyErrorResponse(error, "Falha ao exportar ocorrências.");
  }
}
