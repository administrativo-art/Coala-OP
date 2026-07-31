import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "firebase-admin/storage";

import { extractDocumentTemplateTextBlocks } from "@/features/hr/documents/document-template-text";
import { loadSystemTemplateSource } from "@/features/hr/documents/system-template-preview.server";
import { systemDocumentTemplateById } from "@/features/hr/documents/system-template-catalog";
import { assertFormalizationAccess } from "@/features/hr/lib/server-access";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await assertFormalizationAccess(request, "templates.view");
    const { id } = await context.params;
    const systemTemplate = systemDocumentTemplateById(id);
    let source: Buffer;
    if (systemTemplate?.sourceFormat === "docx" && systemTemplate.sourcePath) {
      source = await loadSystemTemplateSource(systemTemplate);
    } else {
      const stored = await dbAdmin.collection("companyDocumentTemplates").doc(id).get();
      const storagePath = stored.get("storagePath");
      if (!stored.exists || stored.get("deletedAt") || typeof storagePath !== "string") {
        return NextResponse.json({ error: "Texto do modelo não encontrado." }, { status: 404 });
      }
      [source] = await getStorage(adminApp)
        .bucket(firebaseClientConfig.storageBucket)
        .file(storagePath)
        .download();
    }
    const blocks = extractDocumentTemplateTextBlocks(source);
    return NextResponse.json({
      blocks,
      variableOccurrences: blocks.reduce(
        (total, block) => total + Array.from(block.text.matchAll(/\{\{[^{}]+\}\}/g)).length,
        0,
      ),
    }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (cause) {
    return NextResponse.json({
      error: cause instanceof Error ? cause.message : "Falha ao ler o texto do modelo.",
    }, { status: 403 });
  }
}
