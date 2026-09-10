import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  FinancialInboxReviewError,
  reviewFinancialInboxMessages,
} from "@/features/financial/inbox/repository.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
  status: z.literal("ignored"),
});

export const runtime = "nodejs";

export const POST = withApiErrorHandling({
  source: "api-financial",
  operation: "bulk-review-financial-inbox",
  routeOrJob: "/api/financial/inbox/bulk-review",
}, async (request: NextRequest) => {
  const actor = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "FINANCIAL_INBOX_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  if (!actor.isDefaultAdmin && (
    !actor.permissions.financial?.view
    || !actor.permissions.financial?.inbox?.view
    || !actor.permissions.financial?.inbox?.discard
  )) {
    throw new AppError({
      code: "FINANCIAL_INBOX_BULK_REVIEW_FORBIDDEN",
      kind: "AUTHORIZATION",
      safeMessage: "Sem permissão para descartar cobranças recebidas.",
    });
  }
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    throw new AppError({
      code: "FINANCIAL_INBOX_BULK_REVIEW_INVALID",
      kind: "VALIDATION",
      safeMessage: "Selecione entre 1 e 50 cobranças válidas.",
      cause: parsed.error,
    });
  }
  try {
    const result = await reviewFinancialInboxMessages({
      ids: parsed.data.ids,
      status: parsed.data.status,
      workspaceId: actor.workspace_id,
      actorId: actor.decoded.uid,
      actorEmail: actor.decoded.email,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    if (cause instanceof FinancialInboxReviewError && cause.code === "NOT_FOUND") {
      throw new AppError({ code: "FINANCIAL_INBOX_MESSAGE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Uma das cobranças selecionadas não foi encontrada.", cause });
    }
    if (cause instanceof FinancialInboxReviewError) {
      throw new AppError({ code: "FINANCIAL_INBOX_BULK_REVIEW_CONFLICT", kind: "CONFLICT", safeMessage: "A seleção contém cobrança vinculada, em processamento ou com pagamento.", cause });
    }
    throw cause;
  }
});
