import { NextRequest, NextResponse } from "next/server";

import { finalizeRepositionActivityServer } from "@/features/reposition/lib/server";
import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { updateTaskDocument } from "@/features/tasks/lib/server";
import { type RepositionActivity } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ activityId: string }>;
};

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    const context = await requireUser(request);
    if (!(context.isDefaultAdmin || context.permissions.stock.analysis.restock)) {
      return NextResponse.json(
        { error: "Sem permissão para efetivar reposições." },
        { status: 403 }
      );
    }

    const { activityId } = await routeContext.params;
    const body = (await request.json().catch(() => null)) as
      | { resolution?: "trust_receipt" | "trust_dispatch" }
      | null;
    const resolution = body?.resolution ?? "trust_receipt";

    await finalizeRepositionActivityServer({
      activityId,
      resolution,
      actor: {
        userId: context.userDoc.id,
        username: context.userDoc.username,
      },
    });

    const snap = await dbAdmin.collection("repositionActivities").doc(activityId).get();
    const activity = snap.exists
      ? ({ id: snap.id, ...(snap.data() as Omit<RepositionActivity, "id">) } as RepositionActivity)
      : null;

    if (activity?.taskId) {
      await updateTaskDocument({
        context,
        taskId: activity.taskId,
        allowOriginStatusChange: true,
        updates: { status: "completed" },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao efetivar reposição.",
      },
      { status: 400 }
    );
  }
}
