import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import {
  assertCashClosureAccess,
  cashClosureActor,
  cashClosureSeniorDivergenceCents,
} from "@/features/financial/cash-closures/access.server";
import { getCashClosure, saveCashClosureDraft } from "@/features/financial/cash-closures/repository.server";
import { saveCashClosureDraftSchema } from "@/features/financial/cash-closures/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ closureId: string }> };

async function loadAuthorized(request: NextRequest, routeContext: RouteContext, permission: "view" | "edit") {
  const context = await requireUser(request);
  const { closureId } = await routeContext.params;
  const result = await getCashClosure(closureId);
  if (!result) throw new Error("Fechamento não encontrado.");
  assertCashClosureAccess(context, permission, result.closure.kioskId);
  return { context, closureId, result };
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  try {
    const { result } = await loadAuthorized(request, routeContext, "view");
    return NextResponse.json({
      ...result,
      settings: { seniorDivergenceCents: cashClosureSeniorDivergenceCents() },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar fechamento.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : message.includes("não encontrado") ? 404 : 400 });
  }
}

export async function PATCH(request: NextRequest, routeContext: RouteContext) {
  try {
    const { context, closureId } = await loadAuthorized(request, routeContext, "edit");
    const input = saveCashClosureDraftSchema.parse(await request.json());
    return NextResponse.json(await saveCashClosureDraft(closureId, input.lines, cashClosureActor(context)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao salvar fechamento.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : message.includes("não encontrado") ? 404 : 400 });
  }
}
