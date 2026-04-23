import { NextRequest, NextResponse } from "next/server";

import { assertDPChecklistAccess } from "@/features/dp-checklists/lib/server-access";
import {
  appendChecklistAudit,
  checklistDbAdmin,
  loadChecklistActor,
  normalizeChecklistExecutionForApi,
} from "@/features/dp-checklists/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ executionId: string }> }
) {
  try {
    const access = await assertDPChecklistAccess(request, "operate");
    const actor = await loadChecklistActor(access.decoded.uid);
    const { executionId } = await context.params;

    if (!executionId) {
      return NextResponse.json(
        { error: "Checklist inválido." },
        { status: 400 }
      );
    }

    const executionRef = checklistDbAdmin
      .collection("checklistExecutions")
      .doc(executionId);

    const executionData = await checklistDbAdmin.runTransaction<Record<string, unknown>>(
      async (transaction) => {
        const executionSnap = await transaction.get(executionRef);
        if (!executionSnap.exists) {
          throw new Error("Checklist não encontrado.");
        }

        const data = (executionSnap.data() ?? {}) as Record<string, unknown>;
        if (data.status === "completed") {
          throw new Error("Esse checklist já foi concluído.");
        }

        const claimedByUserId =
          typeof data.claimedByUserId === "string" ? data.claimedByUserId : null;

        if (claimedByUserId && claimedByUserId !== actor.userId) {
          throw new Error("Esse checklist já foi assumido por outro colaborador.");
        }

        const nextData: Record<string, unknown> = {
          ...data,
          status: "claimed",
          claimedByUserId: actor.userId,
          claimedByUsername: actor.username,
          claimedAt:
            typeof data.claimedAt === "string" && data.claimedAt
              ? data.claimedAt
              : new Date().toISOString(),
          updatedAt: new Date(),
        };

        transaction.set(executionRef, nextData, { merge: true });
        return nextData;
      }
    );

    await appendChecklistAudit("execution_claimed", {
      actorUserId: actor.userId,
      actorUsername: actor.username,
      executionId,
      templateId:
        typeof executionData.templateId === "string" ? executionData.templateId : null,
      templateName:
        typeof executionData.templateName === "string"
          ? executionData.templateName
          : null,
      checklistDate:
        typeof executionData.checklistDate === "string"
          ? executionData.checklistDate
          : null,
      shiftId: typeof executionData.shiftId === "string" ? executionData.shiftId : null,
    });

    return NextResponse.json({
      execution: normalizeChecklistExecutionForApi(executionId, executionData),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao assumir o checklist.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
