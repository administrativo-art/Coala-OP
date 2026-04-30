import { NextRequest, NextResponse } from "next/server";

import { reopenDispatchServer } from "@/features/reposition/lib/server";
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
    if (!(context.isDefaultAdmin || context.permissions.reposition.cancel)) {
      return NextResponse.json(
        { error: "Sem permissão para reabrir despacho." },
        { status: 403 }
      );
    }

    const { activityId } = await routeContext.params;
    await reopenDispatchServer(activityId, {
      userId: context.userDoc.id,
      username: context.userDoc.username,
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
        updates: { status: "pending" },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao reabrir despacho.",
      },
      { status: 400 }
    );
  }
}
