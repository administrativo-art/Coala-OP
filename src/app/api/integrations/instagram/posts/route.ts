import { NextRequest, NextResponse } from "next/server";
import { FieldPath, Timestamp } from "firebase-admin/firestore";

import { requireInstagramSchedulerUser } from "@/features/instagram-scheduler/access.server";
import { instagramPostCreateSchema } from "@/features/instagram-posts/contracts";
import { createInstagramPost } from "@/features/instagram-posts/service.server";
import { serializeInstagramPost } from "@/features/instagram-posts/serialize.server";
import { marketingDbAdmin } from "@/lib/firebase-marketing-admin";
import { AppError } from "@/lib/observability/app-error";
import { withApiErrorHandling } from "@/lib/observability/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decodeCursor(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { updatedAt?: string; id?: string };
    const date = parsed.updatedAt ? new Date(parsed.updatedAt) : null;
    return date && !Number.isNaN(date.getTime()) && parsed.id
      ? { updatedAt: Timestamp.fromDate(date), id: parsed.id }
      : null;
  } catch {
    return null;
  }
}

export const GET = withApiErrorHandling(
  { source: "api", operation: "listInstagramPosts", routeOrJob: "/api/integrations/instagram/posts" },
  async (request: NextRequest) => {
    const context = await requireInstagramSchedulerUser(request);
    const requested = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 100) : 50;
    const status = request.nextUrl.searchParams.get("status");
    if (status && !["planned", "produced", "scheduled", "published"].includes(status)) {
      throw new AppError({ code: "INSTAGRAM_POST_INVALID_STATUS", kind: "VALIDATION", safeMessage: "Status editorial inválido.", reportable: false });
    }
    const updatedAfterInput = request.nextUrl.searchParams.get("updatedAfter");
    const updatedAfterDate = updatedAfterInput ? new Date(updatedAfterInput) : null;
    if (updatedAfterInput && (!updatedAfterDate || Number.isNaN(updatedAfterDate.getTime()))) {
      throw new AppError({ code: "INSTAGRAM_POST_INVALID_UPDATED_AFTER", kind: "VALIDATION", safeMessage: "Data de sincronização inválida.", reportable: false });
    }
    const cursorInput = request.nextUrl.searchParams.get("cursor");
    const cursor = decodeCursor(cursorInput);
    if (cursorInput && !cursor) {
      throw new AppError({ code: "INSTAGRAM_POST_INVALID_CURSOR", kind: "VALIDATION", safeMessage: "Cursor de sincronização inválido.", reportable: false });
    }
    let query = marketingDbAdmin.collection("instagramPosts")
      .where("workspace_id", "==", context.workspace_id)
      .orderBy("updatedAt", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .limit(limit);
    if (status) query = query.where("status", "==", status);
    if (updatedAfterDate) query = query.where("updatedAt", ">", Timestamp.fromDate(updatedAfterDate));
    if (cursor) query = query.startAfter(cursor.updatedAt, cursor.id);
    const snapshot = await query.get();
    const last = snapshot.docs.at(-1);
    const nextCursor = snapshot.docs.length === limit && last
      ? Buffer.from(JSON.stringify({
          updatedAt: last.data().updatedAt?.toDate?.().toISOString?.() ?? null,
          id: last.id,
        }), "utf8").toString("base64url")
      : null;
    return NextResponse.json(
      { items: snapshot.docs.map(serializeInstagramPost), nextCursor },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
);

export const POST = withApiErrorHandling(
  { source: "api", operation: "createInstagramPost", routeOrJob: "/api/integrations/instagram/posts" },
  async (request: NextRequest) => {
    const context = await requireInstagramSchedulerUser(request);
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
