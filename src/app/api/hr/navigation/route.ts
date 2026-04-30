import { NextRequest, NextResponse } from "next/server";

import { assertHrAccess } from "@/features/hr/lib/server-access";
import { getFeatureFlags } from "@/lib/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const access = await assertHrAccess(request, "view");
    const flags = await getFeatureFlags();

    if (!flags.hr_navigation_api_enabled) {
      return NextResponse.json(
        { error: "A navegação de RH ainda não foi liberada." },
        { status: 403 }
      );
    }

    return NextResponse.json({
      access: {
        canView: access.canView,
        canManageCatalog: access.canManageCatalog,
      },
      sections: [
        {
          id: "employees",
          label: "Colaboradores",
          href: "/dashboard/settings?department=pessoal&tab=users",
          enabled: access.canView,
        },
        {
          id: "roles",
          label: "Cargos e funções",
          href: "/dashboard/settings?department=pessoal&tab=roles",
          enabled: access.canManageCatalog,
        },
        {
          id: "organogram",
          label: "Organograma",
          href: "/dashboard/settings?department=pessoal&tab=organogram",
          enabled: access.canView,
        },
        {
          id: "login-access",
          label: "Acesso por escala",
          href: "/dashboard/settings?department=pessoal&tab=login-access",
          enabled: access.canManageCatalog,
        },
      ],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao carregar a navegação do RH.",
      },
      { status: 403 }
    );
  }
}
