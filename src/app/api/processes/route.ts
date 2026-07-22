import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { buildProcessProjection, recalculateTermination } from "@/features/hr/termination/core";
import type { CltTerminationProcess } from "@/features/hr/termination/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const canViewAll = context.isDefaultAdmin || context.permissions.dp.view || context.permissions.dp.collaborators.view;
    if (canViewAll) {
      const source = await hrDbAdmin.collection("terminationProcesses").get();
      const syncedAt = new Date().toISOString();
      await Promise.all(source.docs.map(async (document) => {
        const process = recalculateTermination({ id: document.id, ...document.data() } as CltTerminationProcess);
        const ref = dbAdmin.collection("processProjections").doc(`termination:${document.id}`);
        const current = await ref.get();
        if (current.get("sourceUpdatedAt") === process.updatedAt && current.get("health") === process.health) return;
        await ref.set(buildProcessProjection(process, Number(current.get("version") ?? 0) + 1, syncedAt), { merge: true });
      }));
    }
    const snapshot = await dbAdmin.collection("processProjections").orderBy("lastActivityAt", "desc").limit(500).get();
    const processes: Array<Record<string, unknown> & { id: string }> = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const visibleProcesses = processes.filter((item) => canViewAll || (Array.isArray(item.visibleToUserIds) && item.visibleToUserIds.includes(context.userDoc.id)));
    return NextResponse.json({ processes: visibleProcesses });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sem acesso." }, { status: 403 });
  }
}
