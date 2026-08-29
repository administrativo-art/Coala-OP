import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashDepositBatchAccess } from "@/features/financial/cash-closures/access.server";
import { getInterCobrancaForBatch, refreshInterCobranca } from "@/features/financial/cash-deposits/inter-service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, routeContext: { params: Promise<{ batchId: string }> }) {
  try {
    const context = await requireUser(request);
    const { batchId } = await routeContext.params;
    const current = await getInterCobrancaForBatch(batchId);
    if (!current) throw new Error("Bloco não encontrado.");
    assertCashDepositBatchAccess(context, "view", current.batch);
    if (!current.cobranca) throw new Error("Este bloco ainda não possui cobrança Inter.");
    const result = await refreshInterCobranca(current.cobranca.id);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao atualizar cobrança.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
