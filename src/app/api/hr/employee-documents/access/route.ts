import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { assertHrAccess } from "@/features/hr/lib/server-access";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { canAccessDocument, subjectFromPermissions } from "@/lib/hr/employee-document-access";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const access = await assertHrAccess(request, "view");
    const { id, action = "view" } = await request.json();
    const ref = hrDbAdmin.collection("employeeDocuments").doc(String(id ?? ""));
    const snap = await ref.get();
    if (!snap.exists || snap.get("deletedAt")) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });

    // Enforce a política de sigilo do documento no backend (nunca no cliente).
    const subject = subjectFromPermissions(access.permissions, {
      isDefaultAdmin: access.isDefaultAdmin,
      isOwner: snap.get("employeeId") === access.decoded.uid,
    });
    const { allowed, policy } = canAccessDocument(
      { documentTypeCode: snap.get("documentTypeCode"), accessLevel: snap.get("accessLevel") },
      subject,
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
    const [url] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(path).getSignedUrl({ action: "read", expires: Date.now() + 5 * 60 * 1000 });
    const at = Timestamp.now();
    await Promise.all([
      ref.update({ accessCount: FieldValue.increment(1), lastAccessedAt: at }),
      ref.collection("audit").add({ action: action === "download" ? "downloaded" : "viewed", actorId: access.decoded.uid, actorName: access.actorName, at }),
    ]);
    return NextResponse.json({ url, expiresInSeconds: 300 });
  } catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : "Acesso negado." }, { status: 403 }); }
}
