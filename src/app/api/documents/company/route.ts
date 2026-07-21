import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { COMPANY_DOCUMENT_CATEGORIES, isCompanyDocumentCategory } from "@/lib/documents/company-document-categories";
import { buildStandardizedFileName } from "@/lib/documents/company-document-naming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLLECTION = "companyDocuments";
const MAX_BYTES = 10 * 1024 * 1024;
const MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function cleanText(value: FormDataEntryValue | null, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function serializedObject(value: unknown): Record<string, unknown> {
  const serialized = serializeHrValue(value);
  return serialized && typeof serialized === "object" && !Array.isArray(serialized)
    ? serialized as Record<string, unknown>
    : {};
}

export async function GET(request: NextRequest) {
  try {
    await assertFormalizationAccess(request, "companyDocuments.view");
    const snap = await dbAdmin.collection(COLLECTION).get();
    const documents = snap.docs
      .filter((doc) => !doc.get("deletedAt"))
      .map((doc): Record<string, unknown> & { id: string } => ({ id: doc.id, ...serializedObject(doc.data()) }))
      .sort((a, b) => String(b.uploadedAt ?? "").localeCompare(String(a.uploadedAt ?? "")));
    return NextResponse.json({ documents });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Acesso negado.", 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await assertFormalizationAccess(request, "companyDocuments.manage");
    const form = await request.formData();
    const file = form.get("file");
    const title = cleanText(form.get("title"));
    const category = cleanText(form.get("category"), 80);
    const unit = cleanText(form.get("unit"), 120);
    const expiresAt = cleanText(form.get("expiresAt"), 20) || null;

    if (!(file instanceof File) || !title || !category) {
      return error("Informe o título, a categoria e selecione o arquivo.");
    }
    if (!isCompanyDocumentCategory(category)) {
      return error(`Categoria inválida. Use uma das opções: ${COMPANY_DOCUMENT_CATEGORIES.join(", ")}.`);
    }
    const extension = MIME_TYPES[file.type];
    if (!extension || file.size > MAX_BYTES) {
      return error("Envie PDF, JPG ou PNG de até 10 MB.");
    }

    const id = randomUUID();
    const buffer = Buffer.from(await file.arrayBuffer());
    const contentHash = createHash("sha256").update(buffer).digest("hex");
    const storagePath = `company-documents/${id}/versions/01/original.${extension}`;

    await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(buffer, {
      resumable: false,
      metadata: {
        contentType: file.type,
        cacheControl: "private, max-age=0, no-store",
        metadata: { documentId: id, domain: "company" },
      },
    });

    const now = Timestamp.now();
    const standardizedName = buildStandardizedFileName({ category, title, uploadedAt: now.toDate(), extension });
    const payload = {
      title,
      category,
      unit: unit || null,
      status: "active",
      expiresAt,
      originalName: file.name.slice(0, 180),
      standardizedName,
      mimeType: file.type,
      size: file.size,
      contentHash,
      hashAlgorithm: "sha256",
      version: 1,
      storagePath,
      uploadedBy: access.decoded.uid,
      uploadedByName: access.actorName,
      uploadedAt: now,
      updatedAt: now,
      accessCount: 0,
      deletedAt: null,
    };
    const ref = dbAdmin.collection(COLLECTION).doc(id);
    await ref.set(payload);
    await ref.collection("audit").add({
      action: "DOCUMENT_UPLOADED",
      actorId: access.decoded.uid,
      actorName: access.actorName,
      at: now,
    });
    return NextResponse.json({ document: { id, ...serializedObject(payload) } }, { status: 201 });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao anexar documento.", 403);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const access = await assertFormalizationAccess(request, "companyDocuments.manage");
    const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";
    const ref = dbAdmin.collection(COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.get("deletedAt")) return error("Documento não encontrado.", 404);
    const storagePath = snap.get("storagePath");
    if (typeof storagePath === "string") {
      await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).delete({ ignoreNotFound: true });
    }
    const now = Timestamp.now();
    await ref.update({
      deletedAt: now,
      deletedBy: access.decoded.uid,
      storagePath: FieldValue.delete(),
      updatedAt: now,
    });
    await ref.collection("audit").add({
      action: "DOCUMENT_DELETED",
      actorId: access.decoded.uid,
      actorName: access.actorName,
      at: now,
    });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao excluir documento.", 403);
  }
}
