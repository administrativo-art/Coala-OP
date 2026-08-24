import { NextRequest, NextResponse } from "next/server";

import { listFinancialInboxMessages } from "@/features/financial/inbox/repository.server";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && (!actor.permissions.financial?.view || !actor.permissions.financial?.inbox?.view)) {
      return NextResponse.json({ error: "Sem permissão para visualizar a caixa de cobranças." }, { status: 403 });
    }
    const result = await listFinancialInboxMessages({
      workspaceId: actor.workspace_id,
      status: request.nextUrl.searchParams.get("status"),
      cursor: request.nextUrl.searchParams.get("cursor"),
      limit: Number(request.nextUrl.searchParams.get("limit") || 25),
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao carregar a caixa de cobranças." }, { status: 400 });
  }
}
