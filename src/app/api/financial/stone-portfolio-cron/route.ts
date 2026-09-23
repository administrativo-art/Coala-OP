import { NextRequest, NextResponse } from "next/server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { syncEnabledStonePortfolios } from "@/features/financial/receivables/portfolio-sync.server";
import { verifyStonePortfolioSyncSecret } from "@/features/financial/receivables/portfolio-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withApiErrorHandling({ source: "stone-conciliation", operation: "sync-stone-portfolios",
  routeOrJob: "/api/financial/stone-portfolio-cron" }, async (request: NextRequest) => {
  if (!verifyStonePortfolioSyncSecret(request.headers.get("authorization"), process.env.STONE_PORTFOLIO_SYNC_SECRET)) {
    throw new AppError({ code: "STONE_PORTFOLIO_CRON_UNAUTHORIZED", kind: "AUTHENTICATION" });
  }
  const results = await syncEnabledStonePortfolios();
  return NextResponse.json({ processed: results.length, asOf: results.map(item => item.asOf) },
    { headers: { "Cache-Control": "no-store" } });
});
