import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "firebase-admin/storage";

import { assertFormalizationAccess } from "@/features/hr/lib/server-access";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await assertFormalizationAccess(request, "documents.view");
    const { id } = await context.params;
    const document = await dbAdmin.collection("generatedDocuments").doc(id).get();
    if (!document.exists) return error("Documento gerado não encontrado.", 404);
    const { searchParams } = new URL(request.url);
    const wantsPdf = searchParams.get("format") === "pdf";
    const storagePath = wantsPdf ? document.get("pdfStoragePath") : document.get("storagePath");
    if (typeof storagePath !== "string" || !storagePath) {
      return error(wantsPdf ? "PDF indisponível para este documento." : "Arquivo indisponível.", 404);
    }
    const [buffer] = await getStorage(adminApp)
      .bucket(firebaseClientConfig.storageBucket)
      .file(storagePath)
      .download();
    const fileName = String(document.get("originalName") ?? "documento.docx");
    return new NextResponse(new Uint8Array(buffer), {
      headers: wantsPdf
        ? { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${fileName.replace(/\.docx$/i, ".pdf")}"`, "Cache-Control": "private, no-store" }
        : { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${fileName}"`, "Cache-Control": "private, no-store" },
    });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao baixar documento.", 403);
  }
}
