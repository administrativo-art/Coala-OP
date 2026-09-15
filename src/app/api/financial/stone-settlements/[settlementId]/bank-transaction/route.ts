import { NextRequest, NextResponse } from "next/server";

import { stoneSettlementLinkSchema, stoneSettlementUnlinkSchema } from "@/features/financial/stone-receivables/schemas";
import {
  linkStoneSettlement,
  StoneSettlementReconciliationError,
  unlinkStoneSettlement,
} from "@/features/financial/stone-receivables/service.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { resolveUnitAccess } from "@/lib/unit-access";

type RouteContext = { params: Promise<{ settlementId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function settlementError(cause: unknown) {
  if (!(cause instanceof StoneSettlementReconciliationError)) throw cause;
  if (cause.code === "SETTLEMENT_NOT_FOUND" || cause.code === "TRANSACTION_NOT_FOUND") {
    throw new AppError({ code: `STONE_${cause.code}`, kind: "NOT_FOUND", safeMessage: cause.message, cause });
  }
  if (cause.code === "WORKSPACE_MISMATCH") {
    throw new AppError({ code: "STONE_SETTLEMENT_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  throw new AppError({ code: `STONE_${cause.code}`, kind: "CONFLICT", safeMessage: cause.message, cause });
}

async function actorContext(request: NextRequest, permission: "confirm" | "correct") {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const unitAccess = resolveUnitAccess(context.userDoc, { isDefaultAdmin: context.isDefaultAdmin });
  const allowed = context.isDefaultAdmin || (
    context.permissions.financial?.view === true
    && context.permissions.financial?.salesReconciliation?.view === true
    && context.permissions.financial?.reconciliation?.[permission] === true
    && unitAccess.allUnits
  );
  if (!allowed) throw new AppError({ code: "STONE_SETTLEMENT_RECONCILIATION_FORBIDDEN", kind: "AUTHORIZATION" });
  return context;
}

export const POST = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "link-stone-settlement",
  routeOrJob: "/api/financial/stone-settlements/[settlementId]/bank-transaction",
}, async (request: NextRequest, routeContext) => {
  const context = await actorContext(request, "confirm");
  const parsed = stoneSettlementLinkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError({ code: "STONE_SETTLEMENT_LINK_INVALID", kind: "VALIDATION", safeMessage: "Informe a transação e a justificativa.", cause: parsed.error });
  }
  const { settlementId } = await routeContext.params;
  const result = await linkStoneSettlement({
    workspaceId: context.workspace_id,
    settlementId,
    ...parsed.data,
    actor: {
      id: context.decoded.uid,
      name: context.userDoc.username?.trim() || context.decoded.name?.trim() || context.decoded.email || null,
      email: context.decoded.email || null,
    },
  }).catch(settlementError);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});

export const DELETE = withApiErrorHandling<RouteContext>({
  source: "api-financial",
  operation: "unlink-stone-settlement",
  routeOrJob: "/api/financial/stone-settlements/[settlementId]/bank-transaction",
}, async (request: NextRequest, routeContext) => {
  const context = await actorContext(request, "correct");
  const parsed = stoneSettlementUnlinkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError({ code: "STONE_SETTLEMENT_UNLINK_INVALID", kind: "VALIDATION", safeMessage: "Informe a justificativa da correção.", cause: parsed.error });
  }
  const { settlementId } = await routeContext.params;
  const result = await unlinkStoneSettlement({
    workspaceId: context.workspace_id,
    settlementId,
    expectedTransactionId: parsed.data.transactionId,
    reason: parsed.data.reason,
    actor: {
      id: context.decoded.uid,
      name: context.userDoc.username?.trim() || context.decoded.name?.trim() || context.decoded.email || null,
      email: context.decoded.email || null,
    },
  }).catch(settlementError);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
