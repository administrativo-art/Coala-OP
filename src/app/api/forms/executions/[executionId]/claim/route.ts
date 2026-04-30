import { NextRequest, NextResponse } from "next/server";

import { mirrorExecutionToLegacy } from "@/features/forms/lib/legacy-bridge";
import { requireUser } from "@/lib/auth-server";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { logAction } from "@/lib/log-action";
import { type FormExecution } from "@/types/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ executionId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { executionId } = await context.params;
    const ref = checklistDbAdmin.collection("form_executions").doc(executionId);

    const execution = await checklistDbAdmin.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new Error("Execução não encontrada.");
      }

      const data = (snap.data() ?? {}) as Record<string, unknown>;
      if (data.status === "completed") {
        throw new Error("Essa execução já foi concluída.");
      }
      if (
        typeof data.claimed_by_user_id === "string" &&
        data.claimed_by_user_id &&
        data.claimed_by_user_id !== user.userDoc.id
      ) {
        throw new Error("Essa execução já foi assumida por outro colaborador.");
      }

      const next = {
        ...data,
        status: "in_progress",
        claimed_by_user_id: user.userDoc.id,
        claimed_by_username: user.userDoc.username,
        claimed_at:
          typeof data.claimed_at === "string" && data.claimed_at
            ? data.claimed_at
            : new Date().toISOString(),
        updated_at: new Date(),
      };

      tx.set(ref, next, { merge: true });
      tx.set(ref.collection("events").doc(), {
        type: "claimed",
        user_id: user.userDoc.id,
        username: user.userDoc.username,
        timestamp: new Date(),
        metadata: {},
      });
      return next;
    });

    await logAction({
      workspace_id: user.workspace_id,
      user_id: user.userDoc.id,
      username: user.userDoc.username,
      module: "forms",
      action: "execution_claimed",
      metadata: { execution_id: executionId },
    });
    await mirrorExecutionToLegacy({
      executionId,
      execution: execution as unknown as FormExecution,
    }).catch((error) => {
      console.error("Legacy dual-write failed for form execution claim:", error);
    });

    return NextResponse.json({ execution: { id: executionId, ...execution } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao assumir execução." },
      { status: 400 }
    );
  }
}
