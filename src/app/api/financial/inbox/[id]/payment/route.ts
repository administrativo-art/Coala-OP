import { NextRequest, NextResponse } from "next/server";
import { createInboxBarcodePaymentRequest } from "@/features/financial/payment-requests/service.server";
import { inboxBarcodePaymentPreparationSchema } from "@/features/financial/payment-requests/inbox-barcode";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && (
      !actor.permissions.financial?.view
      || !actor.permissions.financial?.inbox?.view
      || !actor.permissions.financial?.expenses?.edit
      || !actor.permissions.financial?.paymentRequests?.view
      || !actor.permissions.financial?.paymentRequests?.create
    )) {
      return NextResponse.json({ error: "Sem permissão para preparar pagamentos bancários." }, { status: 403 });
    }
    const { id } = await context.params;
    const input = inboxBarcodePaymentPreparationSchema.parse(await request.json());
    const paymentRequest = await createInboxBarcodePaymentRequest({ inboxMessageId: id, workspaceId: actor.workspace_id, ...input }, {
      uid: actor.decoded.uid,
      email: actor.decoded.email,
      name: actor.userDoc.username,
    });
    return NextResponse.json({ request: paymentRequest }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao preparar o pagamento." }, { status: 400 });
  }
}
