import { NextRequest, NextResponse } from "next/server";

import { listFinancialInboxMessages } from "@/features/financial/inbox/repository.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "list-financial-inbox",
  routeOrJob: "/api/financial/inbox",
}, async (request: NextRequest) => {
  const actor = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "FINANCIAL_INBOX_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  if (!actor.isDefaultAdmin && (!actor.permissions.financial?.view || !actor.permissions.financial?.inbox?.view)) {
    throw new AppError({
      code: "FINANCIAL_INBOX_LIST_FORBIDDEN",
      kind: "AUTHORIZATION",
      safeMessage: "Sem permissão para visualizar a caixa de cobranças.",
    });
  }
  const result = await listFinancialInboxMessages({
    workspaceId: actor.workspace_id,
    status: request.nextUrl.searchParams.get("status"),
    stage: request.nextUrl.searchParams.get("stage"),
    search: request.nextUrl.searchParams.get("q"),
    cursor: request.nextUrl.searchParams.get("cursor"),
    limit: Number(request.nextUrl.searchParams.get("limit") || 25),
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
