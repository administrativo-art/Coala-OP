import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashClosureAccess } from "@/features/financial/cash-closures/access.server";
import { listCashClosureMonthlySummaries } from "@/features/financial/cash-closures/summaries.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const kioskId = request.nextUrl.searchParams.get("kioskId")?.trim();
    if (!kioskId) throw new Error("Informe a unidade.");
    assertCashClosureAccess(context, "view", kioskId);
    return NextResponse.json({
      summaries: await listCashClosureMonthlySummaries(context.workspace_id, kioskId),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar meses.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
