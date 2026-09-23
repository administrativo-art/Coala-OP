import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { stoneAgendaQuerySchema } from "@/lib/integrations/stone/agenda-query";
import { readReceivablePeriodMapping } from "@/features/financial/receivables/mapping.server";
import { latestPublishedDate } from "@/features/financial/receivables/period-review";
import { readStonePortfolio, syncStonePortfolio } from "@/features/financial/receivables/portfolio-sync.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function authorize(request: NextRequest, stoneCode: string, referenceDate: string) {
  const context = await requireUser(request).catch(() => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION" });
  });
  if (!context.isDefaultAdmin) throw new AppError({ code: "STONE_PORTFOLIO_FORBIDDEN", kind: "AUTHORIZATION" });
  const result = await readStonePortfolio(stoneCode);
  const mapping = await readReceivablePeriodMapping({ kioskId: result.kioskId as string, stoneCode,
    from: referenceDate, through: referenceDate }, context.workspace_id);
  if (mapping.id !== result.mappingId || mapping.accountId !== result.accountId) {
    throw new AppError({ code: "STONE_PORTFOLIO_MAPPING_CHANGED", kind: "DATA_INTEGRITY" });
  }
  return result;
}

export const GET = withApiErrorHandling({ source: "api-financial", operation: "read-stone-portfolio",
  routeOrJob: "/api/financial/stone-portfolio" }, async (request: NextRequest) => {
  const stoneCode = stoneAgendaQuerySchema.shape.stoneCode.safeParse(request.nextUrl.searchParams.get("stoneCode"));
  if (!stoneCode.success) throw new AppError({ code: "STONE_PORTFOLIO_QUERY", kind: "VALIDATION" });
  const result = await authorize(request, stoneCode.data, latestPublishedDate(new Date()));
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});

export const POST = withApiErrorHandling({ source: "api-financial", operation: "sync-stone-portfolio-admin",
  routeOrJob: "/api/financial/stone-portfolio" }, async (request: NextRequest) => {
  const body = await request.text();
  if (body.length > 256) throw new AppError({ code: "STONE_PORTFOLIO_BODY_LIMIT", kind: "VALIDATION" });
  let input: unknown;
  try { input = JSON.parse(body); } catch { throw new AppError({ code: "STONE_PORTFOLIO_JSON", kind: "VALIDATION" }); }
  const stoneCode = stoneAgendaQuerySchema.shape.stoneCode.safeParse((input as { stoneCode?: unknown })?.stoneCode);
  if (!stoneCode.success) throw new AppError({ code: "STONE_PORTFOLIO_QUERY", kind: "VALIDATION" });
  await authorize(request, stoneCode.data, latestPublishedDate(new Date()));
  const result = await syncStonePortfolio(stoneCode.data);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
