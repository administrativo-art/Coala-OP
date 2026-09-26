import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { expenseBoletoPaymentSchema } from "@/features/financial/payment-requests/expense-boleto";
import { prepareExpenseBoleto } from "@/features/financial/payment-requests/expense-boleto.server";
export const runtime = "nodejs";
export const POST = withApiErrorHandling<{ params: Promise<{ expenseId: string }> }>({ source: "api-financial", operation: "prepare-expense-boleto", routeOrJob: "/api/financial/expenses/[expenseId]/boleto/payment" }, async (request: NextRequest, context) => {
  const actor = await requireUser(request).catch(cause => { throw new AppError({ code: "BOLETO_AUTH_REQUIRED", kind: "AUTHENTICATION", cause }); });
  const permission = actor.permissions.financial;
  if (!actor.isDefaultAdmin && (!permission?.view || !permission.expenses?.view || !permission.expenses?.edit || !permission.paymentRequests?.view || !permission.paymentRequests?.create)) throw new AppError({ code: "BOLETO_PAYMENT_FORBIDDEN", kind: "AUTHORIZATION" });
  const expenseId = z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/).parse((await context.params).expenseId);
  const input = expenseBoletoPaymentSchema.safeParse(await request.json());
  if (!input.success) throw new AppError({ code: "BOLETO_PAYMENT_INVALID", kind: "VALIDATION", safeMessage: "Confirme a data solicitada para pagamento." });
  const result = await prepareExpenseBoleto(expenseId, actor.workspace_id, input.data.scheduledFor, { uid: actor.decoded.uid, email: actor.decoded.email });
  return NextResponse.json({ request: result }, { headers: { "Cache-Control": "private, no-store" } });
});
