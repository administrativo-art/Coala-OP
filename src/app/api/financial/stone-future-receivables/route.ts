import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { queryReceivablePeriod } from "@/features/financial/receivables/period-review";
import { readReceivablePeriodMapping } from "@/features/financial/receivables/mapping.server";
import { fetchStoneAgendaXml } from "@/lib/integrations/stone/agenda-transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
export const POST = withApiErrorHandling({ source: "api-financial", operation: "stone-period-review", routeOrJob: "/api/financial/stone-future-receivables" }, async (request: NextRequest) => {
  const context = await requireUser(request).catch(() => { throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION" }); });
  if (!context.isDefaultAdmin) throw new AppError({ code: "STONE_PERIOD_FORBIDDEN", kind: "AUTHORIZATION" });
  const body = await request.text();
  if (body.length > 2048) throw new AppError({ code: "STONE_PERIOD_BODY_TOO_LARGE", kind: "VALIDATION" });
  let input: unknown;
  try { input = JSON.parse(body); } catch { throw new AppError({ code: "STONE_PERIOD_JSON_INVALID", kind: "VALIDATION" }); }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(110_000)]);
  const result = await queryReceivablePeriod(input, context, {
    resolveMapping: readReceivablePeriodMapping,
    read: query => fetchStoneAgendaXml(query, { apiKey: process.env.STONE_CONCILIATION_API_KEY, signal }),
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
