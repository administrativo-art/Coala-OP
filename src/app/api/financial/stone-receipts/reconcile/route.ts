import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { queryStoneReceiptReconciliation } from "@/features/financial/receipts-reconciliation/reconciliation.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

export const POST = withApiErrorHandling({ source: "api-financial", operation: "stone-receipt-reconciliation", routeOrJob: "/api/financial/stone-receipts/reconcile" }, async (request: NextRequest) => {
  const context = await requireUser(request).catch(() => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION" });
  });
  const body = await request.text();
  if (body.length > 2048) throw new AppError({ code: "STONE_RECEIPT_BODY_TOO_LARGE", kind: "VALIDATION" });
  let input: unknown;
  try { input = JSON.parse(body); } catch { throw new AppError({ code: "STONE_RECEIPT_JSON_INVALID", kind: "VALIDATION" }); }
  const result = await queryStoneReceiptReconciliation(input, context, {});
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
