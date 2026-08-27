import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "firebase-admin/storage";

import { requireUser } from "@/lib/auth-server";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { WORKSPACE_ID } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(request);
    const { id } = await context.params;
    const snapshot = await dbAdmin.collection("uniformTransactions").doc(id).get();
    if (!snapshot.exists || snapshot.get("workspaceId") !== WORKSPACE_ID) {
      return NextResponse.json({ error: "Termo não encontrado." }, { status: 404 });
    }
    const collaboratorUserId = String(snapshot.get("collaboratorUserId") ?? "");
    const allowed = auth.isDefaultAdmin ||
      auth.userDoc.id === collaboratorUserId ||
      auth.permissions.stock.uniforms?.view === true ||
      auth.permissions.dp.collaborators.view === true;
    if (!allowed) return NextResponse.json({ error: "Sem permissão para visualizar este termo." }, { status: 403 });
    const storagePath = String(snapshot.get("term.storagePath") ?? "");
    const fileName = String(snapshot.get("term.fileName") ?? "termo-uniforme.pdf");
    if (!storagePath) return NextResponse.json({ error: "Arquivo do termo indisponível." }, { status: 404 });
    const [buffer] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).download();
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName.replace(/[^a-zA-Z0-9._-]+/g, "-")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Falha ao abrir o termo.",
    }, { status: 400 });
  }
}
