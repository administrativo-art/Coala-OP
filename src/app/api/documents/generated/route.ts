import { NextRequest, NextResponse } from "next/server";

import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { dbAdmin } from "@/lib/firebase-admin";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const access = await assertFormalizationAccess(request, "documents.view");
    const includeSensitive = hasFormalizationPermission(
      access.permissions,
      "sensitiveData.view",
      access.isDefaultAdmin,
    );
    const includeSignatureContacts = includeSensitive || hasFormalizationPermission(
      access.permissions,
      "signatures.send",
      access.isDefaultAdmin,
    );
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId")?.trim();
    const templateId = searchParams.get("templateId")?.trim();
    const includeDiscarded = searchParams.get("includeDiscarded") === "true";
    let query: FirebaseFirestore.Query = dbAdmin.collection("generatedDocuments");
    if (employeeId) query = query.where("employeeId", "==", employeeId);
    if (templateId) query = query.where("templateId", "==", templateId);
    const snap = await query.limit(300).get();
    const documents = snap.docs
      .filter((doc) => includeDiscarded || doc.get("status") !== "discarded")
      .map((doc): Record<string, unknown> & { id: string } => {
        const data = serializeHrValue(doc.data());
        const record = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
        // Caminhos internos nunca saem. Valores manuais só são devolvidos a quem
        // possui a mesma permissão exigida para visualizar dados sensíveis.
        return {
          ...record,
          id: doc.id,
          storagePath: undefined,
          pdfAvailable: !!record.pdfStoragePath,
          pdfStoragePath: undefined,
          manualValues: includeSensitive ? record.manualValues : undefined,
          parties: Array.isArray(record.parties)
            ? record.parties.map((party) => {
                const item = party && typeof party === "object" && !Array.isArray(party)
                  ? party as Record<string, unknown>
                  : {};
                const snapshot = item.snapshot && typeof item.snapshot === "object" && !Array.isArray(item.snapshot)
                  ? item.snapshot as Record<string, unknown>
                  : {};
                return {
                  ...item,
                  snapshot: {
                    ...snapshot,
                    signatureEmail: includeSignatureContacts
                      ? snapshot.signatureEmail ?? null
                      : undefined,
                  },
                };
              })
            : [],
        };
      })
      .sort((a, b) => String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")));
    return NextResponse.json({ documents });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Acesso negado.", 403);
  }
}
