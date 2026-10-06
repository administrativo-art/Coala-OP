import { NextRequest, NextResponse } from "next/server";

import { instagramPostActionSchema } from "@/features/instagram-posts/contracts";
import { actOnInstagramPost } from "@/features/instagram-posts/service.server";
import { requireInstagramSchedulerUser } from "@/features/instagram-scheduler/access.server";
import { AppError } from "@/lib/observability/app-error";
import { withApiErrorHandling } from "@/lib/observability/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withApiErrorHandling<RouteContext>(
  { source: "api", operation: "actOnInstagramPost", routeOrJob: "/api/integrations/instagram/posts/[id]/actions" },
  async (request: NextRequest, { params }) => {
    const context = await requireInstagramSchedulerUser(request);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new AppError({ code: "INSTAGRAM_POST_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Post não encontrado.", reportable: false });
    }
    const parsed = instagramPostActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: "INSTAGRAM_POST_INVALID_ACTION", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message ?? "Ação inválida.", reportable: false });
    }
    return NextResponse.json(
      { item: await actOnInstagramPost(context, id, parsed.data) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
);
