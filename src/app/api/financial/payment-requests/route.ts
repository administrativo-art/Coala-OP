import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { createPaymentRequestSchema } from "@/features/financial/payment-requests/schemas";
import { createPaymentRequest } from "@/features/financial/payment-requests/service.server";
import { listPaymentRequests } from "@/features/financial/payment-requests/repository.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && (!actor.permissions.financial?.view || !actor.permissions.financial?.paymentRequests?.view)) {
      return NextResponse.json({ error: "Sem permissão para visualizar solicitações de pagamento." }, { status: 403 });
    }
    return NextResponse.json({ requests: await listPaymentRequests() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao carregar solicitações." }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && (!actor.permissions.financial?.view || !actor.permissions.financial?.paymentRequests?.create)) {
      return NextResponse.json({ error: "Sem permissão para criar solicitações de pagamento." }, { status: 403 });
    }
    const input = createPaymentRequestSchema.parse(await request.json());
    if (input.sourceType === "aso") return NextResponse.json({ error: "Pagamentos de ASO só podem ser criados pelo fluxo protegido da integração." }, { status: 403 });
    const created = await createPaymentRequest(input, { uid: actor.decoded.uid, email: actor.decoded.email, name: actor.userDoc.username });
    return NextResponse.json({ request: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao criar solicitação." }, { status: 400 });
  }
}
