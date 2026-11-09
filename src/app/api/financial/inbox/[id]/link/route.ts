import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { linkInboxChargeToExistingExpense, linkSuggestedInboxCharge } from "@/features/financial/inbox/workflow.server";
import { getFinancialInboxMessage } from "@/features/financial/inbox/repository.server";
import { requireUser } from "@/lib/auth-server";
import { AppError } from "@/lib/observability";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { secureRoute } from "@/lib/security/secure-route.server";

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
    barcode: z.string().regex(/^(?:\d{47}|\d{48})$/),
    supplierName: z.string().trim().min(1).max(200),
    supplierTaxId: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().length(14)),
    customerAccount: z.string().trim().min(5).max(24).optional(),
    serviceNumbers: z.array(z.string().trim().min(10).max(24)).min(1).max(20).optional(),
    serviceType: z.enum(["mobile", "landline"]).optional(),
  }).strict().optional(),
  accountAllocations: z.array(z.object({
    accountPlanId: z.string().trim().min(1).max(180),
    amountCents: z.number().int().positive(),
  }).strict()).min(2).max(20).optional(),
}).strict().refine((input) => input.resolutionOnly !== true || Boolean(input.expenseId), {
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

type RouteContext = { params: Promise<{ id: string }> };
type Actor = Awaited<ReturnType<typeof requireUser>>;
type Input = z.infer<typeof schema>;

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.inbox.charge-link",
  version: 1,
  surface: { method: "POST", path: "/api/financial/inbox/[id]/link" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "financial-inbox-charge-link" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.inbox.charge-link", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, Actor, Input, { id: string }>({
  id: "financial-inbox-charge-link-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:financial-inbox-charge-link", "workspace-scoped", "input-validated", "fields-allowlisted", "server-authoritative-audit"],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "FINANCIAL_INBOX_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    const raw = await request.text();
    let body: unknown = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch (cause) {
      throw new AppError({ code: "FINANCIAL_INBOX_IDENTIFICATION_INVALID_JSON", kind: "VALIDATION",
        safeMessage: "Os dados da identificação não são válidos.", cause });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new AppError({ code: "FINANCIAL_INBOX_IDENTIFICATION_INVALID", kind: "VALIDATION",
        safeMessage: "Informe um lançamento e uma parcela válidos.", cause: parsed.error });
    }
    if (!actor.isDefaultAdmin && (!actor.permissions.financial?.view
      || !actor.permissions.financial?.inbox?.view || !actor.permissions.financial?.inbox?.link)) {
      throw new AppError({ code: "FINANCIAL_INBOX_IDENTIFICATION_FORBIDDEN", kind: "AUTHORIZATION",
        safeMessage: "Sem permissão para identificar cobranças recebidas." });
    }
    if (!actor.isDefaultAdmin && parsed.data.resolutionOnly !== true
      && (!actor.permissions.financial?.expenses?.create || !actor.permissions.financial?.expenses?.edit)) {
      throw new AppError({ code: "FINANCIAL_INBOX_LINK_FORBIDDEN", kind: "AUTHORIZATION",
        safeMessage: "Sem permissão para criar ou alterar a despesa vinculada." });
    }
    const { id } = await routeContext.params;
    if (!/^[a-zA-Z0-9_-]{8,170}$/.test(id)) {
      throw new AppError({ code: "FINANCIAL_INBOX_IDENTIFICATION_INVALID_ID", kind: "VALIDATION" });
    }
    const message = await getFinancialInboxMessage(id);
    if (message.workspaceId !== actor.workspace_id) {
      throw new AppError({ code: "FINANCIAL_INBOX_IDENTIFICATION_NOT_FOUND", kind: "NOT_FOUND" });
    }
    return { actor, input: parsed.data, resource: { id } };
  },
});

export const POST = secureRoute({ contract, enforcer,
  observability: { source: "api-financial", operation: "identify-financial-inbox-charge" },
}, async ({ security }) => {
  const { actor, input } = security;
  const id = security.resource.id;
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
