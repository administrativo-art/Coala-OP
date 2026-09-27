import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { classifyCashWithdrawal, listWithdrawalClassifications, listWithdrawalExpenseCandidates } from "@/features/financial/cash-closures/withdrawal-classification.server";

type Context = { params: Promise<{ closureId: string }> };
const route = "/api/financial/cash-closures/[closureId]/withdrawals";
async function authenticate(request: NextRequest) {
  return requireUser(request).catch(cause => {
    throw new AppError({ code: "CASH_WITHDRAWAL_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
  });
}
const response = (data: unknown) => NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });

export const GET = withApiErrorHandling<Context>({ source: "api", operation: "list-cash-withdrawals", routeOrJob: route }, async (request, context) => {
  const actor = await authenticate(request);
  const { closureId } = await context.params;
  const sourceId = request.nextUrl.searchParams.get("sourceId");
  const centerId = request.nextUrl.searchParams.get("resultCenterId");
  if (sourceId || centerId) {
    if (!sourceId || !centerId) throw new AppError({ code: "CASH_WITHDRAWAL_QUERY_INVALID", kind: "VALIDATION", safeMessage: "Informe sangria e centro de resultado juntos." });
    return response(await listWithdrawalExpenseCandidates(closureId, sourceId, centerId, request.nextUrl.searchParams.get("cursor") || undefined, actor));
  }
  return response(await listWithdrawalClassifications(closureId, actor));
});

export const PATCH = withApiErrorHandling<Context>({ source: "api", operation: "classify-cash-withdrawal", routeOrJob: route }, async (request, context) => {
  const actor = await authenticate(request);
  const { closureId } = await context.params;
  return response(await classifyCashWithdrawal(closureId, await request.json().catch(() => null), actor));
});
