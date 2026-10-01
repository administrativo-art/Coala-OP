import { NextRequest, NextResponse } from "next/server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { verifyStonePortfolioSyncSecret } from "@/features/financial/receivables/portfolio-auth";
import { requestMissingStonePixFiles } from "@/features/financial/sales-reconciliation/pix-request.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withApiErrorHandling({
  source: "stone-conciliation",
  operation: "request-stone-pix-files",
  routeOrJob: "/api/jobs/stone-pix/request",
}, async (request: NextRequest) => {
  if (!verifyStonePortfolioSyncSecret(
    request.headers.get("authorization"),
    process.env.STONE_PORTFOLIO_SYNC_SECRET,
  )) {
    throw new AppError({ code: "STONE_PIX_SYNC_UNAUTHORIZED", kind: "AUTHENTICATION" });
  }
  const result = await requestMissingStonePixFiles();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
});
