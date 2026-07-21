import { NextRequest, NextResponse } from "next/server";

import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { dbAdmin } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertFormalizationAccess(request, "documents.view");
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId")?.trim();
    const templateId = searchParams.get("templateId")?.trim();
    let query: FirebaseFirestore.Query = dbAdmin.collection("generatedDocuments");
    if (employeeId) query = query.where("employeeId", "==", employeeId);
    if (templateId) query = query.where("templateId", "==", templateId);
    const snap = await query.limit(300).get();
    const documents = snap.docs
      .map((doc): Record<string, unknown> & { id: string } => {
        const data = serializeHrValue(doc.data());
        const record = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
        // Os caminhos internos do Storage nunca saem; manualValues sai para permitir "corrigir e regerar".
        return { ...record, id: doc.id, storagePath: undefined, pdfAvailable: !!record.pdfStoragePath, pdfStoragePath: undefined };
      })
      .sort((a, b) => String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")));
    return NextResponse.json({ documents });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Acesso negado.", 403);
  }
}
