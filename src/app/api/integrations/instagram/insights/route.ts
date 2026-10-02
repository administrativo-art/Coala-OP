import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireInstagramSchedulerAccess } from "@/features/instagram-scheduler/access.server";
import {
  aggregateBusinessSuiteHistory,
  instagramInsightsPeriodDays,
  instagramInsightsYearStartIso,
} from "@/features/instagram-scheduler/business-suite-insights";
import type { InstagramInsightsPeriod } from "@/features/instagram-scheduler/contracts";
import { fetchInstagramInsights } from "@/features/instagram-scheduler/meta-graph.server";
import { fetchInstagramInsightsHistory } from "@/features/instagram-scheduler/instagram-insights-history.server";
import { fetchPublicBioAnalytics } from "@/features/instagram-scheduler/public-bio-analytics.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const periodSchema = z.enum(["7", "30", "90", "year"]).transform<InstagramInsightsPeriod>((value) => (
  value === "year" ? value : Number(value) as 7 | 30 | 90
));

export const GET = withApiErrorHandling(
  {
    source: "api",
    operation: "getInstagramInsights",
    routeOrJob: "/api/integrations/instagram/insights",
  },
  async (request: NextRequest) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);
    const parsedPeriod = periodSchema.safeParse(
      request.nextUrl.searchParams.get("period")
      ?? request.nextUrl.searchParams.get("days")
      ?? "30",
    );
    if (!parsedPeriod.success) {
      throw new AppError({
        code: "INSTAGRAM_INSIGHTS_INVALID_RANGE",
        kind: "VALIDATION",
        safeMessage: "Escolha 7, 30, 90 dias ou o ano atual.",
      });
    }

    const period = parsedPeriod.data;
    const requestedDays = instagramInsightsPeriodDays(period);
    const liveDays = period === "year" ? 90 : period;

    const [instagram, history, bio] = await Promise.all([
      fetchInstagramInsights(liveDays),
      fetchInstagramInsightsHistory(requestedDays),
      fetchPublicBioAnalytics(requestedDays),
    ]);

    const activeStoryIds = new Set(instagram.activeStories.map((story) => story.id));
    const businessSuiteTotals = aggregateBusinessSuiteHistory(history.daily);
    const yearSelected = period === "year";
    const totals = yearSelected ? {
      views: businessSuiteTotals.views,
      reach: null,
      accountsEngaged: null,
      totalInteractions: businessSuiteTotals.contentInteractions,
      likes: null,
      comments: null,
      shares: null,
      saves: null,
      replies: null,
      reposts: null,
      follows: businessSuiteTotals.followers,
      unfollows: null,
    } : instagram.totals;
    const reachSeries = yearSelected
      ? history.daily.flatMap((day) => day.businessSuite?.reach === null || day.businessSuite?.reach === undefined
        ? []
        : [{ date: day.date, value: day.businessSuite.reach }])
      : instagram.reachSeries;

    return NextResponse.json({
      ...instagram,
      range: {
        period,
        days: requestedDays,
        since: yearSelected ? instagramInsightsYearStartIso() : instagram.range.since,
        until: instagram.range.until,
      },
      totals,
      reachSeries,
      businessSuiteTotals,
      history: {
        ...history,
        stories: history.stories.filter((story) => !activeStoryIds.has(story.id)),
      },
      bio,
      notices: [
        "A Meta pode levar até 48 horas para consolidar algumas métricas; ausências são exibidas como indisponíveis, não como zero.",
        "O coletor próprio roda a cada 6 horas, reapura os últimos 3 dias e preserva Stories antes que desapareçam, além de marcos de 48 horas, 7 dias e 30 dias de Feed/Reels.",
        "Cliques na bio medidos aqui vêm do site público, sem cookies ou identificação de visitantes.",
        ...(period === 90 ? [
          "A Meta limita cada consulta a menos de 30 dias. No período de 90 dias, alcance e contas engajadas são somados em três janelas e podem repetir a mesma conta entre janelas.",
        ] : []),
        ...(yearSelected ? [
          "O período anual usa os CSVs oficiais exportados do Meta Business Suite para visualizações, interações, visitas, cliques e seguidores. O alcance único do ano não é calculado pela soma diária e permanece indisponível.",
          "Conteúdos individuais continuam limitados às publicações recentes disponíveis pela API da Meta.",
        ] : []),
      ],
    }, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  },
);
