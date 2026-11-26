import { NextResponse, type NextRequest } from "next/server";

import { submitPaymentRequest } from "@/features/financial/payment-requests/service.server";
import type { ServerUserContext } from "@/lib/auth-server";
import { isInterConfigured } from "@/lib/integrations/inter/config.server";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { requireRouteUser } from "@/lib/security/route-access.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.payment-requests.submit",
  version: 1,
  surface: { method: "POST", path: "/api/financial/payment-requests/[id]/submit" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "financial.payment-requests.submit" },
  resourceScope: { kind: "none" },
  input: { kind: "none" },
  effects: { mode: "external", audit: "none" },
  errorExposure: "sanitized",
});

export const POST = secureRoute({
  contract,
  enforcer: createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext>(contract, {
    authenticate: ({ request }) => requireRouteUser(request, "PAYMENT_SUBMISSION"),
    authorize: ({ actor }) => {
      if (!actor.isDefaultAdmin && (
        !actor.permissions.financial?.view
        || !actor.permissions.financial?.paymentRequests?.view
        || !actor.permissions.financial?.paymentRequests?.submit
      )) {
        throw new AppError({ code: "PAYMENT_SUBMISSION_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para enviar pagamentos ao banco." });
      }
    },
  }),
}, async ({ routeContext, security: { actor } }) => {
  if (!isInterConfigured()) {
    throw new AppError({
      code: "PAYMENT_SUBMISSION_ENVIRONMENT_UNAVAILABLE",
      kind: "CONFLICT",
      safeMessage: "Por segurança, o envio ao Banco Inter deve ser concluído no ambiente publicado.",
    });
  }
  const { id } = await routeContext.params;
  try {
    return NextResponse.json({
      request: await submitPaymentRequest(id, { uid: actor.decoded.uid, email: actor.decoded.email, name: actor.userDoc.username }),
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
