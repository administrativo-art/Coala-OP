import { NextRequest, NextResponse } from "next/server";

import { requireInstagramSchedulerAccess } from "@/features/instagram-scheduler/access.server";
import { serializeInstagramSchedule } from "@/features/instagram-scheduler/serialize.server";
import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { withApiErrorHandling } from "@/lib/observability/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling(
  {
    source: "api",
    operation: "listInstagramSchedule",
    routeOrJob: "/api/integrations/instagram/schedule",
  },
  async (request: NextRequest) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);

    const snapshot = await dbAdmin
      .collection("instagramScheduledPosts")
      .where("workspace_id", "==", context.workspace_id)
      .orderBy("scheduledAt", "desc")
      .limit(100)
      .get();

    return NextResponse.json(
      { items: snapshot.docs.map(serializeInstagramSchedule) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
);
