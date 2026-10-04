import { NextRequest, NextResponse } from "next/server";

import { requireInstagramSchedulerAccess } from "@/features/instagram-scheduler/access.server";
import { instagramMediaFolderCreateSchema } from "@/features/instagram-scheduler/contracts";
import {
  createInstagramMediaFolder,
  listInstagramMediaFolders,
} from "@/features/instagram-scheduler/media-folders.server";
import { requireUser } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { withApiErrorHandling } from "@/lib/observability/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling(
  {
    source: "api",
    operation: "listInstagramMediaFolders",
    routeOrJob: "/api/integrations/instagram/media/folders",
  },
  async (request: NextRequest) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);
    const folders = await listInstagramMediaFolders(context.workspace_id);
    return NextResponse.json({ folders }, { headers: { "Cache-Control": "private, no-store" } });
  },
);

export const POST = withApiErrorHandling(
  {
    source: "api",
    operation: "createInstagramMediaFolder",
    routeOrJob: "/api/integrations/instagram/media/folders",
  },
  async (request: NextRequest) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);
    const payload = instagramMediaFolderCreateSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      throw new AppError({
        code: "INSTAGRAM_MEDIA_FOLDER_INVALID",
        kind: "VALIDATION",
        safeMessage: payload.error.issues[0]?.message ?? "Pasta inválida.",
        reportable: false,
      });
    }
    const folder = await createInstagramMediaFolder(context, payload.data);
    return NextResponse.json({ folder }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  },
);
