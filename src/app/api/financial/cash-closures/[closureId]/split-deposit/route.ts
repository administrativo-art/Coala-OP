import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashDepositAccess, cashClosureActor } from "@/features/financial/cash-closures/access.server";
import { getCashClosure } from "@/features/financial/cash-closures/repository.server";
import { manualCashDepositSplitSchema } from "@/features/financial/cash-closures/schemas";
import { splitOversizedCashClosure } from "@/features/financial/cash-deposits/repository.server";

export async function POST(request: NextRequest, routeContext: { params: Promise<{ closureId: string }> }) {
  try {
    const context = await requireUser(request);
    const { closureId } = await routeContext.params;
    const current = await getCashClosure(closureId);
    if (!current) throw new Error("Fechamento não encontrado.");
    assertCashDepositAccess(context, "adjust", current.closure.kioskId);
    const { partsCents } = manualCashDepositSplitSchema.parse(await request.json());
    return NextResponse.json(await splitOversizedCashClosure({
      workspaceId: context.workspace_id,
      closureId,
      partsCents,
      actor: cashClosureActor(context),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao dividir o depósito.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
