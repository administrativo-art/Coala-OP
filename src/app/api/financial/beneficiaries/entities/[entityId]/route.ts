import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-server";
import {
  getEntityPixProfile,
  saveEntityPixProfile,
} from "@/features/financial/beneficiaries/repository.server";
import { entityPixProfileInputSchema } from "@/features/financial/beneficiaries/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown, fallback: string) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 400 },
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ entityId: string }> },
) {
  try {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && actor.permissions.registration?.entities?.edit !== true) {
      return NextResponse.json({ error: "Sem permissão para visualizar a chave Pix." }, { status: 403 });
    }
    const { entityId } = await context.params;
    const result = await getEntityPixProfile(decodeURIComponent(entityId));
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error, "Falha ao carregar o perfil de pagamento.");
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ entityId: string }> },
) {
  try {
    const actor = await requireUser(request);
    const canEdit = actor.isDefaultAdmin || actor.permissions.registration?.entities?.edit === true;
    const canAdd = actor.permissions.registration?.entities?.add === true;
    if (!actor.isDefaultAdmin && (
      !canEdit && !canAdd
    )) {
      return NextResponse.json({ error: "Sem permissão para gerenciar a chave Pix." }, { status: 403 });
    }
    const { entityId } = await context.params;
    const input = entityPixProfileInputSchema.parse(await request.json());
    const saved = await saveEntityPixProfile(
      decodeURIComponent(entityId),
      input,
      {
        uid: actor.decoded.uid,
        name: actor.userDoc.username,
        email: actor.userDoc.email,
      },
      { requireCreator: !canEdit },
    );
    return NextResponse.json(saved);
  } catch (error) {
    return errorResponse(error, "Falha ao salvar o perfil de pagamento.");
  }
}
