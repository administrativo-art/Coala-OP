import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-server";
import {
  getEntityPaymentProfile,
  saveEntityPaymentProfile,
} from "@/features/financial/beneficiaries/repository.server";
import { supplierPaymentProfileInputSchema } from "@/features/financial/beneficiaries/schemas";

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
    const permission = actor.permissions.financial?.beneficiaries;
    if (!actor.isDefaultAdmin && (actor.permissions.financial?.view !== true || permission?.view !== true)) {
      return NextResponse.json({ error: "Sem permissão para visualizar favorecidos." }, { status: 403 });
    }
    const { entityId } = await context.params;
    const result = await getEntityPaymentProfile(decodeURIComponent(entityId));
    if (!actor.isDefaultAdmin && permission?.viewMaskedPaymentData !== true && result.profile) {
      result.profile.maskedPaymentDestination = null;
    }
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
    const permission = actor.permissions.financial?.beneficiaries;
    if (!actor.isDefaultAdmin && (
      actor.permissions.financial?.view !== true ||
      permission?.view !== true ||
      permission?.managePaymentData !== true
    )) {
      return NextResponse.json({ error: "Sem permissão para gerenciar dados de pagamento." }, { status: 403 });
    }
    const { entityId } = await context.params;
    const input = supplierPaymentProfileInputSchema.parse(await request.json());
    const saved = await saveEntityPaymentProfile(decodeURIComponent(entityId), input, {
      uid: actor.decoded.uid,
      name: actor.userDoc.username,
      email: actor.userDoc.email,
    });
    return NextResponse.json(saved);
  } catch (error) {
    return errorResponse(error, "Falha ao salvar o perfil de pagamento.");
  }
}
