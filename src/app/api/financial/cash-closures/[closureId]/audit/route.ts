import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashClosureAccess } from "@/features/financial/cash-closures/access.server";
import { getCashClosure, listCashClosureAuditLogs } from "@/features/financial/cash-closures/repository.server";

export async function GET(request: NextRequest, routeContext: { params: Promise<{ closureId: string }> }) {
  try {
    const context = await requireUser(request);
    const { closureId } = await routeContext.params;
    const current = await getCashClosure(closureId);
    if (!current) throw new Error("Fechamento não encontrado.");
    assertCashClosureAccess(context, "view", current.closure.kioskId);
    return NextResponse.json({ logs: await listCashClosureAuditLogs(context.workspace_id, closureId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar auditoria.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
