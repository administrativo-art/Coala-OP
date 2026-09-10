import { NextRequest, NextResponse } from "next/server";

import {
  FinancialInboxReviewError,
  restoreArchivedFinancialInboxMessage,
} from "@/features/financial/inbox/repository.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "restore-financial-inbox-message",
  routeOrJob: "/api/financial/inbox/[id]/restore",
}, async (request: NextRequest, context) => {
  const actor = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "FINANCIAL_INBOX_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  if (!actor.isDefaultAdmin && (
    !actor.permissions.financial?.view
    || !actor.permissions.financial?.inbox?.view
    || !actor.permissions.financial?.inbox?.discard
  )) {
    throw new AppError({
      code: "FINANCIAL_INBOX_RESTORE_FORBIDDEN",
      kind: "AUTHORIZATION",
      safeMessage: "Sem permissão para restaurar cobranças arquivadas.",
    });
  }
  const { id } = await context.params;
  try {
    const message = await restoreArchivedFinancialInboxMessage({
      id,
      workspaceId: actor.workspace_id,
      actorId: actor.decoded.uid,
      actorEmail: actor.decoded.email,
    });
    return NextResponse.json({ message }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    if (cause instanceof FinancialInboxReviewError && cause.code === "NOT_FOUND") {
      throw new AppError({ code: "FINANCIAL_INBOX_MESSAGE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Cobrança arquivada não encontrada.", cause });
    }
    if (cause instanceof FinancialInboxReviewError) {
      throw new AppError({ code: "FINANCIAL_INBOX_RESTORE_CONFLICT", kind: "CONFLICT", safeMessage: "A cobrança não está disponível para restauração.", cause });
    }
    throw cause;
  }
});
