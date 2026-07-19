import { NextRequest, NextResponse } from "next/server";

import { publishIntegrationTemplate } from "@/features/hr/integration/server";
import { assertHrAccess } from "@/features/hr/lib/server-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  try {
    const access = await assertHrAccess(request, "manage");
    const { templateId } = await params;
    const version = await publishIntegrationTemplate(templateId, {
      userId: access.decoded.uid,
      name: access.actorName,
    });
    return NextResponse.json({ version });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao publicar modelo de integração." },
      { status: 400 },
    );
  }
}

