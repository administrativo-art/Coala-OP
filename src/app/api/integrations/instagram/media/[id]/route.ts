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

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withApiErrorHandling<RouteContext>(
  {
    source: "api",
    operation: "previewInstagramMediaLibrary",
    routeOrJob: "/api/integrations/instagram/media/[id]",
  },
  async (request: NextRequest, { params }) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);

    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new AppError({
        code: "INSTAGRAM_LIBRARY_MEDIA_NOT_FOUND",
        kind: "NOT_FOUND",
        safeMessage: "Mídia não encontrada.",
        reportable: false,
      });
    }

    let snapshot = await marketingDbAdmin.collection("instagramMediaLibrary").doc(id).get();
    if (!snapshot.exists && shouldReadLegacyMarketingDatabase()) {
      snapshot = await legacyMarketingDbAdmin.collection("instagramMediaLibrary").doc(id).get();
    }
    const data = snapshot.data();
    const expectedPrefix = `instagram/library/${context.workspace_id}/${id}/`;
    if (
      !snapshot.exists
      || data?.workspace_id !== context.workspace_id
      || typeof data.objectPath !== "string"
      || !data.objectPath.startsWith(expectedPrefix)
      || !["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"].includes(data.contentType)
    ) {
      throw new AppError({
        code: "INSTAGRAM_LIBRARY_MEDIA_NOT_FOUND",
        kind: "NOT_FOUND",
        safeMessage: "Mídia não encontrada.",
        reportable: false,
      });
    }

    const [buffer] = await getStorage(adminApp)
      .bucket(firebaseClientConfig.storageBucket)
      .file(data.objectPath)
      .download();

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": data.contentType,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
);
