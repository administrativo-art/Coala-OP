import { NextRequest, NextResponse } from "next/server";

import { submitPaymentRequest } from "@/features/financial/payment-requests/service.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "submit-payment-request",
  routeOrJob: "/api/financial/payment-requests/[id]/submit",
}, async (request: NextRequest, context) => {
  const actor = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "PAYMENT_SUBMISSION_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  if (!actor.isDefaultAdmin && (
    !actor.permissions.financial?.view
    || !actor.permissions.financial?.paymentRequests?.view
    || !actor.permissions.financial?.paymentRequests?.submit
  )) {
    throw new AppError({
      code: "PAYMENT_SUBMISSION_FORBIDDEN",
      kind: "AUTHORIZATION",
      safeMessage: "Sem permissão para enviar pagamentos ao banco.",
    });
  }
  const { id } = await context.params;
  try {
    return NextResponse.json({
      request: await submitPaymentRequest(id, {
        uid: actor.decoded.uid,
        email: actor.decoded.email,
        name: actor.userDoc.username,
      }),
    });
  } catch (cause) {
    throw new AppError({
      code: "PAYMENT_SUBMISSION_FAILED",
      kind: "CONFLICT",
      safeMessage: "Não foi possível confirmar o envio. Consulte o status atual antes de qualquer nova tentativa.",
      cause,
    });
  }
});
