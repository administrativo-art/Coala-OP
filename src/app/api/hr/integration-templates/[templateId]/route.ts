import { NextRequest, NextResponse } from "next/server";

import { integrationTemplateUpdateSchema } from "@/features/hr/integration/schemas";
import {
  archiveIntegrationTemplate,
  getIntegrationTemplate,
  updateIntegrationTemplate,
} from "@/features/hr/integration/server";
import { assertHrAccess } from "@/features/hr/lib/server-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ templateId: string }> };

function errorResponse(error: unknown, fallback: string, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status });
}

export async function GET(request: NextRequest, context: Context) {
  try {
    await assertHrAccess(request, "view");
    const { templateId } = await context.params;
    const template = await getIntegrationTemplate(templateId);
    if (!template) return NextResponse.json({ error: "Modelo de integração não encontrado." }, { status: 404 });
    return NextResponse.json({ template });
  } catch (error) {
    return errorResponse(error, "Falha ao carregar modelo de integração.", 403);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const access = await assertHrAccess(request, "manage");
    const { templateId } = await context.params;
    const input = integrationTemplateUpdateSchema.parse(await request.json());
    const template = await updateIntegrationTemplate(templateId, input, {
      userId: access.decoded.uid,
      name: access.actorName,
    });
    return NextResponse.json({ template });
  } catch (error) {
    return errorResponse(error, "Falha ao atualizar modelo de integração.");
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const access = await assertHrAccess(request, "manage");
    const { templateId } = await context.params;
    await archiveIntegrationTemplate(templateId, {
      userId: access.decoded.uid,
      name: access.actorName,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Falha ao arquivar modelo de integração.");
  }
}

