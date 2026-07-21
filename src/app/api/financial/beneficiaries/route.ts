import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { listPaymentBeneficiaries } from "@/features/financial/beneficiaries/repository.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const permission = actor.permissions.financial?.beneficiaries;
    if (!actor.isDefaultAdmin && (actor.permissions.financial?.view !== true || permission?.view !== true)) {
      return NextResponse.json({ error: "Sem permissão para visualizar favorecidos." }, { status: 403 });
    }
    const search = request.nextUrl.searchParams.get("search")?.trim().toLocaleLowerCase("pt-BR") ?? "";
    const sourceType = request.nextUrl.searchParams.get("sourceType");
    const items = (await listPaymentBeneficiaries())
      .filter((item) => !sourceType || item.reference.sourceType === sourceType)
      .filter((item) => !search || `${item.name} ${item.documentMasked}`.toLocaleLowerCase("pt-BR").includes(search))
      .map((item) => ({
        ...item,
        maskedPaymentDestination:
          actor.isDefaultAdmin || permission?.viewMaskedPaymentData === true
            ? item.maskedPaymentDestination
            : undefined,
      }));
    return NextResponse.json({
      beneficiaries: items,
      access: {
        canViewMaskedPaymentData: actor.isDefaultAdmin || permission?.viewMaskedPaymentData === true,
        canManagePaymentData: actor.isDefaultAdmin || permission?.managePaymentData === true,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar favorecidos." },
      { status: 400 },
    );
  }
}
