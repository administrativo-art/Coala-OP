import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashDepositAccess } from "@/features/financial/cash-closures/access.server";
import { getCashDepositBatch } from "@/features/financial/cash-deposits/repository.server";
import { getInterCobrancaPdfForBatch } from "@/features/financial/cash-deposits/inter-service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, routeContext: { params: Promise<{ batchId: string }> }) {
  try {
    const context = await requireUser(request);
    const { batchId } = await routeContext.params;
    const current = await getCashDepositBatch(batchId);
    if (!current) throw new Error("Bloco não encontrado.");
    assertCashDepositAccess(context, "view", current.batch.kioskId);
    const pdf = await getInterCobrancaPdfForBatch({ workspaceId: context.workspace_id, batchId });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="deposito-${batchId.replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf"`,
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao baixar PDF.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
