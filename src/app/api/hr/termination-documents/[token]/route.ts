import { getStorage } from "firebase-admin/storage";
import { NextRequest, NextResponse } from "next/server";

import { getTerminationByEmployeeDeliveryToken } from "@/features/hr/termination/server";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeName(value: string) {
  return value.replace(/["\r\n]/g, "-");
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const token = (await params).token;
    const process = await getTerminationByEmployeeDeliveryToken(token);
    const documentId = request.nextUrl.searchParams.get("documentId");
    const wantsProof = request.nextUrl.searchParams.get("paymentProof") === "1";
    const visibleDocuments = process.documents.filter((document) =>
      document.isCurrent !== false
      && document.visibility === "employee"
      && document.auditStatus === "approved"
      && (document.selectedForEmployee === true || ["resignation_letter", "request_confirmation", "dismissal_notice"].includes(document.type))
    );

    if (documentId || wantsProof) {
      const document = documentId ? visibleDocuments.find((item) => item.id === documentId) : null;
      const storagePath = document?.storagePath ?? (wantsProof ? process.payment?.proofStoragePath : null);
      if (!storagePath) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 });
      const [buffer] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).download();
      const fileName = document?.fileName ?? `comprovante-pagamento-${process.request.protocol}.pdf`;
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": document?.mimeType ?? "application/pdf",
          "Content-Disposition": `inline; filename="${safeName(fileName)}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    return NextResponse.json({
      process: {
        employeeName: process.employeeName,
        protocol: process.request.protocol,
        unitName: process.unitName,
        contractEndDate: process.notice?.contractEndDate ?? null,
        payment: {
          status: process.payment?.status ?? "not_started",
          amount: process.payment?.amount ?? null,
          paidAt: process.payment?.paidAt ?? null,
          proofAvailable: Boolean(process.payment?.proofStoragePath),
        },
        documents: visibleDocuments.map((document) => ({ id: document.id, label: document.label, fileName: document.fileName })),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao abrir os documentos." }, { status: 400 });
  }
}
