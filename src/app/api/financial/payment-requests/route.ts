import { NextResponse, type NextRequest } from "next/server";

import { PaymentRequestRuleError } from "@/features/financial/payment-requests/business-error";
import { listPaymentRequests } from "@/features/financial/payment-requests/repository.server";
import { createPaymentRequestSchema, type CreatePaymentRequestInput } from "@/features/financial/payment-requests/schemas";
import { createPaymentRequest } from "@/features/financial/payment-requests/service.server";
import type { ServerUserContext } from "@/lib/auth-server";
import { getInterBankingStatusProxyUrl, isInterConfigured } from "@/lib/integrations/inter/config.server";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { parseRouteBody, requireRouteUser } from "@/lib/security/route-access.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };

/** Origens que só os fluxos próprios podem criar. */
const PROTECTED_SOURCES = new Set(["aso", "termination", "vacation", "expense_complement", "consultancy_provision", "document_receipt"]);

const listContract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.payment-requests.list",
  version: 1,
  surface: { method: "GET", path: "/api/financial/payment-requests" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "financial.payment-requests.view" },
  resourceScope: { kind: "none" },
  input: { kind: "none" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const createContract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.payment-requests.create",
  version: 1,
  surface: { method: "POST", path: "/api/financial/payment-requests" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "financial.payment-requests.create" },
  resourceScope: { kind: "none" },
  input: { kind: "schema", schema: "financial.payment-requests.create-input", unknownFields: "strip" },
  effects: { mode: "write", audit: "none" },
  errorExposure: "sanitized",
});

function assertPermission(actor: ServerUserContext, action: "view" | "create") {
  if (!actor.isDefaultAdmin && (!actor.permissions.financial?.view || !actor.permissions.financial?.paymentRequests?.[action])) {
    throw new AppError({
      code: "PAYMENT_REQUEST_FORBIDDEN",
      kind: "AUTHORIZATION",
      safeMessage: action === "view" ? "Sem permissão para visualizar solicitações de pagamento." : "Sem permissão para criar solicitações de pagamento.",
    });
  }
}

export const GET = secureRoute({
  contract: listContract,
  enforcer: createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext>(listContract, {
    authenticate: ({ request }) => requireRouteUser(request, "PAYMENT_REQUEST"),
    authorize: ({ actor }) => assertPermission(actor, "view"),
  }),
}, async () => {
  const submissionAvailable = isInterConfigured();
  return NextResponse.json({
    requests: await listPaymentRequests(),
    submissionAvailable,
    submissionBaseUrl: submissionAvailable ? null : getInterBankingStatusProxyUrl(),
  }, { headers: { "Cache-Control": "private, no-store" } });
});

export const POST = secureRoute({
  contract: createContract,
  enforcer: createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, CreatePaymentRequestInput>(createContract, {
    // A permissão é conferida junto da identidade para quem não a tem não receber retorno da validação.
    authenticate: async ({ request }) => {
      const actor = await requireRouteUser(request, "PAYMENT_REQUEST");
      assertPermission(actor, "create");
      return actor;
    },
    parseInput: ({ request }) => parseRouteBody(request, createPaymentRequestSchema, "PAYMENT_REQUEST"),
    authorize: ({ actor, input }) => {
      assertPermission(actor, "create");
      if (PROTECTED_SOURCES.has(input.sourceType)) {
        throw new AppError({ code: "PAYMENT_REQUEST_PROTECTED_SOURCE", kind: "AUTHORIZATION", safeMessage: "Este pagamento só pode ser criado pelo fluxo protegido." });
      }
    },
  }),
}, async ({ security: { actor, input } }) => {
  const created = await createPaymentRequest(input, { uid: actor.decoded.uid, email: actor.decoded.email, name: actor.userDoc.username })
    .catch((cause: unknown) => {
      if (!(cause instanceof PaymentRequestRuleError)) throw cause;
      throw new AppError({ code: "PAYMENT_REQUEST_REJECTED", kind: "VALIDATION", safeMessage: cause.message, cause });
    });
  return NextResponse.json({ request: created }, { status: 201 });
});
