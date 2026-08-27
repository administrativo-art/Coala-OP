import { type NextRequest, NextResponse } from "next/server";

import {
  DashboardFilterError,
  dashboardFilterErrorResponse,
  parseDashboardFilters,
} from "@/features/forms/analytics/dashboard-api";
import {
  getBrandRanking,
  getDashboardCards,
  getDashboardCardsFromAggregates,
  getExtendedMetrics,
  getRecurrenceByTarget,
  getSimpleRanking,
  shouldPreferAggregates,
} from "@/features/forms/analytics/dashboard-service";
import {
  assertAnalyticsContextPermission,
  requireAnalyticsContext,
  taxonomyErrorResponse,
} from "@/features/forms/analytics/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireAnalyticsContext(request, "view");
    const filters = parseDashboardFilters(request, context.workspaceId);
    const search = request.nextUrl.searchParams;

    const groupByParam = search.get("group_by");
    const groupBy =
      groupByParam === "criterion" || groupByParam === "target"
        ? groupByParam
        : null;
    const includePersonalData = search.get("include_personal") === "true";
    if (includePersonalData) {
      assertAnalyticsContextPermission(context, "view_personal_targets");
    }

    const wantExtended = search.get("extended") === "true";
    const wantRecurrence = search.get("recurrence") === "true";
    const wantBrand = search.get("brand_ranking") === "true";
    // source=auto (padrão) usa agregados só em períodos longos e com dados;
    // source=live força count() ao vivo; source=daily força agregados.
    const source = search.get("source") ?? "auto";

    const [cards, cardsSource] = await resolveCards(context, filters, source);

    // Métricas avançadas dependem de índices próprios; se algum ainda não existir,
    // degradam para null em vez de derrubar o painel inteiro.
    const [ranking, extended, recurrence, brandRanking] = await Promise.all([
      groupBy
        ? nullOnError(
            getSimpleRanking(context, filters, groupBy, { includePersonalData })
          )
        : Promise.resolve(null),
      wantExtended
        ? nullOnError(getExtendedMetrics(context, filters))
        : Promise.resolve(null),
      wantRecurrence
        ? nullOnError(
            getRecurrenceByTarget(context, filters, { includePersonalData })
          )
        : Promise.resolve(null),
      wantBrand
        ? nullOnError(getBrandRanking(context, filters))
        : Promise.resolve(null),
    ]);

    return NextResponse.json({
      cards,
      cards_source: cardsSource,
      ranking,
      extended,
      recurrence,
      brand_ranking: brandRanking,
    });
  } catch (error) {
    if (error instanceof DashboardFilterError) {
      return dashboardFilterErrorResponse(error);
    }

    return taxonomyErrorResponse(error, "Falha ao carregar resumo.");
  }
}

async function nullOnError<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

async function resolveCards(
  context: Parameters<typeof getDashboardCards>[0],
  filters: Parameters<typeof getDashboardCards>[1],
  source: string
): Promise<[Awaited<ReturnType<typeof getDashboardCards>>, "live" | "daily"]> {
  const preferAggregates =
    source === "daily" ||
    (source === "auto" && shouldPreferAggregates(filters.from, filters.to));

  if (preferAggregates) {
    const fromAggregates = await getDashboardCardsFromAggregates(context, filters);
    if (fromAggregates) {
      const { avg_resolution_time_minutes: _ignored, ...cards } = fromAggregates;
      return [cards, "daily"];
    }
  }

  return [await getDashboardCards(context, filters), "live"];
}
