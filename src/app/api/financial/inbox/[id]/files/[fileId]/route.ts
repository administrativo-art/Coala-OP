import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "firebase-admin/storage";

import { getFinancialInboxMessage } from "@/features/financial/inbox/repository.server";
import { requireUser } from "@/lib/auth-server";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const runtime = "nodejs";

function downloadName(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "arquivo";
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && (!actor.permissions.financial?.view || !actor.permissions.financial?.expenses?.view)) {
      return NextResponse.json({ error: "Sem permissão para visualizar documentos financeiros." }, { status: 403 });
    }
    const { id, fileId } = await context.params;
    const message = await getFinancialInboxMessage(id);
    if (message.workspaceId !== actor.workspace_id) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });

    const isRaw = fileId === "raw";
    const attachment = isRaw ? null : message.attachments.find((item) => item.id === fileId);
    const storagePath = isRaw ? message.rawStoragePath : attachment?.storagePath;
    if (!storagePath) return NextResponse.json({ error: "Arquivo não foi arquivado." }, { status: 404 });
    const [contents] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).download();
    const contentType = isRaw ? "message/rfc822" : attachment?.contentType || "application/octet-stream";
    const filename = downloadName(isRaw ? `${message.subject || "email-original"}.eml` : attachment?.filename || "arquivo");
    const disposition = contentType === "application/pdf" || contentType.startsWith("image/") ? "inline" : "attachment";
    return new NextResponse(new Uint8Array(contents), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${disposition}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao abrir o documento." }, { status: 400 });
  }
}
