import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashClosureAccess, cashClosureActor } from "@/features/financial/cash-closures/access.server";
import { syncCashClosureSchema } from "@/features/financial/cash-closures/schemas";
import { syncCashClosure } from "@/features/financial/cash-closures/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const input = syncCashClosureSchema.parse(await request.json());
    assertCashClosureAccess(context, "resync", input.kioskId);
    const result = await syncCashClosure({
      workspaceId: context.workspace_id,
      kioskId: input.kioskId,
      date: input.date,
      actor: cashClosureActor(context),
    });
    return NextResponse.json({
      closure: result.closure,
      lines: result.lines,
      created: result.created,
      sourceChanged: result.sourceChanged,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao sincronizar o fechamento.";
    const status = message.includes("permissão") ? 403 : message.includes("não encontrada") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
