import { NextRequest, NextResponse } from "next/server";

import {
  buildCollaboratorDashboardPayload,
  canAccessCollaboratorDashboard,
} from "@/features/collaborator-dashboard/server";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const access = await requireUser(request);
    if (!canAccessCollaboratorDashboard(access)) {
      return NextResponse.json({ error: "Sem permissão para acessar o painel do colaborador." }, { status: 403 });
    }

    return NextResponse.json(await buildCollaboratorDashboardPayload(access));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Falha ao carregar painel do colaborador.",
      },
      { status: 403 }
    );
  }
}
