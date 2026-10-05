import { NextRequest, NextResponse } from "next/server";

import { requireInstagramSchedulerAccess } from "@/features/instagram-scheduler/access.server";
import { instagramPostUpdateSchema } from "@/features/instagram-posts/contracts";
import { getInstagramPost, updateInstagramPost } from "@/features/instagram-posts/service.server";
import { requireUser } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { withApiErrorHandling } from "@/lib/observability/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function validId(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new AppError({ code: "INSTAGRAM_POST_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Post não encontrado.", reportable: false });
  }
}

export const GET = withApiErrorHandling<RouteContext>(
  { source: "api", operation: "getInstagramPost", routeOrJob: "/api/integrations/instagram/posts/[id]" },
  async (request: NextRequest, { params }) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);
    const { id } = await params;
    validId(id);
    return NextResponse.json(
      { item: await getInstagramPost(context, id) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
);

export const PATCH = withApiErrorHandling<RouteContext>(
  { source: "api", operation: "updateInstagramPost", routeOrJob: "/api/integrations/instagram/posts/[id]" },
  async (request: NextRequest, { params }) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);
    const { id } = await params;
    validId(id);
    const parsed = instagramPostUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: "INSTAGRAM_POST_INVALID_INPUT", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message ?? "Revise os dados do post.", reportable: false });
    }
    return NextResponse.json(
      { item: await updateInstagramPost(context, id, parsed.data) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
);
