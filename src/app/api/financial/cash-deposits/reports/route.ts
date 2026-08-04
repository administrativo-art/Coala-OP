import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashDepositAccess } from "@/features/financial/cash-closures/access.server";
import { buildCashDepositReport } from "@/features/financial/cash-deposits/reports.server";
import { canAccessUnit } from "@/lib/unit-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    assertCashDepositAccess(context, "view");
    const report = await buildCashDepositReport(
      context.workspace_id,
      (kioskId) => canAccessUnit(context.userDoc, kioskId, { isDefaultAdmin: context.isDefaultAdmin }),
    );
    return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao gerar relatório.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
