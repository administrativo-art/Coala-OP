import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  cancelAndReplaceExpenseBoletoPaymentRequest,
  PaymentRequestCancellationError,
} from "@/features/financial/payment-requests/service.server";
import { getPaymentRequest } from "@/features/financial/payment-requests/repository.server";
import type { BankPaymentRequest } from "@/features/financial/payment-requests/types";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { safeInterPaymentError } from "@/lib/integrations/inter/payment-error";
import { AppError } from "@/lib/observability";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type Input = { scheduledFor: string; confirmed: true };
type Resource = BankPaymentRequest;

const inputSchema = z.object({
  scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }),
  confirmed: z.literal(true),
}).strict();

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.payment-request.cancel-and-replace",
  version: 1,
  surface: { method: "POST", path: "/api/financial/payment-requests/[id]/cancel-and-replace" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "financial.payment-requests.submit" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.payment-request.cancel-and-replace", unknownFields: "reject" },
  effects: { mode: "external", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const enforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, Input, Resource>(contract, {
  authenticate: ({ request }) => requireUser(request).catch((cause) => {
    throw new AppError({ code: "PAYMENT_CANCELLATION_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  }),
  parseInput: async ({ request }) => {
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({
        code: "PAYMENT_CANCELLATION_INPUT_INVALID",
        kind: "VALIDATION",
        safeMessage: "Confirme uma nova data de pagamento válida.",
        cause: parsed.error,
      });
    }
    return parsed.data;
  },
  loadResource: async ({ actor, routeContext }) => {
    const { id } = await routeContext.params;
    if (!id || id.length > 250) throw new AppError({ code: "PAYMENT_CANCELLATION_NOT_FOUND", kind: "NOT_FOUND" });
    const payment = await getPaymentRequest(id).catch(() => null);
    if (!payment || payment.workspaceId !== actor.workspace_id) {
      throw new AppError({ code: "PAYMENT_CANCELLATION_NOT_FOUND", kind: "NOT_FOUND" });
    }
    return payment;
  },
  authorize: ({ actor }) => {
    if (!actor.isDefaultAdmin && (
      !actor.permissions.financial?.view
      || !actor.permissions.financial?.paymentRequests?.view
      || !actor.permissions.financial?.paymentRequests?.create
      || !actor.permissions.financial?.paymentRequests?.submit
    )) {
      throw new AppError({
        code: "PAYMENT_CANCELLATION_FORBIDDEN",
        kind: "AUTHORIZATION",
        safeMessage: "Sem permissão para cancelar e reenviar pagamentos bancários.",
      });
    }
  },
  assertScope: ({ actor, resource }) => {
    if (resource.workspaceId !== actor.workspace_id) {
      throw new AppError({ code: "PAYMENT_CANCELLATION_NOT_FOUND", kind: "NOT_FOUND" });
    }
  },
});

export const POST = secureRoute({
  contract,
  enforcer,
  observability: { source: "api-financial", operation: "cancel-and-replace-inter-barcode-payment" },
}, async ({ security }) => {
  try {
    const request = await cancelAndReplaceExpenseBoletoPaymentRequest(
      security.resource.id,
      security.input.scheduledFor,
      {
        uid: security.actor.decoded.uid,
        email: security.actor.decoded.email,
        name: security.actor.userDoc.username,
      },
    );
    return NextResponse.json({ request }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    if (cause instanceof PaymentRequestCancellationError) {
      throw new AppError({
        code: "PAYMENT_CANCELLATION_CONFLICT",
        kind: "CONFLICT",
        safeMessage: cause.message,
        cause,
      });
    }
    const safe = safeInterPaymentError(cause);
    throw new AppError({
      code: "PAYMENT_CANCELLATION_BANK_REJECTED",
      kind: "TRANSIENT_EXTERNAL",
      safeMessage: safe.safeMessage,
      cause,
    });
  }
});
