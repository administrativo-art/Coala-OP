import { NextRequest, NextResponse } from "next/server";

import {
  jobDepartmentPatchSchema,
  normalizeJobDepartmentPatch,
  stripUndefined,
} from "@/features/hr/lib/schemas";
import {
  assertHrAccess,
  serializeHrValue,
} from "@/features/hr/lib/server-access";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ departmentId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await assertHrAccess(request, "manage");
    const { departmentId } = await context.params;
    const payload = normalizeJobDepartmentPatch(
      jobDepartmentPatchSchema.parse(await request.json())
    );
    const ref = hrDbAdmin.collection("jobDepartments").doc(departmentId);
    const current = await ref.get();

    if (!current.exists) {
      return NextResponse.json(
        { error: "Departamento não encontrado." },
        { status: 404 }
      );
    }

    if (payload.parentId === departmentId) {
      return NextResponse.json(
        { error: "Um departamento não pode ser pai dele mesmo." },
        { status: 400 }
      );
    }

    const data = stripUndefined({
      ...payload,
      updatedAt: new Date().toISOString(),
    });

    await ref.update(data);
    const saved = await ref.get();

    return NextResponse.json({
      department: {
        id: saved.id,
        ...((serializeHrValue(saved.data()) as Record<string, unknown>) ?? {}),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro ao atualizar departamento.",
      },
      { status: 400 }
    );
  }
}
