import { NextRequest, NextResponse } from "next/server";

import { loadSystemTemplateSource } from "@/features/hr/documents/system-template-preview.server";
import { systemDocumentTemplateById } from "@/features/hr/documents/system-template-catalog";
import { assertFormalizationAccess } from "@/features/hr/lib/server-access";

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
    if (!template || template.sourceFormat !== "docx" || !template.sourcePath) {
      return NextResponse.json({ error: "Arquivo de origem não encontrado." }, { status: 404 });
    }
    const source = await loadSystemTemplateSource(template);
    return new NextResponse(new Uint8Array(source), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeFileName(template.name)}-v${template.version}.docx"`,
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
