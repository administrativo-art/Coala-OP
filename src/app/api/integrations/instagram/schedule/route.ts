import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";

import { requireInstagramSchedulerAccess } from "@/features/instagram-scheduler/access.server";
import { createInstagramScheduleFromForm } from "@/features/instagram-scheduler/schedule-create.server";
import { serializeInstagramSchedule } from "@/features/instagram-scheduler/serialize.server";
import { requireUser } from "@/lib/auth-server";
import {
  legacyMarketingDbAdmin,
  marketingDbAdmin,
  shouldReadLegacyMarketingDatabase,
} from "@/lib/firebase-marketing-admin";
import { withApiErrorHandling } from "@/lib/observability/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isMissingIndexError(cause: unknown) {
  const code = (cause as { code?: unknown } | null)?.code;
  return code === 9 || code === "9" || code === "failed-precondition";
}

function scheduledAtMillis(doc: { data(): Record<string, unknown> | undefined }) {
  const value = doc.data()?.scheduledAt as { toMillis?: () => number } | undefined;
  return typeof value?.toMillis === "function" ? value.toMillis() : 0;
}

async function listWorkspaceScheduleFrom(db: Firestore, workspaceId: string) {
  const collection = db.collection("instagramScheduledPosts");
  try {
    const snapshot = await collection
      .where("workspace_id", "==", workspaceId)
      .orderBy("scheduledAt", "desc")
      .limit(100)
      .get();
    return snapshot.docs;
  } catch (cause) {
    if (!isMissingIndexError(cause)) throw cause;
    const snapshot = await collection
      .where("workspace_id", "==", workspaceId)
      .limit(100)
      .get();
    return snapshot.docs.sort((left, right) => scheduledAtMillis(right) - scheduledAtMillis(left));
  }
}

export const GET = withApiErrorHandling(
  {
    source: "api",
    operation: "listInstagramSchedule",
    routeOrJob: "/api/integrations/instagram/schedule",
  },
  async (request: NextRequest) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);

    const [currentDocs, legacyDocs] = await Promise.all([
      listWorkspaceScheduleFrom(marketingDbAdmin, context.workspace_id),
      shouldReadLegacyMarketingDatabase()
        ? listWorkspaceScheduleFrom(legacyMarketingDbAdmin, context.workspace_id)
        : Promise.resolve([]),
    ]);
    const byId = new Map(legacyDocs.map((doc) => [doc.id, doc]));
    currentDocs.forEach((doc) => byId.set(doc.id, doc));
    const docs = [...byId.values()]
      .sort((left, right) => scheduledAtMillis(right) - scheduledAtMillis(left))
      .slice(0, 100);

    return NextResponse.json(
      { items: docs.map(serializeInstagramSchedule) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
);

export const POST = withApiErrorHandling(
  {
    source: "api",
    operation: "createInstagramSchedule",
    routeOrJob: "/api/integrations/instagram/schedule",
  },
  async (request: NextRequest) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);
    const item = await createInstagramScheduleFromForm({
      context,
      form: await request.formData(),
    });
    return NextResponse.json(
      { item },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  },
);
