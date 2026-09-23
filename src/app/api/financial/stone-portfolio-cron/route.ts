import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { syncEnabledStonePortfolios } from "@/features/financial/receivables/portfolio-sync.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: NextRequest) {
  const configured = process.env.STONE_PORTFOLIO_SYNC_SECRET;
  const received = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)?.[1];
  if (!configured || !received) return false;
  return timingSafeEqual(createHash("sha256").update(configured).digest(),
    createHash("sha256").update(received).digest());
}

export const POST = withApiErrorHandling({ source: "stone-conciliation", operation: "sync-stone-portfolios",
  routeOrJob: "/api/financial/stone-portfolio-cron" }, async (request: NextRequest) => {
  if (!authorized(request)) throw new AppError({ code: "STONE_PORTFOLIO_CRON_UNAUTHORIZED", kind: "AUTHENTICATION" });
  const results = await syncEnabledStonePortfolios();
  return NextResponse.json({ processed: results.length, asOf: results.map(item => item.asOf) },
    { headers: { "Cache-Control": "no-store" } });
});
