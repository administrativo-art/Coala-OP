import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { assertMonthClosingAccess, canViewMonthClosingExpenseItems } from "@/features/financial/month-closing/access";
import { isClosableRange } from "@/features/financial/month-closing/month";
import { getMonthClosingOverview, MonthClosingLimitError } from "@/features/financial/month-closing/overview.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<Record<string, never>> };
type Input = { month: string };

const querySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict();

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.month-closing.overview",
  version: 1,
  surface: { method: "GET", path: "/api/financial/month-closing" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "financial-month-closing-view" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.month-closing.overview", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = createStandardSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, Input, { workspaceId: string }>(contract, {
  authenticate: async ({ request }) => requireUser(request).catch(rethrowServerAuthenticationFailure),
  parseInput: async ({ request }) => {
    const query: Record<string, string> = {};
    request.nextUrl.searchParams.forEach((value, key) => { query[key] = value; });
    const result = querySchema.safeParse(query);
    if (!result.success || !isClosableRange(result.data.month)) {
      throw new AppError({
        code: "MONTH_CLOSING_MONTH_INVALID",
        kind: "VALIDATION",
        safeMessage: "Informe uma competência válida, a partir de agosto de 2026 e até o mês atual.",
        cause: result.success ? undefined : result.error,
      });
    }
    return result.data;
  },
  loadResource: async ({ actor }) => ({ workspaceId: actor.workspace_id }),
  authorize: ({ actor }) => assertMonthClosingAccess(actor),
  assertScope: () => undefined,
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const payload = await getMonthClosingOverview({
    month: security.input.month,
    canViewExpenseItems: canViewMonthClosingExpenseItems(security.actor),
  }).catch((cause) => {
    if (cause instanceof MonthClosingLimitError) {
      throw new AppError({
        code: "MONTH_CLOSING_LIMIT_EXCEEDED",
        kind: "CONFLICT",
        safeMessage: "O volume da competência ultrapassa o limite operacional do fechamento.",
        cause,
        metadata: { limitReason: cause.reason },
      });
    }
    throw cause;
  });
  return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
});
