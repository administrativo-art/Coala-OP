import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { linkInboxChargeToExistingExpense, linkSuggestedInboxCharge } from "@/features/financial/inbox/workflow.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";

const schema = z.object({
  expenseId: z.string().trim().min(1).max(180).optional(),
  provisionExpenseId: z.string().trim().min(1).max(180).optional(),
  installmentNumber: z.number().int().positive().nullable().optional(),
  resolutionOnly: z.boolean().optional(),
  documentConfirmation: z.object({
    amountCents: z.number().int().positive(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    competence: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
    barcode: z.string().regex(/^\d{47}$/),
    supplierName: z.string().trim().min(1).max(200),
    supplierTaxId: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().length(14)),
  }).optional(),
  accountAllocations: z.array(z.object({
    accountPlanId: z.string().trim().min(1).max(180),
    amountCents: z.number().int().positive(),
  })).min(2).max(20).optional(),
}).refine((input) => input.resolutionOnly !== true || Boolean(input.expenseId), {
  message: "A identificação sem vínculo exige uma despesa existente.",
}).refine((input) => !input.expenseId || !input.accountAllocations, {
  message: "A apropriação informada só pode ser aplicada ao conciliar uma previsão.",
}).refine((input) => !input.expenseId || (!input.provisionExpenseId && !input.documentConfirmation), {
  message: "A confirmação documental só pode ser aplicada ao conciliar uma previsão.",
}).refine((input) => Boolean(input.provisionExpenseId) === Boolean(input.documentConfirmation), {
  message: "A previsão e a confirmação documental devem ser informadas juntas.",
}).refine((input) => input.resolutionOnly !== true || (!input.provisionExpenseId && !input.documentConfirmation), {
  message: "A identificação sem vínculo não aceita confirmação documental.",
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
      : await linkSuggestedInboxCharge(
          id,
          paymentActor,
          actor.workspace_id,
          input.accountAllocations,
          input.provisionExpenseId,
          input.documentConfirmation,
        );
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
