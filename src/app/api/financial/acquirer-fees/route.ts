import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { readSalesReviewBody } from "@/features/financial/sales-reconciliation/request-body";
import { executeFeeAction, listFeeCandidates, listFeeRecords } from "@/features/financial/acquirer-fees/repository.server";
import { feeDependencies } from "@/features/financial/acquirer-fees/source.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
const route = "/api/financial/acquirer-fees";
async function auth(request: NextRequest) {
  return requireUser(request).catch(cause => { throw new AppError({ code: "ACQUIRER_FEE_AUTH_REQUIRED", kind: "AUTHENTICATION", cause }); });
}
const json = (value: unknown) => NextResponse.json(value, { headers: { "Cache-Control": "private, no-store" } });
export const POST = withApiErrorHandling({ source: "api-financial", operation: "acquirer-fees", routeOrJob: route }, async (request: NextRequest) => {
  const context = await auth(request), body = await readSalesReviewBody(request);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(110_000)]);
  try { return json(await executeFeeAction(body, context, feeDependencies(signal))); }
  catch (error) {
    if (signal.aborted) throw new AppError({ code: "ACQUIRER_FEE_TIMEOUT", kind: "TRANSIENT_EXTERNAL", safeMessage: "A consulta excedeu o prazo. Recarregue o histórico antes de tentar novamente." });
    throw error;
  }
});
export const GET = withApiErrorHandling({ source: "api-financial", operation: "acquirer-fees-history", routeOrJob: route }, async (request: NextRequest) => {
  const context = await auth(request), search = request.nextUrl.searchParams;
  const input = Object.fromEntries(["kioskId", "mappingId", "stoneCode", "referenceDate", "source"].map(key => [key, search.get(key)]));
  const center = search.get("resultCenterId");
  return json(center ? await listFeeCandidates(input, center, search.get("cursor") || undefined, context) : await listFeeRecords(input, context));
});
