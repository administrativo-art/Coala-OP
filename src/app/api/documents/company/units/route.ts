import { NextRequest, NextResponse } from "next/server";

import { assertFormalizationAccess } from "@/features/hr/lib/server-access";
import { dbAdmin } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await assertFormalizationAccess(request, "companyDocuments.view");
    const snap = await dbAdmin.collection("dp_units").get();
    const names = new Set<string>();
    for (const doc of snap.docs) {
      if (doc.get("isArchived") === true) continue;
      const name = doc.get("name");
      if (typeof name === "string" && name.trim()) names.add(name.trim());
    }
    return NextResponse.json({ units: [...names].sort((a, b) => a.localeCompare(b, "pt-BR")) });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Falha ao carregar unidades." }, { status: 403 });
  }
}
