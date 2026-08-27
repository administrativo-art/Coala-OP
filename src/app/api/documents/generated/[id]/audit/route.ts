import { NextResponse, type NextRequest } from "next/server";

import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { dbAdmin } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await assertFormalizationAccess(request, "sensitiveData.view");
    const { id } = await context.params;
    const documentRef = dbAdmin.collection("generatedDocuments").doc(id);
    const [document, audit] = await Promise.all([
      documentRef.get(),
      documentRef.collection("audit").doc("resolvedValues").get(),
    ]);
    if (!document.exists) {
      return NextResponse.json({ error: "Documento gerado não encontrado." }, { status: 404 });
    }
    if (!audit.exists) {
      return NextResponse.json({ error: "Auditoria de valores não encontrada." }, { status: 404 });
    }
    return NextResponse.json({
      document: {
        id,
        templateName: document.get("templateName") ?? null,
        protocol: document.get("protocol") ?? null,
        resolvedValuesHash: document.get("resolvedValuesHash") ?? null,
        retentionUntil: serializeHrValue(document.get("retentionUntil") ?? null),
        legalHold: document.get("legalHold") === true,
      },
      audit: serializeHrValue(audit.data()),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Acesso negado." },
      { status: 403 },
    );
  }
}
