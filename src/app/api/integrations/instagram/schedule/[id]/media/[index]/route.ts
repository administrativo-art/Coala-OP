import { getStorage } from "firebase-admin/storage";
import { NextRequest, NextResponse } from "next/server";

import { requireInstagramSchedulerAccess } from "@/features/instagram-scheduler/access.server";
import { requireUser } from "@/lib/auth-server";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import {
  legacyMarketingDbAdmin,
  marketingDbAdmin,
  shouldReadLegacyMarketingDatabase,
} from "@/lib/firebase-marketing-admin";
import { AppError } from "@/lib/observability/app-error";
import { withApiErrorHandling } from "@/lib/observability/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; index: string }> };

export const GET = withApiErrorHandling<RouteContext>(
  {
    source: "api",
    operation: "previewInstagramScheduledMedia",
    routeOrJob: "/api/integrations/instagram/schedule/[id]/media/[index]",
  },
  async (request: NextRequest, { params }) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);

    const { id, index: rawIndex } = await params;
    const index = Number(rawIndex);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !Number.isInteger(index) || index < 0 || index > 9) {
      throw new AppError({
        code: "INSTAGRAM_PREVIEW_NOT_FOUND",
        kind: "NOT_FOUND",
        safeMessage: "Prévia não encontrada.",
        reportable: false,
      });
    }

    let snapshot = await marketingDbAdmin.collection("instagramScheduledPosts").doc(id).get();
    if (!snapshot.exists && shouldReadLegacyMarketingDatabase()) {
      snapshot = await legacyMarketingDbAdmin.collection("instagramScheduledPosts").doc(id).get();
    }
    const data = snapshot.data();
    const media = Array.isArray(data?.media) ? data.media[index] : null;
    if (
      !snapshot.exists ||
      data?.workspace_id !== context.workspace_id ||
      (media?.kind !== "image" && media?.kind !== "video") ||
      typeof media?.objectPath !== "string" ||
      !media.objectPath.startsWith(`instagram/scheduled/${id}/`)
    ) {
      throw new AppError({
        code: "INSTAGRAM_PREVIEW_NOT_FOUND",
        kind: "NOT_FOUND",
        safeMessage: "Prévia não encontrada.",
        reportable: false,
      });
    }

    const [buffer] = await getStorage(adminApp)
      .bucket(firebaseClientConfig.storageBucket)
      .file(media.objectPath)
      .download();

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": ["image/jpeg", "video/mp4", "video/quicktime"].includes(media.contentType)
          ? media.contentType : "application/octet-stream",
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
);
