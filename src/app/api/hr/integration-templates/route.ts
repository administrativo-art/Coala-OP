import { NextRequest, NextResponse } from "next/server";

import { integrationTemplateCreateSchema } from "@/features/hr/integration/schemas";
import {
  createIntegrationTemplate,
  listIntegrationTemplates,
  type IntegrationTemplateStatus,
} from "@/features/hr/integration/server";
import { assertHrAccess } from "@/features/hr/lib/server-access";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown, fallback: string, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status });
}

async function validateRoleAndFunction(roleId: string, functionId?: string | null) {
  const [roleSnap, functionSnap] = await Promise.all([
    hrDbAdmin.collection("jobRoles").doc(roleId).get(),
    functionId ? hrDbAdmin.collection("jobFunctions").doc(functionId).get() : Promise.resolve(null),
  ]);
  if (!roleSnap.exists) throw new Error("Cargo não encontrado.");
  if (functionId && !functionSnap?.exists) throw new Error("Função não encontrada.");
  const compatibleRoleIds = functionSnap?.exists && Array.isArray(functionSnap.get("compatibleRoleIds"))
    ? functionSnap.get("compatibleRoleIds").filter((value: unknown): value is string => typeof value === "string")
    : [];
  if (functionId && compatibleRoleIds.length > 0 && !compatibleRoleIds.includes(roleId)) {
    throw new Error("A função selecionada não é compatível com o cargo.");
  }
}

export async function GET(request: NextRequest) {
  try {
    await assertHrAccess(request, "view");
    const roleId = request.nextUrl.searchParams.get("roleId") || undefined;
    const functionParam = request.nextUrl.searchParams.get("functionId");
    const functionId = functionParam === null ? undefined : functionParam || null;
    const rawStatus = request.nextUrl.searchParams.get("status");
    const status: IntegrationTemplateStatus | undefined = rawStatus === "draft" || rawStatus === "published" || rawStatus === "archived"
      ? rawStatus
      : undefined;
    const compatibleOnly = request.nextUrl.searchParams.get("compatibleOnly") === "true";
    const templates = await listIntegrationTemplates({ roleId, functionId, status, compatibleOnly });
    return NextResponse.json({ templates });
  } catch (error) {
    return errorResponse(error, "Falha ao carregar modelos de integração.", 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await assertHrAccess(request, "manage");
    const input = integrationTemplateCreateSchema.parse(await request.json());
    await validateRoleAndFunction(input.roleId, input.functionId);
    const created = await createIntegrationTemplate(input, {
      userId: access.decoded.uid,
      name: access.actorName,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Falha ao criar modelo de integração.");
  }
}

