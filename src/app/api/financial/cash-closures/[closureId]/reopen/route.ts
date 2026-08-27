import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashClosureAccess, cashClosureActor } from "@/features/financial/cash-closures/access.server";
import { getCashClosure } from "@/features/financial/cash-closures/repository.server";
import { cashClosureReasonSchema } from "@/features/financial/cash-closures/schemas";
import { reopenCashClosureWithDepositHandling } from "@/features/financial/cash-deposits/repository.server";

export async function POST(request: NextRequest, routeContext: { params: Promise<{ closureId: string }> }) {
  try {
    const context = await requireUser(request);
    const { closureId } = await routeContext.params;
    const current = await getCashClosure(closureId);
    if (!current) throw new Error("Fechamento não encontrado.");
    assertCashClosureAccess(context, "reopen", current.closure.kioskId);
    const { reason } = cashClosureReasonSchema.parse(await request.json());
    return NextResponse.json(await reopenCashClosureWithDepositHandling({
      workspaceId: context.workspace_id,
      closureId,
      reason,
      actor: cashClosureActor(context),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao reabrir fechamento.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
