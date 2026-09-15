import { NextRequest, NextResponse } from "next/server";

import { confirmedBankBalanceSchema } from "@/features/financial/cash-flow/opening-balance";
import { confirmBankAccountBalance, ConfirmedBankBalanceError } from "@/features/financial/cash-flow/opening-balance.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApiErrorHandling({
  source: "api-financial",
  operation: "confirm-bank-account-balance",
  routeOrJob: "/api/financial/bank-accounts/[accountId]/confirmed-balance",
}, async (request: NextRequest, routeContext: { params: Promise<{ accountId: string }> }) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const allowed = context.isDefaultAdmin || (
    context.permissions.financial?.view === true
    && context.permissions.financial?.settings?.manageBankAccounts === true
  );
  if (!allowed) throw new AppError({ code: "BANK_BALANCE_CONFIRMATION_FORBIDDEN", kind: "AUTHORIZATION" });
  const { accountId } = await routeContext.params;
  if (!accountId || accountId.includes("/") || accountId.length > 180) {
    throw new AppError({ code: "BANK_ACCOUNT_ID_INVALID", kind: "VALIDATION", safeMessage: "A conta informada é inválida." });
  }
  const body = await request.json().catch((cause) => {
    throw new AppError({ code: "BANK_BALANCE_BODY_INVALID", kind: "VALIDATION", safeMessage: "Envie uma confirmação de saldo válida.", cause });
  });
  const parsed = confirmedBankBalanceSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError({ code: "BANK_BALANCE_INVALID", kind: "VALIDATION", safeMessage: "Revise saldo, data, fonte e justificativa.", cause: parsed.error });
  }
  const confirmation = await confirmBankAccountBalance({
    workspaceId: context.workspace_id,
    accountId,
    balance: parsed.data,
    actor: {
      id: context.decoded.uid,
      name: context.userDoc.username?.trim() || context.decoded.name?.trim() || null,
      email: context.userDoc.email ?? context.decoded.email ?? null,
    },
  }).catch((cause) => {
    if (cause instanceof ConfirmedBankBalanceError) {
      throw new AppError({
        code: `BANK_BALANCE_${cause.code}`,
        kind: cause.code === "NOT_FOUND" ? "NOT_FOUND" : cause.code === "WORKSPACE_MISMATCH" ? "AUTHORIZATION" : "CONFLICT",
        safeMessage: cause.message,
        cause,
      });
    }
    throw cause;
  });
  return NextResponse.json({ confirmation }, { headers: { "Cache-Control": "private, no-store" } });
});
