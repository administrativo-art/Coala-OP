import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { classifyCashWithdrawal, listWithdrawalClassifications } from "@/features/financial/cash-closures/withdrawal-classification.server";

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
  if (request.nextUrl.searchParams.size > 0) {
    throw new AppError({ code: "CASH_WITHDRAWAL_QUERY_UNSUPPORTED", kind: "VALIDATION", safeMessage: "A sangria cria uma nova despesa; a busca de despesas existentes está desativada." });
  }
  return response(await listWithdrawalClassifications(closureId, actor));
});

export const PATCH = withApiErrorHandling<Context>({ source: "api", operation: "classify-cash-withdrawal", routeOrJob: route }, async (request, context) => {
  const actor = await authenticate(request);
  const { closureId } = await context.params;
  return response(await classifyCashWithdrawal(closureId, await request.json().catch(() => null), actor));
});
