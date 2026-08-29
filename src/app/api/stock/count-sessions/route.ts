import { NextRequest, NextResponse } from "next/server";

import { listStockCountSessions } from "@/features/stock-count/session-list.server";
import {
  stockCountHistoryBounds,
  stockCountSessionListQuerySchema,
} from "@/features/stock-count/session-list";
import { requireUser } from "@/lib/auth-server";
import { canAccessUnit, resolveUnitAccess } from "@/lib/unit-access";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ROUTE = "/api/stock/count-sessions";

export const GET = withApiErrorHandling({
  source: "api-stock",
  operation: "list-stock-count-sessions",
  routeOrJob: ROUTE,
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const canView = context.isDefaultAdmin ||
    context.permissions.stock.stockCount.view ||
    context.permissions.stock.audit.view;
  if (!canView) {
    throw new AppError({ code: "STOCK_COUNT_LIST_FORBIDDEN", kind: "AUTHORIZATION" });
  }

  const parsed = stockCountSessionListQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    throw new AppError({
      code: "STOCK_COUNT_LIST_QUERY_INVALID",
      kind: "VALIDATION",
      safeMessage: "Os filtros de contagem são inválidos.",
      cause: parsed.error,
    });
  }
  const filters = parsed.data;
  if (filters.kioskId && !canAccessUnit(context.userDoc, filters.kioskId, {
    isDefaultAdmin: context.isDefaultAdmin,
  })) {
    throw new AppError({ code: "STOCK_COUNT_UNIT_FORBIDDEN", kind: "AUTHORIZATION" });
  }

  const access = resolveUnitAccess(context.userDoc, { isDefaultAdmin: context.isDefaultAdmin });
  const unitIds = filters.kioskId
    ? [filters.kioskId]
    : access.allUnits
      ? null
      : access.unitIds;
  const historyBounds = filters.view === "history" && filters.from && filters.to
    ? stockCountHistoryBounds(filters.from, filters.to)
    : {};

  const result = await listStockCountSessions({
    workspaceId: context.workspace_id,
    unitIds,
    status: filters.view === "open"
      ? "pending_review"
      : filters.status === "all"
        ? undefined
        : filters.status,
    ...historyBounds,
    cursor: filters.cursorStartedAt && filters.cursorId
      ? { startedAt: filters.cursorStartedAt, id: filters.cursorId }
      : undefined,
    pageSize: filters.pageSize,
    includeItems: filters.view === "history",
  });

  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  });
});
