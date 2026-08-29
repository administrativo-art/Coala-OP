import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth-server";
import { canAccessUnit } from "@/lib/unit-access";
import { getDreSourceData } from "@/features/financial/dre/source-data.server";
import { DreSourceLimitError } from "@/features/financial/dre/source-data";
import { AppError, withApiErrorHandling } from "@/lib/observability";

const querySchema = z.object({
  kioskIds: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
  periods: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).min(1).max(6),
}).superRefine((value, context) => {
  if (new Set(value.kioskIds).size !== value.kioskIds.length) context.addIssue({ code: "custom", message: "Unidades repetidas." });
  if (new Set(value.periods).size !== value.periods.length) context.addIssue({ code: "custom", message: "Competências repetidas." });
});

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "get-dre-source-data",
  routeOrJob: "/api/financial/dre/source-data",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  if (!context.isDefaultAdmin && (!context.permissions.financial?.view || context.permissions.financial?.dre !== true)) {
    throw new AppError({ code: "DRE_SOURCE_FORBIDDEN", kind: "AUTHORIZATION" });
  }
  const parsed = querySchema.safeParse({
    kioskIds: request.nextUrl.searchParams.getAll("kioskId"),
    periods: request.nextUrl.searchParams.getAll("period"),
  });
  if (!parsed.success) {
    throw new AppError({
      code: "DRE_SOURCE_QUERY_INVALID",
      kind: "VALIDATION",
      safeMessage: "Informe unidades e competências válidas.",
      cause: parsed.error,
    });
  }
  for (const kioskId of parsed.data.kioskIds) {
    if (!canAccessUnit(context.userDoc, kioskId, { isDefaultAdmin: context.isDefaultAdmin })) {
      throw new AppError({ code: "DRE_SOURCE_UNIT_FORBIDDEN", kind: "AUTHORIZATION" });
    }
  }
  const payload = await getDreSourceData({
    workspaceId: context.workspace_id,
    kioskIds: parsed.data.kioskIds,
    periods: parsed.data.periods,
  }).catch((cause) => {
    if (cause instanceof DreSourceLimitError) {
      throw new AppError({
        code: "DRE_SOURCE_LIMIT_EXCEEDED",
        kind: "CONFLICT",
        safeMessage: "O volume solicitado ultrapassa o limite operacional da DRE.",
        cause,
        metadata: { limitReason: cause.reason },
      });
    }
    throw cause;
  });
  return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
});
