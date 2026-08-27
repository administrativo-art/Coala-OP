import { NextRequest, NextResponse } from "next/server";

import { loadOpenAiBillingOverview } from "@/features/ai-management/openai-billing.server";
import { loadGoogleCloudCostOverview } from "@/features/ai-management/google-cloud-billing.server";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const allowed = actor.isDefaultAdmin || (
      actor.permissions.settings.view === true && actor.permissions.settings.viewAiCosts === true
    );
    if (!allowed) return NextResponse.json({ error: "Sem permissão para consultar custos de IA." }, { status: 403 });
    const view = request.nextUrl.searchParams.get("view");
    const overview = view === "costs"
      ? await loadGoogleCloudCostOverview()
      : await loadOpenAiBillingOverview();
    return NextResponse.json(overview, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível carregar os custos de IA." },
      { status: 400 },
    );
  }
}
