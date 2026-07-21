import { NextRequest, NextResponse } from "next/server";

import { assertFormalizationAccess } from "@/features/hr/lib/server-access";
import { analyzeCompanyDocumentWithAi } from "@/lib/documents/company-document-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    await assertFormalizationAccess(request, "companyDocuments.manage");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return error("Selecione o arquivo para análise.");
    if (!ALLOWED_MIME_TYPES.has(file.type) || file.size > MAX_BYTES) {
      return error("Envie PDF, JPG ou PNG de até 10 MB.");
    }
    const analysis = await analyzeCompanyDocumentWithAi({ file });
    return NextResponse.json({ analysis });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao analisar documento.", 403);
  }
}
