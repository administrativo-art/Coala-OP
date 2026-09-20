import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { DreStockCmvLimitError } from "@/features/financial/dre/stock-cmv";
import { getDreStockCmv } from "@/features/financial/dre/stock-cmv.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { canAccessUnit } from "@/lib/unit-access";

const querySchema = z.object({
  kioskIds: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
  periods: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).min(1).max(6),
}).superRefine((value, context) => {
  if (new Set(value.kioskIds).size !== value.kioskIds.length) {
    context.addIssue({ code: "custom", message: "Unidades repetidas." });
  }
  if (new Set(value.periods).size !== value.periods.length) {
    context.addIssue({ code: "custom", message: "Competências repetidas." });
  }
});

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "get-dre-stock-cmv",
  routeOrJob: "/api/financial/dre/stock-cmv",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "DRE_STOCK_CMV_UNAUTHENTICATED", kind: "AUTHENTICATION", cause });
  });
  if (!context.permissions.financial?.dre && !context.isDefaultAdmin) {
    throw new AppError({ code: "DRE_STOCK_CMV_FORBIDDEN", kind: "AUTHORIZATION" });
  }
  const parsed = querySchema.safeParse({
    kioskIds: request.nextUrl.searchParams.getAll("kioskId"),
    periods: request.nextUrl.searchParams.getAll("period"),
  });
  if (!parsed.success) {
    throw new AppError({
      code: "DRE_STOCK_CMV_INVALID_QUERY",
      kind: "VALIDATION",
      safeMessage: "Filtros da DRE inválidos.",
      metadata: { issues: parsed.error.issues.map((issue) => issue.message) },
    });
  }
  for (const kioskId of parsed.data.kioskIds) {
    if (!canAccessUnit(context.userDoc, kioskId, { isDefaultAdmin: context.isDefaultAdmin })) {
      throw new AppError({ code: "DRE_STOCK_CMV_UNIT_FORBIDDEN", kind: "AUTHORIZATION" });
    }
  }
  const payload = await getDreStockCmv({
    workspaceId: context.workspace_id,
    kioskIds: parsed.data.kioskIds,
    periods: parsed.data.periods,
  }).catch((cause) => {
    if (cause instanceof DreStockCmvLimitError) {
      throw new AppError({
        code: "DRE_STOCK_CMV_LIMIT_EXCEEDED",
        kind: "CONFLICT",
        safeMessage: "O volume solicitado ultrapassa o limite operacional do CMV por estoque.",
        cause,
        metadata: { limitReason: cause.reason },
      });
    }
    throw cause;
  });
  return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
});
