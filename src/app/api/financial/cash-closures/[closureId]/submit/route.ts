import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashClosureAccess, cashClosureActor } from "@/features/financial/cash-closures/access.server";
import { getCashClosure, submitCashClosure } from "@/features/financial/cash-closures/repository.server";

export async function POST(request: NextRequest, routeContext: { params: Promise<{ closureId: string }> }) {
  try {
    const context = await requireUser(request);
    const { closureId } = await routeContext.params;
    const current = await getCashClosure(closureId);
    if (!current) throw new Error("Fechamento não encontrado.");
    assertCashClosureAccess(context, "edit", current.closure.kioskId);
    return NextResponse.json({ closure: await submitCashClosure(closureId, cashClosureActor(context)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao finalizar fechamento.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
