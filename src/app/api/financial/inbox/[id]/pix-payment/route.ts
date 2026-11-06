import { NextRequest, NextResponse } from "next/server";

import { InboxPixPaymentPreparationError, inboxPixCopyPastePreparationSchema, type InboxPixCopyPastePreparation } from "@/features/financial/payment-requests/inbox-pix-copy-paste";
import { createInboxPixCopyPastePaymentRequest, getInboxMessageWorkspaceId } from "@/features/financial/payment-requests/service.server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type Resource = { id: string; workspaceId: string };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.inbox.pix-copy-paste-payment.prepare",
  version: 1,
  surface: { method: "POST", path: "/api/financial/inbox/[id]/pix-payment" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "financial.payment-requests.create" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.inbox.pix-copy-paste-payment.prepare", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const enforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, InboxPixCopyPastePreparation, Resource>(contract, {
  authenticate: ({ request }) => requireUser(request).catch((cause) => {
    throw new AppError({ code: "INBOX_PIX_PAYMENT_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  }),
  parseInput: async ({ request }) => {
    const parsed = inboxPixCopyPastePreparationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({
        code: "INBOX_PIX_PAYMENT_INPUT_INVALID",
        kind: "VALIDATION",
        safeMessage: "Informe a data do pagamento e o Pix copia e cola completo da guia.",
        cause: parsed.error,
      });
    }
    return parsed.data;
  },
  loadResource: async ({ actor, routeContext }) => {
    const { id } = await routeContext.params;
    if (!id || id.length > 250) throw new AppError({ code: "INBOX_PIX_PAYMENT_NOT_FOUND", kind: "NOT_FOUND" });
    const workspaceId = await getInboxMessageWorkspaceId(id);
    if (!workspaceId || workspaceId !== actor.workspace_id) {
      throw new AppError({ code: "INBOX_PIX_PAYMENT_NOT_FOUND", kind: "NOT_FOUND" });
    }
    return { id, workspaceId };
  },
  authorize: ({ actor }) => {
    if (!actor.isDefaultAdmin && (
      !actor.permissions.financial?.view
      || !actor.permissions.financial?.inbox?.view
      || !actor.permissions.financial?.expenses?.edit
      || !actor.permissions.financial?.paymentRequests?.view
      || !actor.permissions.financial?.paymentRequests?.create
    )) {
      throw new AppError({
        code: "INBOX_PIX_PAYMENT_FORBIDDEN",
        kind: "AUTHORIZATION",
        safeMessage: "Sem permissão para preparar pagamentos bancários.",
      });
    }
  },
  assertScope: ({ actor, resource }) => {
    if (resource.workspaceId !== actor.workspace_id) {
      throw new AppError({ code: "INBOX_PIX_PAYMENT_NOT_FOUND", kind: "NOT_FOUND" });
    }
  },
});

export const POST = secureRoute({
  contract,
  enforcer,
  observability: { source: "api-financial", operation: "prepare-inbox-pix-copy-paste-payment" },
}, async ({ security }) => {
  try {
    const request = await createInboxPixCopyPastePaymentRequest({
      inboxMessageId: security.resource.id,
      workspaceId: security.actor.workspace_id,
      ...security.input,
    }, {
      uid: security.actor.decoded.uid,
      email: security.actor.decoded.email,
      name: security.actor.userDoc.username,
    });
    return NextResponse.json({ request }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    if (cause instanceof InboxPixPaymentPreparationError) {
      throw new AppError({ code: "INBOX_PIX_PAYMENT_CONFLICT", kind: "CONFLICT", safeMessage: cause.message, cause });
    }
    throw new AppError({
      code: "INBOX_PIX_PAYMENT_FAILED",
      kind: "UNEXPECTED_APPLICATION",
      safeMessage: "Não foi possível preparar o pagamento. Atualize a cobrança e tente novamente.",
      cause,
    });
  }
});
