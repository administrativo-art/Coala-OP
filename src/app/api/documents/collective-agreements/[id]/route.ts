import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { assertFormalizationAccess } from "@/features/hr/lib/server-access";
import { dbAdmin } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const access = await assertFormalizationAccess(request, "templates.manage");
    const body = await request.json().catch(() => ({}));
    if (body.status !== "archived") {
      return NextResponse.json(
        { error: "Uma CCT utilizada por documentos é imutável. Crie uma nova vigência ou arquive esta versão." },
        { status: 400 },
      );
    }
    const { id } = await context.params;
    const reference = dbAdmin.collection("documentCollectiveAgreements").doc(id);
    const document = await reference.get();
    if (!document.exists) {
      return NextResponse.json({ error: "CCT não encontrada." }, { status: 404 });
    }
    if (document.get("status") === "archived") {
      return NextResponse.json({ ok: true });
    }
    await reference.update({
      status: "archived",
      archivedAt: Timestamp.now(),
      archivedBy: access.decoded.uid,
      archivedByName: access.actorName,
      updatedAt: Timestamp.now(),
      updatedBy: access.decoded.uid,
      updatedByName: access.actorName,
    });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Falha ao arquivar a CCT." },
      { status: 403 },
    );
  }
}
