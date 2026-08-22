import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { registerReportedPaymentSchema } from "@/features/financial/obligations/schemas";
import { registerReportedPayment } from "@/features/financial/obligations/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ expenseId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireUser(request);
    if (
      !actor.isDefaultAdmin
      && (!actor.permissions.financial?.view || !actor.permissions.financial?.expenses?.pay)
    ) {
      return NextResponse.json({ error: "Sem permissão para registrar pagamentos." }, { status: 403 });
    }
    const { expenseId } = await context.params;
    const input = registerReportedPaymentSchema.parse(await request.json());
    const result = await registerReportedPayment(expenseId, input, {
      uid: actor.decoded.uid,
      name: actor.userDoc.username,
      email: actor.decoded.email,
    });
    return NextResponse.json(result, {
      status: result.idempotent ? 200 : 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao registrar pagamento.";
    return NextResponse.json(
      { error: message },
      { status: message.includes("permissão") ? 403 : message.includes("não encontrada") ? 404 : 400 },
    );
  }
}
