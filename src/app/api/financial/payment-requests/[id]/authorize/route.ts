import { NextRequest, NextResponse } from "next/server";

import { overdueBarcodeSettlementRevisionSchema } from "@/features/financial/payment-requests/overdue-settlement";
import { authorizePaymentRequest, reviseAndAuthorizeOverdueBarcodePaymentRequest } from "@/features/financial/payment-requests/service.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "authorize-payment-request",
  routeOrJob: "/api/financial/payment-requests/[id]/authorize",
}, async (request: NextRequest, context) => {
  const actor = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "PAYMENT_AUTHORIZATION_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  if (!actor.isDefaultAdmin && (
    !actor.permissions.financial?.view
    || !actor.permissions.financial?.paymentRequests?.view
    || !actor.permissions.financial?.paymentRequests?.authorize
  )) {
    throw new AppError({
      code: "PAYMENT_AUTHORIZATION_FORBIDDEN",
      kind: "AUTHORIZATION",
      safeMessage: "Sem permissão para autorizar pagamentos.",
    });
  }
  const { id } = await context.params;
  const rawBody = await request.text();
  const hasBody = Boolean(rawBody.trim());
  let body: unknown;
  if (hasBody) {
    try {
      body = JSON.parse(rawBody);
    } catch (cause) {
      throw new AppError({
        code: "PAYMENT_AUTHORIZATION_INVALID_JSON",
        kind: "VALIDATION",
        safeMessage: "Os dados da autorização não são válidos.",
        cause,
      });
    }
  }
  const paymentActor = { uid: actor.decoded.uid, email: actor.decoded.email, name: actor.userDoc.username };
  if (!hasBody) {
    try {
      return NextResponse.json({ request: await authorizePaymentRequest(id, paymentActor) });
    } catch (cause) {
      throw new AppError({
        code: "PAYMENT_AUTHORIZATION_CONFLICT",
        kind: "CONFLICT",
        safeMessage: "A solicitação mudou e não pode ser autorizada. Confira os dados atuais.",
        cause,
      });
    }
  }
  const parsed = overdueBarcodeSettlementRevisionSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError({
      code: "OVERDUE_SETTLEMENT_AUTHORIZATION_INVALID",
      kind: "VALIDATION",
      safeMessage: "A confirmação documental do boleto vencido não é válida.",
      cause: parsed.error,
    });
  }
  try {
    return NextResponse.json({ request: await reviseAndAuthorizeOverdueBarcodePaymentRequest(id, parsed.data, paymentActor) });
  } catch (cause) {
    throw new AppError({
      code: "OVERDUE_SETTLEMENT_AUTHORIZATION_CONFLICT",
      kind: "CONFLICT",
      safeMessage: "O boleto, a despesa ou o histórico bancário mudou. Confira antes de autorizar novamente.",
      cause,
    });
  }
});
