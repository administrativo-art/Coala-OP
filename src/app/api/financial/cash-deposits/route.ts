import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { canAccessUnit } from "@/lib/unit-access";
import { assertCashDepositAccess } from "@/features/financial/cash-closures/access.server";
import {
  listCashCoinBalances,
  listCashDepositBatches,
  listPendingCashDepositAdjustments,
} from "@/features/financial/cash-deposits/repository.server";
import { listInterCobrancas } from "@/features/financial/cash-deposits/inter-service.server";
import { configuredInterCobrancaReadiness } from "@/features/financial/cash-deposits/payer.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "list-cash-deposits",
  routeOrJob: "/api/financial/cash-deposits",
}, async (request: NextRequest) => {
    const context = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    const kioskId = request.nextUrl.searchParams.get("kioskId")?.trim() || undefined;
    try {
      assertCashDepositAccess(context, "view", kioskId);
    } catch (cause) {
      throw new AppError({ code: "CASH_DEPOSIT_VIEW_FORBIDDEN", kind: "AUTHORIZATION", cause });
    }
    const [batches, adjustments, cobrancas, inter, coinBalances] = await Promise.all([
      listCashDepositBatches({ workspaceId: context.workspace_id, kioskId }),
      listPendingCashDepositAdjustments(context.workspace_id),
      listInterCobrancas(context.workspace_id),
      configuredInterCobrancaReadiness(),
      listCashCoinBalances(context.workspace_id),
    ]);
    const visibleBatches = batches.filter((batch) => (batch.kioskIds?.length ? batch.kioskIds : [batch.kioskId])
      .every((unitId) => canAccessUnit(context.userDoc, unitId, { isDefaultAdmin: context.isDefaultAdmin })));
    const visibleBatchIds = new Set(visibleBatches.map((batch) => batch.id));
    return NextResponse.json({
      batches: visibleBatches,
      adjustments: adjustments.filter((adjustment) =>
        (!kioskId || adjustment.kioskId === kioskId) &&
        canAccessUnit(context.userDoc, adjustment.kioskId, { isDefaultAdmin: context.isDefaultAdmin }),
      ),
      cobrancas: cobrancas.filter((cobranca) => visibleBatchIds.has(cobranca.batchId)),
      coinBalances: coinBalances.filter((balance) =>
        (!kioskId || balance.kioskId === kioskId) &&
        canAccessUnit(context.userDoc, balance.kioskId, { isDefaultAdmin: context.isDefaultAdmin }),
      ),
      inter,
    }, { headers: { "Cache-Control": "private, no-store" } });
});
