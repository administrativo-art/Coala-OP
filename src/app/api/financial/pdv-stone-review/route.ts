import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { queryDailySales } from "@/features/financial/sales-reconciliation/query";
import { readSalesReviewBinding } from "@/features/financial/sales-reconciliation/mapping.server";
import { fetchPdvCouponsReadOnly } from "@/lib/integrations/pdv-coupon-read";
import { fetchStoneAgendaXml } from "@/lib/integrations/stone/agenda-transport";
import { readSalesReviewBody } from "@/features/financial/sales-reconciliation/request-body";
import { readPixSalesSource } from "@/features/financial/sales-reconciliation/pix-source.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
export const POST = withApiErrorHandling({ source: "api-financial", operation: "pdv-stone-review", routeOrJob: "/api/financial/pdv-stone-review" }, async (request: NextRequest) => {
  const context = await requireUser(request).catch(() => { throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION" }); });
  if (!context.isDefaultAdmin) throw new AppError({ code: "SALES_REVIEW_FORBIDDEN", kind: "AUTHORIZATION" });
  const input = await readSalesReviewBody(request);
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(110_000), controller.signal]);
  try {
    const result = await queryDailySales(input, context, {
      signal, resolveBinding: readSalesReviewBinding,
      readPix: readPixSalesSource,
      readPdv: query => fetchPdvCouponsReadOnly(query, { signal, credentials: {
        company: process.env.PDVLEGAL_COD_EMPRESA, token: process.env.PDVLEGAL_TOKEN,
        username: process.env.PDVLEGAL_USERNAME, password: process.env.PDVLEGAL_PASSWORD,
      } }),
      readStone: query => fetchStoneAgendaXml(query, { apiKey: process.env.STONE_CONCILIATION_API_KEY, signal }),
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (signal.aborted) throw new AppError({ code: "SALES_REVIEW_CANCELLED", kind: "TRANSIENT_EXTERNAL",
      safeMessage: "A consulta foi cancelada ou excedeu o prazo. Tente novamente." });
    throw error;
  } finally { controller.abort(); }
});
