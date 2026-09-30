import { NextRequest, NextResponse } from "next/server";

import { requireInstagramSchedulerAccess } from "@/features/instagram-scheduler/access.server";
import { fetchInstagramPublishedFeed } from "@/features/instagram-scheduler/meta-graph.server";
import { requireUser } from "@/lib/auth-server";
import { withApiErrorHandling } from "@/lib/observability/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling(
  {
    source: "api",
    operation: "listInstagramPublishedFeed",
    routeOrJob: "/api/integrations/instagram/feed",
  },
  async (request: NextRequest) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);
    const result = await fetchInstagramPublishedFeed();
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=120" },
    });
  },
);
