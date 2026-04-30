import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { loadFormsNavigation } from "@/features/forms/lib/server-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const payload = await loadFormsNavigation({
      permissions: context.permissions,
      isDefaultAdmin: context.isDefaultAdmin,
      workspaceId: context.workspace_id,
    });

    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Falha ao carregar a navegação de formulários.";

    return NextResponse.json({ error: message }, { status: 403 });
  }
}
