import { NextResponse, type NextRequest } from "next/server";
import { assertFormalizationAccess } from "@/features/hr/lib/server-access";
import {
  listAsoClinicConfigs,
  listEligibleClinicEntities,
  saveAsoClinicConfig,
} from "@/features/hr/aso/clinic-config.server";
import { asoClinicConfigInputSchema } from "@/features/financial/beneficiaries/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await assertFormalizationAccess(request, "aso.view");
    const [clinics, entities] = await Promise.all([
      listAsoClinicConfigs(),
      actor.isDefaultAdmin || actor.permissions.hr.formalization.aso.manage
        ? listEligibleClinicEntities()
        : Promise.resolve([]),
    ]);
    return NextResponse.json({
      clinics,
      entities,
      access: {
        canManage: actor.isDefaultAdmin || actor.permissions.hr.formalization.aso.manage,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar clínicas de ASO." },
      { status: 403 },
    );
  }
}
export async function POST(request: NextRequest) {
  try {
    const actor = await assertFormalizationAccess(request, "aso.manage");
    const input = asoClinicConfigInputSchema.parse(await request.json());
    const clinic = await saveAsoClinicConfig(input, {
      uid: actor.decoded.uid,
      name: actor.actorName,
      email: actor.decoded.email,
    });
    return NextResponse.json({ clinic }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao salvar clínica de ASO." },
      { status: 400 },
    );
  }
}
