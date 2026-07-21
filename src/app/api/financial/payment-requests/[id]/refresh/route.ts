import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { refreshPaymentRequest } from "@/features/financial/payment-requests/service.server";

export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && !actor.permissions.financial?.paymentRequests?.refresh) return NextResponse.json({ error: "Sem permissão para consultar o banco." }, { status: 403 });
    const { id } = await context.params;
    return NextResponse.json({ request: await refreshPaymentRequest(id, { uid: actor.decoded.uid, email: actor.decoded.email, name: actor.userDoc.username }) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao consultar o banco." }, { status: 400 }); }
}
