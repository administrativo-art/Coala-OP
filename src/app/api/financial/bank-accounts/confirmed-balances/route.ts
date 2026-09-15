import { NextRequest, NextResponse } from "next/server";

import { ConfirmedBankBalanceError, listConfirmedBankBalances } from "@/features/financial/cash-flow/opening-balance.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "list-confirmed-bank-balances",
  routeOrJob: "/api/financial/bank-accounts/confirmed-balances",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const allowed = context.isDefaultAdmin || (
    context.permissions.financial?.view === true
    && (
      context.permissions.financial?.cashFlow?.view === true
      || context.permissions.financial?.settings?.manageBankAccounts === true
    )
  );
  if (!allowed) throw new AppError({ code: "BANK_BALANCES_FORBIDDEN", kind: "AUTHORIZATION" });
  const result = await listConfirmedBankBalances(context.workspace_id).catch((cause) => {
    if (cause instanceof ConfirmedBankBalanceError) {
      throw new AppError({ code: `BANK_BALANCES_${cause.code}`, kind: "CONFLICT", safeMessage: cause.message, cause });
    }
    throw cause;
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
