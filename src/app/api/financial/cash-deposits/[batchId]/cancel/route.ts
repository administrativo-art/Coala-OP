import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashDepositAccess } from "@/features/financial/cash-closures/access.server";
import { getCashDepositBatch } from "@/features/financial/cash-deposits/repository.server";
import { cancelInterCobrancaForBatch } from "@/features/financial/cash-deposits/inter-service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, routeContext: { params: Promise<{ batchId: string }> }) {
  try {
    const context = await requireUser(request);
    const { batchId } = await routeContext.params;
    const current = await getCashDepositBatch(batchId);
    if (!current) throw new Error("Bloco não encontrado.");
    assertCashDepositAccess(context, "cancel", current.batch.kioskId);
    const payload = await request.json().catch(() => ({}));
    const reason = typeof payload.reason === "string" ? payload.reason : "";
    const result = await cancelInterCobrancaForBatch({
      workspaceId: context.workspace_id,
      batchId,
      reason,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao cancelar cobrança.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
