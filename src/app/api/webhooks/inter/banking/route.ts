import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getInterConfig } from "@/lib/integrations/inter/config.server";
import { addPaymentEvent, findPaymentRequestByInterId } from "@/features/financial/payment-requests/repository.server";
import { refreshPaymentRequest } from "@/features/financial/payment-requests/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameSecret(actual: string, expected: string) {
  const left = Buffer.from(actual); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
  try {
    const secret = getInterConfig().webhookSecret;
    if (!secret || !sameSecret(request.nextUrl.searchParams.get("token") ?? request.headers.get("x-coala-webhook-token") ?? "", secret)) {
      return NextResponse.json({ error: "Webhook não autorizado." }, { status: 401 });
    }
    const body = await request.json();
    const interRequestId = String(body?.codigoSolicitacao ?? body?.transacaoPix?.codigoSolicitacao ?? "");
    if (!interRequestId) return NextResponse.json({ error: "Evento sem codigoSolicitacao." }, { status: 400 });
    const payment = await findPaymentRequestByInterId(interRequestId);
    if (!payment) return NextResponse.json({ accepted: true, matched: false });
    const eventHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    await addPaymentEvent(payment.id, "INTER_WEBHOOK_RECEIVED", "system", { interRequestId, reportedStatus: body?.status ?? null }, `webhook_${eventHash}`);
    await refreshPaymentRequest(payment.id, "system");
    return NextResponse.json({ accepted: true, matched: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha no webhook." }, { status: 400 });
  }
}
