import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { canAccessUnit } from "@/lib/unit-access";
import { assertCashClosureAccess } from "@/features/financial/cash-closures/access.server";
import { listCashClosures } from "@/features/financial/cash-closures/repository.server";
import { cashClosureListQuerySchema } from "@/features/financial/cash-closures/schemas";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "list-cash-closures",
  routeOrJob: "/api/financial/cash-closures",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "CASH_CLOSURE_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  try {
    assertCashClosureAccess(context, "view");
  } catch (cause) {
    throw new AppError({ code: "CASH_CLOSURE_LIST_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  const parsed = cashClosureListQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    throw new AppError({
      code: "CASH_CLOSURE_LIST_QUERY_INVALID",
      kind: "VALIDATION",
      safeMessage: "Os filtros informados são inválidos.",
      cause: parsed.error,
    });
  }
  if (parsed.data.kioskId) {
    try {
      assertCashClosureAccess(context, "view", parsed.data.kioskId);
    } catch (cause) {
      throw new AppError({ code: "CASH_CLOSURE_LIST_UNIT_FORBIDDEN", kind: "AUTHORIZATION", cause });
    }
  }
  const closures = await listCashClosures({
    workspaceId: context.workspace_id,
    ...parsed.data,
  });
  const visible = closures.filter((closure) =>
    canAccessUnit(context.userDoc, closure.kioskId, { isDefaultAdmin: context.isDefaultAdmin }),
  );
  return NextResponse.json({ closures: visible }, { headers: { "Cache-Control": "private, no-store" } });
});
