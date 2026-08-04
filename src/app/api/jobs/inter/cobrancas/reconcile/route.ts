import { NextRequest, NextResponse } from "next/server";

import { WORKSPACE_ID } from "@/lib/workspace";
import { reconcileInterCobrancas, verifyInterWebhookSecret } from "@/features/financial/cash-deposits/inter-service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!verifyInterWebhookSecret(provided, process.env.INTER_RECONCILIATION_SECRET?.trim())) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const results = await reconcileInterCobrancas({ workspaceId: WORKSPACE_ID, limit: 200 });
  return NextResponse.json({ ok: true, checked: results.length, results });
}
