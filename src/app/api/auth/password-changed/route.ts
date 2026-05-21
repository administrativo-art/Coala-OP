import { FieldValue } from "firebase-admin/firestore";
import { NextResponse, type NextRequest } from "next/server";

import { dbAdmin } from "@/lib/firebase-admin";
import { verifyAuth } from "@/lib/verify-auth";

export async function POST(req: NextRequest) {
  try {
    const decoded = await verifyAuth(req);

    if (!decoded.uid) {
      return NextResponse.json({ error: "Usuário inválido." }, { status: 401 });
    }

    await dbAdmin.collection("users").doc(decoded.uid).set(
      {
        mustChangePassword: false,
        passwordChangedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao registrar alteração de senha.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
