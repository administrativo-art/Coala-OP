import { NextRequest, NextResponse } from "next/server";

import { SYSTEM_DOCUMENT_TEMPLATES } from "@/features/hr/documents/system-template-catalog";
import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { dbAdmin } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await assertFormalizationAccess(request, "documents.generate");
    const snapshot = await dbAdmin.collection("companyDocumentTemplates")
      .where("status", "==", "published")
      .get();
    const stored: Array<Record<string, unknown> & {
      id: string;
      name: string;
      category: string;
    }> = snapshot.docs
      .filter((document) => !document.get("deletedAt"))
      .map((document) => {
        const serialized = serializeHrValue(document.data());
        const value = serialized && typeof serialized === "object" && !Array.isArray(serialized)
          ? serialized as Record<string, unknown>
          : {};
        return {
          id: document.id,
          ...value,
          name: String(value.name ?? "Modelo sem nome"),
          category: String(value.category ?? "Outros"),
          storagePath: undefined,
          contentHash: undefined,
        };
      });
    const templates = [
      ...SYSTEM_DOCUMENT_TEMPLATES.filter(
        (template) =>
          template.status === "published"
          && template.generationMode === "direct",
      ),
      ...stored,
    ].sort((left, right) =>
      `${left.category} ${left.name}`.localeCompare(`${right.category} ${right.name}`, "pt-BR")
    );
    return NextResponse.json({ templates });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Acesso negado." },
      { status: 403 },
    );
  }
}
