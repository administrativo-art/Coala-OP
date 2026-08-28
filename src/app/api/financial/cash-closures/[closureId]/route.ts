import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import {
  assertCashClosureAccess,
  canUseCashClosure,
  cashClosureActor,
  cashClosureSeniorDivergenceCents,
} from "@/features/financial/cash-closures/access.server";
import { resolveOperatorAvatarUrls } from "@/features/financial/cash-closures/operator-avatars";
import {
  getCashClosure,
  saveCashClosureDraft,
} from "@/features/financial/cash-closures/repository.server";
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
    const usersSnapshot = await dbAdmin.collection("users")
      .select("username", "avatarUrl", "pdvOperatorIds", "registrationIdPdv")
      .get();
    const operatorAvatars = resolveOperatorAvatarUrls({
      kioskId: result.closure.kioskId,
      operators: Array.from(new Map(
        result.lines.map((line) => [line.operatorId, { id: line.operatorId, name: line.operatorName }]),
      ).values()),
      users: usersSnapshot.docs.map((document) => document.data()),
    });
    return NextResponse.json({
      ...result,
      operatorAvatars,
      settings: { seniorDivergenceCents: cashClosureSeniorDivergenceCents() },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar fechamento.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : message.includes("não encontrado") ? 404 : 400 });
  }
}

export async function PATCH(request: NextRequest, routeContext: RouteContext) {
  try {
    const { context, closureId, result } = await loadAuthorized(request, routeContext, "view");
    const input = saveCashClosureDraftSchema.parse(await request.json());
    const editReported = canUseCashClosure(context, "edit", result.closure.kioskId);
    if (!editReported) {
      throw new Error("Sem permissão para editar este fechamento de caixa.");
    }
    return NextResponse.json(await saveCashClosureDraft(
      closureId,
      input.lines,
      cashClosureActor(context),
      { editReported, editCounted: false },
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao salvar fechamento.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : message.includes("não encontrado") ? 404 : 400 });
  }
}
