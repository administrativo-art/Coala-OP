import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { assertHrAccess } from "@/features/hr/lib/server-access";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { canAccessDocument } from "@/lib/hr/employee-document-access";
import { assertEmployeeUnitAccess, buildEmployeeDocumentAccessSubject, loadEmployeeDocumentAccessSettings } from "@/features/hr/lib/employee-document-access-server";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const access = await assertHrAccess(request, "view");
    const { id, action = "view" } = await request.json();
    const ref = hrDbAdmin.collection("employeeDocuments").doc(String(id ?? ""));
    const snap = await ref.get();
    if (!snap.exists || snap.get("deletedAt")) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
    await assertEmployeeUnitAccess(access, String(snap.get("employeeId") ?? ""));

    // Enforce a política de sigilo do documento no backend (nunca no cliente).
    const accessSettings = await loadEmployeeDocumentAccessSettings(access);
    const subject = buildEmployeeDocumentAccessSubject(access, accessSettings, String(snap.get("employeeId") ?? ""));
    const { allowed, policy } = canAccessDocument(
      { documentTypeCode: snap.get("documentTypeCode"), category: snap.get("category"), accessLevel: snap.get("accessLevel") },
      subject,
      accessSettings.visibilityConfig,
    );
    if (!allowed) {
      await ref.collection("audit").add({
        action: "ACCESS_DENIED",
        actorId: access.decoded.uid,
        actorName: access.actorName,
        policy,
        requestedAction: action === "download" ? "download" : "view",
        at: Timestamp.now(),
      });
      return NextResponse.json({ error: "Você não tem autorização para acessar este documento." }, { status: 403 });
    }

    const path = snap.get("storagePath");
    if (typeof path !== "string") return NextResponse.json({ error: "Arquivo indisponível." }, { status: 404 });
    let contents: Buffer;
    try {
      [contents] = await getStorage(adminApp)
        .bucket(firebaseClientConfig.storageBucket)
        .file(path)
        .download();
    } catch (cause) {
      console.error("[employee-documents/access] Falha ao ler arquivo privado.", cause);
      return NextResponse.json(
        { error: "Não foi possível abrir o arquivo agora. Tente novamente em instantes." },
        { status: 503 },
      );
    }
    const at = Timestamp.now();
    await Promise.all([
      ref.update({ accessCount: FieldValue.increment(1), lastAccessedAt: at }),
      ref.collection("audit").add({ action: action === "download" ? "downloaded" : "viewed", actorId: access.decoded.uid, actorName: access.actorName, at }),
    ]);
    const originalName = String(snap.get("originalName") || "documento");
    const safeName = originalName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    const disposition = action === "download" ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(contents), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `${disposition}; filename="${safeName}"`,
        "Content-Type": String(snap.get("mimeType") || "application/octet-stream"),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (cause) {
    console.error("[employee-documents/access] Acesso negado.", cause);
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }
}
