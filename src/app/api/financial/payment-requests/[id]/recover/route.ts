import { NextResponse, type NextRequest } from "next/server";

import { findPaymentRequestBySource, findPaymentRequestBySourceAnyWorkspace, getPaymentRequest, paymentRequestRef } from "@/features/financial/payment-requests/repository.server";
import { createCorrectedInboxBarcodePaymentRequest, PaymentRequestRecoveryError } from "@/features/financial/payment-requests/service.server";
import type { BankPaymentRequest } from "@/features/financial/payment-requests/types";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { requireUser } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type Actor = Awaited<ReturnType<typeof requireUser>>;
type Resource = { id: string; payment: BankPaymentRequest };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.payment-request.recover",
  version: 1,
  surface: { method: "POST", path: "/api/financial/payment-requests/[id]/recover" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "financial.payment-requests.create" },
  resourceScope: { kind: "workspace" },
  input: { kind: "none" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, Actor, { id: string }, Resource>({
  id: "financial-payment-request-recover-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "PAYMENT_RECOVERY_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    if (!actor.isDefaultAdmin && (
      !actor.permissions.financial?.view
      || !actor.permissions.financial?.inbox?.view
      || (!actor.permissions.financial?.inbox?.analyze && !actor.permissions.financial?.inbox?.link)
      || !actor.permissions.financial?.paymentRequests?.view
      || !actor.permissions.financial?.paymentRequests?.create
    )) {
      throw new AppError({
        code: "PAYMENT_RECOVERY_FORBIDDEN",
        kind: "AUTHORIZATION",
        safeMessage: "Sem permissão para revisar e recriar esta solicitação.",
      });
    }
    const { id } = await routeContext.params;
    if (!id || id.length > 250) {
      throw new AppError({ code: "PAYMENT_RECOVERY_ID_INVALID", kind: "VALIDATION", safeMessage: "Solicitação inválida." });
    }
    // Solicitações antigas de cobranças podem ter sido criadas com um ID
    // diferente do contrato atual (`inbox_<mensagem>`). Resolva pela origem
    // antes de rejeitar, mantendo a validação de ambiente abaixo.
    let payment = await getPaymentRequest(id).catch(() => null);
    if ((!payment || payment.workspaceId !== actor.workspace_id) && id.startsWith("inbox_")) {
      const sourceId = id.slice("inbox_".length);
      payment = await findPaymentRequestBySource("financial_inbox", sourceId, actor.workspace_id);
      if (!payment) {
        const legacy = await findPaymentRequestBySourceAnyWorkspace("financial_inbox", sourceId);
        if (legacy && !legacy.workspaceId) {
          const message = await financialDbAdmin.collection("financialInboxMessages").doc(sourceId).get();
          if (message.exists && message.get("workspaceId") === actor.workspace_id) {
            const updatedAt = new Date().toISOString();
            await paymentRequestRef(legacy.id).set({ workspaceId: actor.workspace_id, updatedAt }, { merge: true });
            payment = { ...legacy, workspaceId: actor.workspace_id, updatedAt } as BankPaymentRequest;
          }
        }
      }
    }
    if (!payment || payment.workspaceId !== actor.workspace_id) {
      throw new AppError({ code: "PAYMENT_RECOVERY_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Solicitação não encontrada." });
    }
    return { actor, input: { id }, resource: { id: payment.id, payment } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  try {
    const payment = await createCorrectedInboxBarcodePaymentRequest(security.resource.id, {
      uid: security.actor.decoded.uid,
      email: security.actor.decoded.email,
      name: security.actor.userDoc.username,
    });
    return NextResponse.json({ request: payment }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    throw new AppError({
      code: "PAYMENT_RECOVERY_CONFLICT",
      kind: "CONFLICT",
      safeMessage: cause instanceof PaymentRequestRecoveryError
        ? cause.message
        : "Não foi possível criar uma nova tentativa. Tente novamente mais tarde.",
      cause,
    });
  }
});
