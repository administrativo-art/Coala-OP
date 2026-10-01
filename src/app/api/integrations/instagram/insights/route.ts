import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireInstagramSchedulerAccess } from "@/features/instagram-scheduler/access.server";
import { fetchInstagramInsights } from "@/features/instagram-scheduler/meta-graph.server";
import { fetchInstagramInsightsHistory } from "@/features/instagram-scheduler/instagram-insights-history.server";
import { fetchPublicBioAnalytics } from "@/features/instagram-scheduler/public-bio-analytics.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const daysSchema = z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)]));

export const GET = withApiErrorHandling(
  {
    source: "api",
    operation: "getInstagramInsights",
    routeOrJob: "/api/integrations/instagram/insights",
  },
  async (request: NextRequest) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);
    const parsedDays = daysSchema.safeParse(request.nextUrl.searchParams.get("days") ?? "30");
    if (!parsedDays.success) {
      throw new AppError({
        code: "INSTAGRAM_INSIGHTS_INVALID_RANGE",
        kind: "VALIDATION",
        safeMessage: "Escolha um período de 7, 30 ou 90 dias.",
      });
    }

    const [instagram, history, bio] = await Promise.all([
      fetchInstagramInsights(parsedDays.data),
      fetchInstagramInsightsHistory(parsedDays.data),
      fetchPublicBioAnalytics(parsedDays.data),
    ]);

    const activeStoryIds = new Set(instagram.activeStories.map((story) => story.id));

    return NextResponse.json({
      ...instagram,
      history: {
        ...history,
        stories: history.stories.filter((story) => !activeStoryIds.has(story.id)),
      },
      bio,
      notices: [
        "A Meta pode levar até 48 horas para consolidar algumas métricas; ausências são exibidas como indisponíveis, não como zero.",
        "O coletor próprio roda a cada 6 horas, reapura os últimos 3 dias e preserva Stories antes que desapareçam, além de marcos de 48 horas, 7 dias e 30 dias de Feed/Reels.",
        "Cliques na bio medidos aqui vêm do site público, sem cookies ou identificação de visitantes.",
        ...(parsedDays.data === 90 ? [
          "A Meta limita cada consulta a menos de 30 dias. No período de 90 dias, alcance e contas engajadas são somados em três janelas e podem repetir a mesma conta entre janelas.",
        ] : []),
      ],
    }, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  },
);
