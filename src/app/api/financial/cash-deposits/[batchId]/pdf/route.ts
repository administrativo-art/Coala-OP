import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashDepositBatchAccess } from "@/features/financial/cash-closures/access.server";
import { getCashDepositBatch } from "@/features/financial/cash-deposits/repository.server";
import { getInterCobrancaPdfForBatch } from "@/features/financial/cash-deposits/inter-service.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ batchId: string }> };

export const GET = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "get-cash-deposit-pdf",
  routeOrJob: "/api/financial/cash-deposits/[batchId]/pdf",
}, async (request: NextRequest, routeContext) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const { batchId } = await routeContext.params;
  const current = await getCashDepositBatch(batchId);
  if (!current || current.batch.workspaceId !== context.workspace_id) {
    throw new AppError({ code: "CASH_DEPOSIT_NOT_FOUND", kind: "NOT_FOUND" });
  }
  try {
    assertCashDepositBatchAccess(context, "view", current.batch);
  } catch (cause) {
    throw new AppError({ code: "CASH_DEPOSIT_PDF_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  const pdf = await getInterCobrancaPdfForBatch({ workspaceId: context.workspace_id, batchId });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="deposito-${batchId.replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf"`,
      "Content-Type": "application/pdf",
    },
  });
});
