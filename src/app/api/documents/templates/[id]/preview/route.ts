import { NextRequest, NextResponse } from "next/server";

import {
  renderSystemDocumentTemplatePreview,
  SystemTemplatePreviewUnavailableError,
} from "@/features/hr/documents/system-template-preview.server";
import { systemDocumentTemplateById } from "@/features/hr/documents/system-template-catalog";
import { assertFormalizationAccess } from "@/features/hr/lib/server-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await assertFormalizationAccess(request, "templates.view");
    const { id } = await context.params;
    const template = systemDocumentTemplateById(id);
    if (!template) {
      return NextResponse.json({ error: "Prévia do modelo não encontrada." }, { status: 404 });
    }
    const pdf = await renderSystemDocumentTemplatePreview(template);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${template.id}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (cause) {
    if (cause instanceof SystemTemplatePreviewUnavailableError) {
      return NextResponse.json({ error: cause.message }, { status: 503 });
    }
    return NextResponse.json({
      error: cause instanceof Error ? cause.message : "Falha ao abrir a prévia do modelo.",
    }, { status: 403 });
  }
}
