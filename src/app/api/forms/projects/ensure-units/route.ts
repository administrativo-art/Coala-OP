import { NextRequest, NextResponse } from "next/server";

import { canAccessFormsModule } from "@/features/forms/lib/server-access";
import { ensureUnitFormProjects } from "@/features/forms/lib/server";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);

    if (!canAccessFormsModule(context.permissions, context.isDefaultAdmin)) {
      return NextResponse.json(
        { error: "Sem permissão para sincronizar projetos de formulários." },
        { status: 403 }
      );
    }

    const payload = await ensureUnitFormProjects(context.workspace_id);
    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Falha ao sincronizar projetos de formulários por unidade.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
