import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import {
  assertCashClosureAccess,
  assertCashClosureDivergenceApproval,
  cashClosureActor,
} from "@/features/financial/cash-closures/access.server";
import { approveCashClosure, getCashClosure } from "@/features/financial/cash-closures/repository.server";
import { cashClosureReasonSchema } from "@/features/financial/cash-closures/schemas";
import { finalizeCashDepositAdjustmentForClosure, processCashDepositQueue } from "@/features/financial/cash-deposits/repository.server";

export async function POST(request: NextRequest, routeContext: { params: Promise<{ closureId: string }> }) {
  try {
    const context = await requireUser(request);
    const { closureId } = await routeContext.params;
    const current = await getCashClosure(closureId);
    if (!current) throw new Error("Fechamento não encontrado.");
    assertCashClosureAccess(context, "approve", current.closure.kioskId);
    assertCashClosureDivergenceApproval(context, current.closure.kioskId, current.lines);
    const { reason } = cashClosureReasonSchema.parse(await request.json());
    const actor = cashClosureActor(context);
    const closure = await approveCashClosure(closureId, reason, actor);
    let allocationError: string | null = null;
    try {
      await finalizeCashDepositAdjustmentForClosure(closureId);
      await processCashDepositQueue(context.workspace_id, closure.kioskId, actor);
    } catch (error) {
      allocationError = error instanceof Error ? error.message : "Falha ao alocar o dinheiro contado.";
    }
    return NextResponse.json({ closure, allocationError });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao aprovar fechamento.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
