import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth-server";
import { assertCashDepositAccess, cashClosureActor } from "@/features/financial/cash-closures/access.server";
import { processCashDepositQueue } from "@/features/financial/cash-deposits/repository.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ kioskId: z.string().trim().min(1).max(120) });

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const { kioskId } = requestSchema.parse(await request.json());
    assertCashDepositAccess(context, "adjust", kioskId);
    const result = await processCashDepositQueue(
      context.workspace_id,
      kioskId,
      cashClosureActor(context),
    );
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao processar ajustes de depósito.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
