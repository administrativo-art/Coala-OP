import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { canAccessUnit } from "@/lib/unit-access";
import { assertCashDepositAccess } from "@/features/financial/cash-closures/access.server";
import { listCashDepositBatches, listPendingCashDepositAdjustments } from "@/features/financial/cash-deposits/repository.server";
import { listInterCobrancas } from "@/features/financial/cash-deposits/inter-service.server";
import { configuredInterCobrancaReadiness } from "@/features/financial/cash-deposits/payer.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const kioskId = request.nextUrl.searchParams.get("kioskId")?.trim() || undefined;
    assertCashDepositAccess(context, "view", kioskId);
    const [batches, adjustments, cobrancas, inter] = await Promise.all([
      listCashDepositBatches({ workspaceId: context.workspace_id, kioskId }),
      listPendingCashDepositAdjustments(context.workspace_id),
      listInterCobrancas(context.workspace_id),
      configuredInterCobrancaReadiness(),
    ]);
    const visibleBatches = batches.filter((batch) => canAccessUnit(context.userDoc, batch.kioskId, { isDefaultAdmin: context.isDefaultAdmin }));
    const visibleBatchIds = new Set(visibleBatches.map((batch) => batch.id));
    return NextResponse.json({
      batches: visibleBatches,
      adjustments: adjustments.filter((adjustment) =>
        (!kioskId || adjustment.kioskId === kioskId) &&
        canAccessUnit(context.userDoc, adjustment.kioskId, { isDefaultAdmin: context.isDefaultAdmin }),
      ),
      cobrancas: cobrancas.filter((cobranca) => visibleBatchIds.has(cobranca.batchId)),
      inter,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar depósitos.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
