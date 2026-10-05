import { NextRequest, NextResponse } from "next/server";

import { requireInstagramSchedulerAccess } from "@/features/instagram-scheduler/access.server";
import { instagramPostCreateSchema } from "@/features/instagram-posts/contracts";
import { createInstagramPost } from "@/features/instagram-posts/service.server";
import { serializeInstagramPost } from "@/features/instagram-posts/serialize.server";
import { requireUser } from "@/lib/auth-server";
import { marketingDbAdmin } from "@/lib/firebase-marketing-admin";
import { AppError } from "@/lib/observability/app-error";
import { withApiErrorHandling } from "@/lib/observability/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling(
  { source: "api", operation: "listInstagramPosts", routeOrJob: "/api/integrations/instagram/posts" },
  async (request: NextRequest) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);
    const requested = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 100) : 50;
    const status = request.nextUrl.searchParams.get("status");
    if (status && !["planned", "produced", "scheduled", "published"].includes(status)) {
      throw new AppError({ code: "INSTAGRAM_POST_INVALID_STATUS", kind: "VALIDATION", safeMessage: "Status editorial inválido.", reportable: false });
    }
    let query = marketingDbAdmin.collection("instagramPosts")
      .where("workspace_id", "==", context.workspace_id)
      .orderBy("updatedAt", "desc")
      .limit(limit);
    if (status) query = query.where("status", "==", status);
    const snapshot = await query.get();
    return NextResponse.json(
      { items: snapshot.docs.map(serializeInstagramPost) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
);

export const POST = withApiErrorHandling(
  { source: "api", operation: "createInstagramPost", routeOrJob: "/api/integrations/instagram/posts" },
  async (request: NextRequest) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);
    const parsed = instagramPostCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({
        code: "INSTAGRAM_POST_INVALID_INPUT",
        kind: "VALIDATION",
        safeMessage: parsed.error.issues[0]?.message ?? "Revise os dados do post.",
        reportable: false,
      });
    }
    const item = await createInstagramPost(context, parsed.data);
    return NextResponse.json({ item }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  },
);
