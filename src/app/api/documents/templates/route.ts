import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { SYSTEM_DOCUMENT_TEMPLATES } from "@/features/hr/documents/system-template-catalog";
import { effectiveSystemDocumentTemplates } from "@/features/hr/documents/document-template-workflow.server";
import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { dbAdmin } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLLECTION = "companyDocumentTemplates";

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function serializedObject(value: unknown): Record<string, unknown> {
  const serialized = serializeHrValue(value);
  return serialized && typeof serialized === "object" && !Array.isArray(serialized)
    ? serialized as Record<string, unknown>
    : {};
}

export async function GET(request: NextRequest) {
  try {
    await assertFormalizationAccess(request, "templates.view");
    const snap = await dbAdmin.collection(COLLECTION).get();
    const storedTemplates = snap.docs
      .filter((doc) => !doc.get("deletedAt"))
      .map((doc): Record<string, unknown> & { id: string } => ({
        id: doc.id,
        ...serializedObject(doc.data()),
        previewUrl: `/api/documents/templates/${doc.id}/preview`,
        downloadUrl: `/api/documents/templates/${doc.id}/source`,
      }));
    const systemTemplates = await effectiveSystemDocumentTemplates(SYSTEM_DOCUMENT_TEMPLATES);
    const templates = [...systemTemplates, ...storedTemplates]
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
    return NextResponse.json({ templates });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Acesso negado.", 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await assertFormalizationAccess(request, "templates.manage");
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
    const category = typeof body.category === "string" ? body.category.trim().slice(0, 80) : "";
    if (!name || !category) return error("Informe o nome e a categoria do modelo.");
    const id = randomUUID();
    const now = Timestamp.now();
    const payload = {
      name,
      category,
      status: "draft",
      preparationStatus: "ai_mapping",
      version: 1,
      content: null,
      variables: [],
      letterheadProfileId: "coala-letterhead-v2",
      retentionPolicyId: "employment_plus_5y",
      signatureScope: "none",
      createdBy: access.decoded.uid,
      createdByName: access.actorName,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await dbAdmin.collection(COLLECTION).doc(id).set(payload);
    return NextResponse.json({ template: { id, ...serializedObject(payload) } }, { status: 201 });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao criar modelo.", 403);
  }
}
