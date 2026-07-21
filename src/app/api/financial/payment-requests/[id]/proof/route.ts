import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "firebase-admin/storage";
import { requireUser } from "@/lib/auth-server";
import { getPaymentRequest } from "@/features/financial/payment-requests/repository.server";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && !actor.permissions.financial?.paymentRequests?.viewProof) return NextResponse.json({ error: "Sem permissão para visualizar comprovantes." }, { status: 403 });
    const { id } = await context.params;
    const payment = await getPaymentRequest(id);
    if (!payment.proofStoragePath) return NextResponse.json({ error: "Comprovante ainda não disponível." }, { status: 404 });
    const [contents] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(payment.proofStoragePath).download();
    return new NextResponse(new Uint8Array(contents), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Comprovante de pagamento.pdf"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao abrir comprovante." }, { status: 400 }); }
}
