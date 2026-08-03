import { getStorage } from "firebase-admin/storage";
import { NextRequest, NextResponse } from "next/server";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { assertTerminationVisible, getTermination, terminationContext } from "@/features/hr/termination/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await terminationContext(request);
    const process = await getTermination((await params).id);
    if (!process) return NextResponse.json({ error: "Desligamento não encontrado." }, { status: 404 });
    await assertTerminationVisible(context, process);
    if (request.nextUrl.searchParams.get("paymentProof") === "1") {
      if (!process.payment?.proofStoragePath) return NextResponse.json({ error: "Comprovante ainda não disponível." }, { status: 404 });
      const [buffer] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(process.payment.proofStoragePath).download();
      return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="comprovante-${process.request.protocol}.pdf"`, "Cache-Control": "private, no-store" } });
    }
    const document = process.documents.find((item) => item.id === request.nextUrl.searchParams.get("documentId"));
    if (!document) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
    if (process.employeeId === context.userDoc.id && document.visibility !== "employee") return NextResponse.json({ error: "Sem acesso ao documento." }, { status: 403 });
    const [buffer] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(document.storagePath).download();
    return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": document.mimeType, "Content-Disposition": `inline; filename="${document.fileName.replace(/["\r\n]/g, "-")}"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao abrir documento." }, { status: 400 }); }
}
