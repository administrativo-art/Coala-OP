import { NextRequest, NextResponse } from "next/server";

import { analyzeFinancialInboxMessage } from "@/features/financial/inbox/workflow.server";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && (
      !actor.permissions.financial?.view
      || !actor.permissions.financial?.inbox?.view
      || !actor.permissions.financial?.inbox?.analyze
    )) {
      return NextResponse.json({ error: "Sem permissão para analisar cobranças recebidas." }, { status: 403 });
    }
    const { id } = await context.params;
    const message = await analyzeFinancialInboxMessage(id, actor.workspace_id);
    return NextResponse.json({ message }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao analisar a cobrança." }, { status: 400 });
  }
}
