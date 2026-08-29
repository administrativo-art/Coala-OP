import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashDepositAccess } from "@/features/financial/cash-closures/access.server";
import { buildCashDepositReport } from "@/features/financial/cash-deposits/reports.server";
import { canAccessUnit } from "@/lib/unit-access";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "get-cash-deposit-report",
  routeOrJob: "/api/financial/cash-deposits/reports",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  try {
    assertCashDepositAccess(context, "view");
  } catch (cause) {
    throw new AppError({ code: "CASH_DEPOSIT_REPORT_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  const report = await buildCashDepositReport(
    context.workspace_id,
    (kioskId) => canAccessUnit(context.userDoc, kioskId, { isDefaultAdmin: context.isDefaultAdmin }),
  );
  return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store" } });
});
