import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "firebase-admin/storage";

import { loadSystemTemplateSource } from "@/features/hr/documents/system-template-preview.server";
import { systemDocumentTemplateById } from "@/features/hr/documents/system-template-catalog";
import { assertFormalizationAccess } from "@/features/hr/lib/server-access";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "modelo";
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await assertFormalizationAccess(request, "templates.view");
    const { id } = await context.params;
    const template = systemDocumentTemplateById(id);
    let source: Buffer;
    let name: string;
    let version: number;
    if (template?.sourceFormat === "docx" && template.sourcePath) {
      source = await loadSystemTemplateSource(template);
      name = template.name;
      version = template.version;
    } else {
      const stored = await dbAdmin.collection("companyDocumentTemplates").doc(id).get();
      const storagePath = stored.get("storagePath");
      if (!stored.exists || stored.get("deletedAt") || typeof storagePath !== "string") {
        return NextResponse.json({ error: "Arquivo de origem não encontrado." }, { status: 404 });
      }
      [source] = await getStorage(adminApp)
        .bucket(firebaseClientConfig.storageBucket)
        .file(storagePath)
        .download();
      name = String(stored.get("name") ?? "modelo");
      version = Number(stored.get("version") ?? 1);
    }
    return new NextResponse(new Uint8Array(source), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeFileName(name)}-v${version}.docx"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (cause) {
    return NextResponse.json({
      error: cause instanceof Error ? cause.message : "Falha ao abrir o arquivo do modelo.",
    }, { status: 403 });
  }
}
