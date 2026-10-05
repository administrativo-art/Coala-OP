import { NextRequest, NextResponse } from "next/server";

import { requireInstagramSchedulerAccess } from "@/features/instagram-scheduler/access.server";
import { instagramMediaMoveSchema } from "@/features/instagram-scheduler/contracts";
import { moveInstagramMedia } from "@/features/instagram-scheduler/media-folders.server";
import { requireUser } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { withApiErrorHandling } from "@/lib/observability/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApiErrorHandling(
  {
    source: "api",
    operation: "moveInstagramMedia",
    routeOrJob: "/api/integrations/instagram/media/move",
  },
  async (request: NextRequest) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);
    const payload = instagramMediaMoveSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      throw new AppError({
        code: "INSTAGRAM_LIBRARY_INVALID_MOVE",
        kind: "VALIDATION",
        safeMessage: payload.error.issues[0]?.message ?? "Movimentação inválida.",
        reportable: false,
      });
    }
    const result = await moveInstagramMedia(context, payload.data);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  },
);
