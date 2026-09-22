import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { queryStoneAnticipationReview } from "@/lib/integrations/stone/anticipation-review";
import { fetchStoneAgendaXml } from "@/lib/integrations/stone/agenda-transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

export const GET = withApiErrorHandling({ source: "api-financial", operation: "review-stone-anticipations",
  routeOrJob: "/api/financial/stone-anticipations" }, async (request: NextRequest) => {
  const context = await requireUser(request).catch(() => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION" });
  });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(110_000)]);
  const result = await queryStoneAnticipationReview({
    stoneCode: request.nextUrl.searchParams.get("stoneCode"),
    referenceDate: request.nextUrl.searchParams.get("referenceDate"),
  }, context, query => fetchStoneAgendaXml(query, { apiKey: process.env.STONE_CONCILIATION_API_KEY, signal }));
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
