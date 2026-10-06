import { NextRequest, NextResponse } from "next/server";

import { addInstagramPostMedia } from "@/features/instagram-posts/media.server";
import { requireInstagramSchedulerUser } from "@/features/instagram-scheduler/access.server";
import { AppError } from "@/lib/observability/app-error";
import { withApiErrorHandling } from "@/lib/observability/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withApiErrorHandling<RouteContext>(
  { source: "api", operation: "uploadInstagramPostMedia", routeOrJob: "/api/integrations/instagram/posts/[id]/media" },
  async (request: NextRequest, { params }) => {
    const context = await requireInstagramSchedulerUser(request);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new AppError({ code: "INSTAGRAM_POST_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Post não encontrado.", reportable: false });
    }
    const form = await request.formData();
    const file = form.get("media");
    if (!(file instanceof File)) {
      throw new AppError({ code: "INSTAGRAM_POST_MEDIA_REQUIRED", kind: "VALIDATION", safeMessage: "Selecione uma mídia.", reportable: false });
    }
    return NextResponse.json(
      { item: await addInstagramPostMedia(context, id, file) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
);
