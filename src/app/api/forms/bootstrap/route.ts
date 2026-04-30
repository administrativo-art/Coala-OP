import { NextRequest, NextResponse } from "next/server";

import { buildFormsBootstrap } from "@/features/forms/lib/service";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const payload = await buildFormsBootstrap({
      workspaceId: context.workspace_id,
      permissions: context.permissions,
      isDefaultAdmin: context.isDefaultAdmin,
    });

    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Falha ao carregar o bootstrap de formulários.";

    return NextResponse.json({ error: message }, { status: 403 });
  }
}
