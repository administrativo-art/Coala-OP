import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import {
  assertCashDepositAccess,
  cashClosureActor,
} from "@/features/financial/cash-closures/access.server";
import { getCashDepositBatch } from "@/features/financial/cash-deposits/repository.server";
import { issueInterCobrancaForBatch } from "@/features/financial/cash-deposits/inter-service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, routeContext: { params: Promise<{ batchId: string }> }) {
  try {
    const context = await requireUser(request);
    const { batchId } = await routeContext.params;
    const current = await getCashDepositBatch(batchId);
    if (!current) throw new Error("Bloco não encontrado.");
    assertCashDepositAccess(context, "issue", current.batch.kioskId);
    const result = await issueInterCobrancaForBatch({
      workspaceId: context.workspace_id,
      batchId,
      actor: cashClosureActor(context),
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao emitir cobrança.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
