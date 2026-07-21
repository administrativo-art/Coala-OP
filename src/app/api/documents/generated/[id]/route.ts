import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function serialized(id: string, data: unknown) {
  const record = serializeHrValue(data);
  const value = record && typeof record === "object" && !Array.isArray(record) ? record as Record<string, unknown> : {};
  return { id, ...value, storagePath: undefined, pdfAvailable: !!value.pdfStoragePath, pdfStoragePath: undefined };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await assertFormalizationAccess(request, "documents.review");
    const { id } = await context.params;
    const reference = dbAdmin.collection("generatedDocuments").doc(id);
    const document = await reference.get();
    if (!document.exists) return error("Documento gerado não encontrado.", 404);
    const body = await request.json().catch(() => ({}));
    if (body.status !== "final") return error("Apenas a finalização é suportada.");
    if (document.get("status") === "final") return NextResponse.json({ document: serialized(id, document.data()) });
    const update = {
      status: "final",
      finalizedAt: Timestamp.now(),
      finalizedBy: access.decoded.uid,
      finalizedByName: access.actorName,
    };
    await reference.update(update);
    return NextResponse.json({ document: serialized(id, { ...document.data(), ...update }) });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao finalizar documento.", 403);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await assertFormalizationAccess(request, "documents.review");
    const { id } = await context.params;
    const reference = dbAdmin.collection("generatedDocuments").doc(id);
    const document = await reference.get();
    if (!document.exists) return error("Documento gerado não encontrado.", 404);
    if (document.get("status") === "final") return error("Documento finalizado não pode ser descartado.");
    const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
    const paths = [document.get("storagePath"), document.get("pdfStoragePath")].filter(
      (path): path is string => typeof path === "string" && !!path,
    );
    await Promise.all(paths.map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
    await reference.delete();
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao descartar documento.", 403);
  }
}
