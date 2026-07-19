import { NextRequest, NextResponse } from "next/server";

import { getIntegrationTemplateVersion } from "@/features/hr/integration/server";
import { assertHrAccess } from "@/features/hr/lib/server-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string; version: string }> },
) {
  try {
    await assertHrAccess(request, "view");
    const { templateId, version: rawVersion } = await params;
    const versionNumber = Number(rawVersion);
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      return NextResponse.json({ error: "Versão inválida." }, { status: 400 });
    }
    const version = await getIntegrationTemplateVersion(templateId, versionNumber);
    if (!version) return NextResponse.json({ error: "Versão não encontrada." }, { status: 404 });
    return NextResponse.json({ version });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar versão." },
      { status: 403 },
    );
  }
}

