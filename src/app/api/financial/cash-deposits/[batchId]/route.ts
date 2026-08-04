import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashDepositAccess } from "@/features/financial/cash-closures/access.server";
import { getCashDepositBatch } from "@/features/financial/cash-deposits/repository.server";

export async function GET(request: NextRequest, routeContext: { params: Promise<{ batchId: string }> }) {
  try {
    const context = await requireUser(request);
    const { batchId } = await routeContext.params;
    const result = await getCashDepositBatch(batchId);
    if (!result) throw new Error("Bloco não encontrado.");
    assertCashDepositAccess(context, "view", result.batch.kioskId);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar bloco.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
