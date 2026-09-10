import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { refreshPaymentRequest } from "@/features/financial/payment-requests/service.server";
import { getInterBankingStatusProxyUrl } from "@/lib/integrations/inter/config.server";
import { safeInterPaymentError } from "@/lib/integrations/inter/payment-error";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "refresh-inter-payment-status",
  routeOrJob: "/api/financial/payment-requests/[id]/refresh",
}, async (request: NextRequest, context) => {
  const actor = await requireUser(request).catch((cause) => {
    throw new AppError({
      code: "INTER_PAYMENT_STATUS_AUTHENTICATION_REQUIRED",
      kind: "AUTHENTICATION",
      cause,
    });
  });
  if (!actor.isDefaultAdmin && (
    !actor.permissions.financial?.view
    || !actor.permissions.financial?.paymentRequests?.view
    || !actor.permissions.financial?.paymentRequests?.refresh
  )) {
    throw new AppError({
      code: "INTER_PAYMENT_STATUS_FORBIDDEN",
      kind: "AUTHORIZATION",
      safeMessage: "Sem permissão para consultar o banco.",
    });
  }
  const { id } = await context.params;
  const proxyUrl = getInterBankingStatusProxyUrl();
  if (proxyUrl) {
    const authorization = request.headers.get("authorization");
    if (!authorization) {
      throw new AppError({
        code: "INTER_PAYMENT_STATUS_AUTHENTICATION_REQUIRED",
        kind: "AUTHENTICATION",
      });
    }
    const upstream = await fetch(`${proxyUrl}/api/financial/payment-requests/${encodeURIComponent(id)}/refresh`, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    }).catch((cause) => {
      throw new AppError({
        code: "INTER_PAYMENT_STATUS_PROXY_UNAVAILABLE",
        kind: "TRANSIENT_EXTERNAL",
        safeMessage: "A consulta bancária remota está temporariamente indisponível.",
        cause,
      });
    });
    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": upstream.headers.get("content-type") || "application/json",
      },
    });
  }
  try {
    return NextResponse.json({
      request: await refreshPaymentRequest(id, {
        uid: actor.decoded.uid,
        email: actor.decoded.email,
        name: actor.userDoc.username,
      }),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    const safe = safeInterPaymentError(cause);
    throw new AppError({
      code: "INTER_PAYMENT_STATUS_REFRESH_FAILED",
      kind: "TRANSIENT_EXTERNAL",
      safeMessage: safe.safeMessage,
      cause,
    });
  }
});
