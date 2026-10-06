import { getStorage } from "firebase-admin/storage";
import { NextRequest, NextResponse } from "next/server";

import { requireInstagramSchedulerUser } from "@/features/instagram-scheduler/access.server";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { marketingDbAdmin } from "@/lib/firebase-marketing-admin";
import { AppError } from "@/lib/observability/app-error";
import { withApiErrorHandling } from "@/lib/observability/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; mediaId: string }> };

export const GET = withApiErrorHandling<RouteContext>(
  { source: "api", operation: "previewInstagramPostMedia", routeOrJob: "/api/integrations/instagram/posts/[id]/media/[mediaId]" },
  async (request: NextRequest, { params }) => {
    const context = await requireInstagramSchedulerUser(request);
    const { id, mediaId } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(mediaId)) {
      throw new AppError({ code: "INSTAGRAM_POST_MEDIA_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Mídia não encontrada.", reportable: false });
    }
    const snapshot = await marketingDbAdmin.collection("instagramPosts").doc(id).get();
    const data = snapshot.data();
    const media = Array.isArray(data?.media)
      ? data.media.find((item: Record<string, unknown>) => item.id === mediaId)
      : null;
    const prefix = `instagram/editorial/${data?.folderPath}/media/`;
    if (!snapshot.exists || data?.workspace_id !== context.workspace_id || !media
      || typeof media.objectPath !== "string" || !media.objectPath.startsWith(prefix)
      || !["image/jpeg", "video/mp4", "video/quicktime"].includes(media.contentType)) {
      throw new AppError({ code: "INSTAGRAM_POST_MEDIA_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Mídia não encontrada.", reportable: false });
    }
    const [buffer] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(media.objectPath).download();
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": media.contentType,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
);
