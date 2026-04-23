import { NextRequest, NextResponse } from "next/server";

import {
  jobFunctionPatchSchema,
  normalizeJobFunctionPatch,
  stripUndefined,
} from "@/features/hr/lib/schemas";
import {
  assertHrAccess,
  serializeHrValue,
} from "@/features/hr/lib/server-access";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ functionId: string }> }
) {
  try {
    await assertHrAccess(request, "manage");
    const { functionId } = await params;
    const functionRef = hrDbAdmin.collection("jobFunctions").doc(functionId);
    const existing = await functionRef.get();

    if (!existing.exists) {
      return NextResponse.json(
        { error: "Função não encontrada." },
        { status: 404 }
      );
    }

    const payload = normalizeJobFunctionPatch(
      jobFunctionPatchSchema.parse(await request.json())
    );
    const current = existing.data() ?? {};
    const nextData = stripUndefined({
      ...current,
      ...payload,
      createdAt: current.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await functionRef.set(nextData);
    const saved = await functionRef.get();

    return NextResponse.json({
      function: {
        id: saved.id,
        ...((serializeHrValue(saved.data() ?? nextData) as Record<string, unknown>) ??
          {}),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Erro ao atualizar função.",
      },
      { status: 400 }
    );
  }
}
