import { NextRequest, NextResponse } from "next/server";

import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import {
  assertHrAccess,
  serializeHrValue,
} from "@/features/hr/lib/server-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const access = await assertHrAccess(request, "view");

    const [departmentsSnap, rolesSnap, functionsSnap] = await Promise.all([
      hrDbAdmin.collection("jobDepartments").orderBy("name").get(),
      hrDbAdmin.collection("jobRoles").orderBy("name").get(),
      hrDbAdmin.collection("jobFunctions").orderBy("name").get(),
    ]);

    return NextResponse.json({
      departments: departmentsSnap.docs.map((doc) => ({
        id: doc.id,
        ...((serializeHrValue(doc.data()) as Record<string, unknown>) ?? {}),
      })),
      roles: rolesSnap.docs.map((doc) => ({
        id: doc.id,
        ...((serializeHrValue(doc.data()) as Record<string, unknown>) ?? {}),
      })),
      functions: functionsSnap.docs.map((doc) => ({
        id: doc.id,
        ...((serializeHrValue(doc.data()) as Record<string, unknown>) ?? {}),
      })),
      access: {
        canView: access.canView,
        canManageCatalog: access.canManageCatalog,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro ao carregar bootstrap do RH.",
      },
      { status: 403 }
    );
  }
}
