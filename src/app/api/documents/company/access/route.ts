import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { assertFormalizationAccess } from "@/features/hr/lib/server-access";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const access = await assertFormalizationAccess(request, "companyDocuments.view");
    const { id, action = "view" } = await request.json();
    const ref = dbAdmin.collection("companyDocuments").doc(String(id ?? ""));
    const snap = await ref.get();
    if (!snap.exists || snap.get("deletedAt")) {
      return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
    }
    const storagePath = snap.get("storagePath");
    if (typeof storagePath !== "string") {
      return NextResponse.json({ error: "Arquivo indisponível." }, { status: 404 });
    }
    const [contents] = await getStorage(adminApp)
      .bucket(firebaseClientConfig.storageBucket)
      .file(storagePath)
      .download();
    const now = Timestamp.now();
    await Promise.all([
      ref.update({ accessCount: FieldValue.increment(1), lastAccessedAt: now }),
      ref.collection("audit").add({
        action: action === "download" ? "DOCUMENT_DOWNLOADED" : "DOCUMENT_VIEWED",
        actorId: access.decoded.uid,
        actorName: access.actorName,
        at: now,
      }),
    ]);
    const safeName = String(snap.get("standardizedName") || snap.get("originalName") || "documento")
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\]/g, "_");
    return new NextResponse(new Uint8Array(contents), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `${action === "download" ? "attachment" : "inline"}; filename="${safeName}"`,
        "Content-Type": String(snap.get("mimeType") || "application/octet-stream"),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (cause) {
    console.error("[company-documents/access] Acesso negado.", cause);
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }
}
