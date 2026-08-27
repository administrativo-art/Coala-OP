import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "firebase-admin/storage";

import {
  renderSystemDocumentTemplatePreview,
  SystemTemplatePreviewUnavailableError,
} from "@/features/hr/documents/system-template-preview.server";
import { extractDocxVariables, generateDocx } from "@/features/hr/documents/docx-generator";
import { buildDocumentTemplateDemoData } from "@/features/hr/documents/document-template-demo-data";
import { stampDocumentTemplateDemoPreview } from "@/features/hr/documents/document-template-demo-preview.server";
import { normalizeFieldMapping } from "@/features/hr/documents/field-mapping";
import { convertDocxToPdf } from "@/features/hr/documents/pdf-converter.server";
import { applyCoalaLetterheadToPdf } from "@/features/hr/documents/letterhead-pdf.server";
import { systemDocumentTemplateById } from "@/features/hr/documents/system-template-catalog";
import { assertFormalizationAccess } from "@/features/hr/lib/server-access";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await assertFormalizationAccess(request, "templates.view");
  } catch (cause) {
    return NextResponse.json({
      error: cause instanceof Error ? cause.message : "Acesso negado.",
    }, { status: 403 });
  }
  try {
    const { id } = await context.params;
    const template = systemDocumentTemplateById(id);
    let pdf: Buffer;
    if (template) {
      pdf = await renderSystemDocumentTemplatePreview(template);
    } else {
      const stored = await dbAdmin.collection("companyDocumentTemplates").doc(id).get();
      const storagePath = stored.get("storagePath");
      if (!stored.exists || stored.get("deletedAt") || typeof storagePath !== "string") {
        return NextResponse.json({ error: "Prévia do modelo não encontrada." }, { status: 404 });
      }
      const [source] = await getStorage(adminApp)
        .bucket(firebaseClientConfig.storageBucket)
        .file(storagePath)
        .download();
      const variables = extractDocxVariables(source);
      const demoDocx = generateDocx(source, buildDocumentTemplateDemoData({
        variables,
        fieldMapping: normalizeFieldMapping(stored.get("fieldMapping"), variables),
      }));
      const converted = await convertDocxToPdf(demoDocx);
      if (!converted) {
        throw new SystemTemplatePreviewUnavailableError(
          "A prévia em PDF não está disponível neste ambiente. Baixe o arquivo Word original.",
        );
      }
      pdf = await stampDocumentTemplateDemoPreview(
        await applyCoalaLetterheadToPdf(converted),
      );
    }
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${id}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Document-Preview-Mode": "fictional-demo",
      },
    });
  } catch (cause) {
    if (cause instanceof SystemTemplatePreviewUnavailableError) {
      return NextResponse.json({ error: cause.message }, { status: 503 });
    }
    console.error("[document-template-preview] Falha ao renderizar prévia:", cause);
    return NextResponse.json({
      error: "A prévia deste modelo não pôde ser gerada agora. Tente novamente.",
    }, { status: 500 });
  }
}
