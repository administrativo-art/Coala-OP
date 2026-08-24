import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { authorizePaymentRequest } from "@/features/financial/payment-requests/service.server";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && (
      !actor.permissions.financial?.view
      || !actor.permissions.financial?.paymentRequests?.view
      || !actor.permissions.financial?.paymentRequests?.authorize
    )) return NextResponse.json({ error: "Sem permissão para autorizar pagamentos." }, { status: 403 });
    const { id } = await context.params;
    return NextResponse.json({ request: await authorizePaymentRequest(id, { uid: actor.decoded.uid, email: actor.decoded.email, name: actor.userDoc.username }) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao autorizar." }, { status: 400 }); }
}
