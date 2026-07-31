import { NextRequest, NextResponse } from "next/server";

import { revertRepositionActivityServer } from "@/features/reposition/lib/server";
import { syncRepositionTaskSafely } from "@/features/reposition/lib/task-sync";
import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { canAccessAnyUnit } from "@/lib/unit-access";
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
        { error: "Sem permissão para estornar reposição." },
        { status: 403 }
      );
    }

    const { activityId } = await routeContext.params;
    const currentSnap = await dbAdmin.collection("repositionActivities").doc(activityId).get();
    if (!currentSnap.exists) {
      return NextResponse.json({ error: "Reposição não encontrada." }, { status: 404 });
    }
    const currentActivity = {
      id: currentSnap.id,
      ...(currentSnap.data() as Omit<RepositionActivity, "id">),
    } as RepositionActivity;
    if (!canAccessAnyUnit(
      context.userDoc,
      [currentActivity.kioskOriginId, currentActivity.kioskDestinationId],
      { isDefaultAdmin: context.isDefaultAdmin }
    )) {
      return NextResponse.json({ error: "Reposição fora do seu escopo de unidades." }, { status: 403 });
    }
    await revertRepositionActivityServer(activityId, {
      userId: context.userDoc.id,
      username: context.userDoc.username,
    });

    const snap = await dbAdmin.collection("repositionActivities").doc(activityId).get();
    const activity = snap.exists
      ? ({ id: snap.id, ...(snap.data() as Omit<RepositionActivity, "id">) } as RepositionActivity)
      : null;

    if (activity) {
      await syncRepositionTaskSafely({
        context,
        activity,
        label: "revert",
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao estornar reposição.",
      },
      { status: 400 }
    );
  }
}
