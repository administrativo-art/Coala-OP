import { NextRequest, NextResponse } from "next/server";

import {
  jobRolePatchSchema,
  normalizeJobRolePatch,
  stripUndefined,
} from "@/features/hr/lib/schemas";
import {
  assertHrAccess,
  serializeHrValue,
} from "@/features/hr/lib/server-access";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import {
  applyRecruitmentScoring,
  getRecruitmentScoringBlockMessage,
} from "@/lib/recruitment-scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  try {
    await assertHrAccess(request, "manage");
    const { roleId } = await params;
    const roleRef = hrDbAdmin.collection("jobRoles").doc(roleId);
    const existing = await roleRef.get();

    if (!existing.exists) {
      return NextResponse.json({ error: "Cargo não encontrado." }, { status: 404 });
    }

    const payload = normalizeJobRolePatch(
      jobRolePatchSchema.parse(await request.json())
    );
    if (payload.formQuestions !== undefined) {
      const scoringBlock = getRecruitmentScoringBlockMessage(
        applyRecruitmentScoring(payload.formQuestions, "role_100").snapshot
      );
      if (scoringBlock) {
        return NextResponse.json({ error: scoringBlock }, { status: 400 });
      }
    }

    if (payload.parentId === roleId || payload.reportsTo === roleId) {
      return NextResponse.json(
        { error: "Um cargo não pode ser pai dele mesmo." },
        { status: 400 }
      );
    }
    const current = existing.data() ?? {};
    const nextData = stripUndefined({
      ...current,
      ...payload,
      createdAt: current.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await roleRef.set(nextData);
    const saved = await roleRef.get();

    return NextResponse.json({
      role: {
        id: saved.id,
        ...((serializeHrValue(saved.data() ?? nextData) as Record<string, unknown>) ??
          {}),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Erro ao atualizar cargo.",
      },
      { status: 400 }
    );
  }
}
