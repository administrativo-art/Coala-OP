import { NextRequest, NextResponse } from "next/server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { verifyStonePortfolioSyncSecret } from "@/features/financial/receivables/portfolio-auth";
import { runAutomatedSalesReviews } from "@/features/financial/sales-reconciliation/review-automation.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withApiErrorHandling({
  source: "stone-conciliation",
  operation: "automate-pdv-stone-reviews",
  routeOrJob: "/api/jobs/stone-sales-review/reconcile",
}, async (request: NextRequest) => {
  if (!verifyStonePortfolioSyncSecret(request.headers.get("authorization"), process.env.STONE_PORTFOLIO_SYNC_SECRET)) {
    throw new AppError({ code: "SALES_REVIEW_AUTOMATION_UNAUTHORIZED", kind: "AUTHENTICATION" });
  }
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(275_000)]);
  try {
    return NextResponse.json(await runAutomatedSalesReviews({ signal }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (signal.aborted) throw new AppError({ code: "SALES_REVIEW_AUTOMATION_TIMEOUT", kind: "TRANSIENT_EXTERNAL",
      safeMessage: "A rotina de conciliação excedeu o tempo desta execução e continuará no próximo ciclo." });
    throw error;
  } finally { controller.abort(); }
});
