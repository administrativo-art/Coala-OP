import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { inspectStoredDocumentTemplateIntegrity } from "@/features/hr/documents/document-template-integrity.server";
import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { dbAdmin } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const access = await assertFormalizationAccess(request, "templates.manage");
    const { id } = await context.params;
    const reference = dbAdmin.collection("companyDocumentTemplates").doc(id);
    const document = await reference.get();
    if (!document.exists || document.get("deletedAt")) {
      return NextResponse.json({ error: "Modelo não encontrado." }, { status: 404 });
    }
    const integrity = await inspectStoredDocumentTemplateIntegrity(document);
    await reference.set({
      sourceIntegrity: integrity,
      sourceIntegrityCheckedAt: Timestamp.now(),
      sourceIntegrityCheckedBy: access.decoded.uid,
      sourceIntegrityCheckedByName: access.actorName,
    }, { merge: true });
    return NextResponse.json({ integrity: serializeHrValue(integrity) });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Falha ao reverificar o DOCX." },
      { status: 400 },
    );
  }
}
