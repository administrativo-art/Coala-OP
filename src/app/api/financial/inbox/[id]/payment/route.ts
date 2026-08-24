import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createInboxBarcodePaymentRequest } from "@/features/financial/payment-requests/service.server";
import { requireUser } from "@/lib/auth-server";

const schema = z.object({
  scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  barcode: z.string().trim().max(80).optional(),
});

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
    const input = schema.parse(await request.json());
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
