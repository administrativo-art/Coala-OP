import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { canAccessUnit } from "@/lib/unit-access";
import { assertCashClosureAccess } from "@/features/financial/cash-closures/access.server";
import { listCashClosures } from "@/features/financial/cash-closures/repository.server";
import { cashClosureListQuerySchema } from "@/features/financial/cash-closures/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    assertCashClosureAccess(context, "view");
    const parsed = cashClosureListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    if (parsed.kioskId) assertCashClosureAccess(context, "view", parsed.kioskId);
    const closures = await listCashClosures({
      workspaceId: context.workspace_id,
      ...parsed,
    });
    const visible = closures.filter((closure) =>
      canAccessUnit(context.userDoc, closure.kioskId, { isDefaultAdmin: context.isDefaultAdmin }),
    );
    return NextResponse.json({ closures: visible }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao listar fechamentos.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
