import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { resolvePdvFilialId } from "@/lib/kiosk-identifiers";
import { filterUnitsByAccess } from "@/lib/unit-access";
import { assertCashClosureAccess } from "@/features/financial/cash-closures/access.server";
import { listCashClosureUnitSummaries } from "@/features/financial/cash-closures/summaries.server";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    assertCashClosureAccess(context, "view");
    const [kioskSnapshot, summaries, jobSnapshot] = await Promise.all([
      dbAdmin.collection("kiosks").get(),
      listCashClosureUnitSummaries(context.workspace_id),
      financialDbAdmin.collection("cashClosureJobRuns")
        .where("workspaceId", "==", context.workspace_id)
        .orderBy("startedAt", "desc")
        .limit(1)
        .get(),
    ]);
    const units = filterUnitsByAccess(
      kioskSnapshot.docs.map((document) => {
        const data = document.data();
        return {
          id: document.id,
          name: typeof data.name === "string" ? data.name : document.id,
          pdvFilialId: resolvePdvFilialId({
            id: document.id,
            pdvFilialId: typeof data.pdvFilialId === "string" ? data.pdvFilialId : null,
          }) ?? null,
        };
      }),
      context.userDoc,
      { isDefaultAdmin: context.isDefaultAdmin },
    );
    const byKiosk = new Map(summaries.map((summary) => [summary.kioskId, summary]));
    return NextResponse.json({
      units: units.map((unit) => ({ ...unit, summary: byKiosk.get(unit.id) ?? null })),
      latestJobRun: jobSnapshot.empty ? null : { id: jobSnapshot.docs[0].id, ...jobSnapshot.docs[0].data() },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[financial/cash-closures/overview]", error);
    const message = error instanceof Error ? error.message : "Falha ao carregar unidades.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
