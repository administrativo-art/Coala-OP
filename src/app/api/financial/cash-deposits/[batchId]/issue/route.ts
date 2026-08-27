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
    const body = await request.json().catch(() => ({}));
    const dueBusinessDays = body.dueBusinessDays === undefined ? undefined : Number(body.dueBusinessDays);
    if (dueBusinessDays !== undefined && (!Number.isSafeInteger(dueBusinessDays) || dueBusinessDays < 0 || dueBusinessDays > 30)) {
      throw new Error("O prazo de vencimento deve ser um número inteiro entre 0 e 30 dias úteis.");
    }
    const dueDate = body.dueDate === undefined ? undefined : String(body.dueDate).trim();
    if (dueDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error("A data de vencimento é inválida.");
    if (dueBusinessDays !== undefined && dueDate !== undefined) throw new Error("Informe o prazo ou a data de vencimento, não ambos.");
    const current = await getCashDepositBatch(batchId);
    if (!current) throw new Error("Bloco não encontrado.");
    assertCashDepositAccess(context, "issue", current.batch.kioskId);
    const result = await issueInterCobrancaForBatch({
      workspaceId: context.workspace_id,
      batchId,
      actor: cashClosureActor(context),
      dueBusinessDays,
      dueDate,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao emitir cobrança.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
