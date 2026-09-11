import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { linkInboxChargeToExistingExpense, linkSuggestedInboxCharge } from "@/features/financial/inbox/workflow.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";

const schema = z.object({
  expenseId: z.string().trim().min(1).max(180).optional(),
  installmentNumber: z.number().int().positive().nullable().optional(),
  resolutionOnly: z.boolean().optional(),
}).refine((input) => input.resolutionOnly !== true || Boolean(input.expenseId), {
  message: "A identificação sem vínculo exige uma despesa existente.",
});

export const POST = withApiErrorHandling<{ params: Promise<{ id: string }> }>({
  source: "api-financial",
  operation: "identify-financial-inbox-charge",
  routeOrJob: "/api/financial/inbox/[id]/link",
}, async (request: NextRequest, context) => {
  const actor = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "FINANCIAL_INBOX_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const raw = await request.text();
  let body: unknown = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch (cause) {
    throw new AppError({
      code: "FINANCIAL_INBOX_IDENTIFICATION_INVALID_JSON",
      kind: "VALIDATION",
      safeMessage: "Os dados da identificação não são válidos.",
      cause,
    });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError({
      code: "FINANCIAL_INBOX_IDENTIFICATION_INVALID",
      kind: "VALIDATION",
      safeMessage: "Informe um lançamento e uma parcela válidos.",
      cause: parsed.error,
    });
  }
  const input = parsed.data;
  if (!actor.isDefaultAdmin && (
    !actor.permissions.financial?.view
    || !actor.permissions.financial?.inbox?.view
    || !actor.permissions.financial?.inbox?.link
  )) {
    throw new AppError({
      code: "FINANCIAL_INBOX_IDENTIFICATION_FORBIDDEN",
      kind: "AUTHORIZATION",
      safeMessage: "Sem permissão para identificar cobranças recebidas.",
    });
  }
  if (!actor.isDefaultAdmin && input.resolutionOnly !== true && (
    !actor.permissions.financial?.expenses?.create
    || !actor.permissions.financial?.expenses?.edit
  )) {
    throw new AppError({
      code: "FINANCIAL_INBOX_LINK_FORBIDDEN",
      kind: "AUTHORIZATION",
      safeMessage: "Sem permissão para criar ou alterar a despesa vinculada.",
    });
  }
  const { id } = await context.params;
  const paymentActor = {
    uid: actor.decoded.uid,
    email: actor.decoded.email,
    name: actor.userDoc.username ?? null,
  };
  try {
    const result = input.expenseId
      ? await linkInboxChargeToExistingExpense(
          id,
          input.expenseId,
          paymentActor,
          actor.workspace_id,
          input.installmentNumber ?? null,
          input.resolutionOnly === true,
        )
      : await linkSuggestedInboxCharge(id, paymentActor, actor.workspace_id);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    throw new AppError({
      code: "FINANCIAL_INBOX_IDENTIFICATION_CONFLICT",
      kind: "CONFLICT",
      safeMessage: "A cobrança ou o lançamento mudou. Analise novamente antes de confirmar.",
      cause,
    });
  }
});
