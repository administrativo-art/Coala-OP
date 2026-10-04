import { NextRequest, NextResponse } from "next/server";

import { requireInstagramSchedulerAccess } from "@/features/instagram-scheduler/access.server";
import {
  instagramMediaFolderIdSchema,
  instagramMediaFolderUpdateSchema,
} from "@/features/instagram-scheduler/contracts";
import {
  deleteInstagramMediaFolder,
  updateInstagramMediaFolder,
} from "@/features/instagram-scheduler/media-folders.server";
import { requireUser } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { withApiErrorHandling } from "@/lib/observability/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function folderId(context: RouteContext) {
  const parsed = instagramMediaFolderIdSchema.safeParse((await context.params).id);
  if (!parsed.success) {
    throw new AppError({
      code: "INSTAGRAM_MEDIA_FOLDER_FOLDER_NOT_FOUND",
      kind: "NOT_FOUND",
      safeMessage: "Pasta não encontrada.",
      reportable: false,
    });
  }
  return parsed.data;
}

export const PATCH = withApiErrorHandling<RouteContext>(
  {
    source: "api",
    operation: "updateInstagramMediaFolder",
    routeOrJob: "/api/integrations/instagram/media/folders/[id]",
  },
  async (request: NextRequest, routeContext) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);
    const id = await folderId(routeContext);
    const payload = instagramMediaFolderUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      throw new AppError({
        code: "INSTAGRAM_MEDIA_FOLDER_INVALID",
        kind: "VALIDATION",
        safeMessage: payload.error.issues[0]?.message ?? "Alteração da pasta inválida.",
        reportable: false,
      });
    }
    const folder = await updateInstagramMediaFolder(context, id, payload.data);
    return NextResponse.json({ folder }, { headers: { "Cache-Control": "private, no-store" } });
  },
);

export const DELETE = withApiErrorHandling<RouteContext>(
  {
    source: "api",
    operation: "deleteInstagramMediaFolder",
    routeOrJob: "/api/integrations/instagram/media/folders/[id]",
  },
  async (request: NextRequest, routeContext) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);
    const result = await deleteInstagramMediaFolder(context, await folderId(routeContext));
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  },
);
