import { NextRequest, NextResponse } from "next/server";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";

import { requireInstagramSchedulerAccess } from "@/features/instagram-scheduler/access.server";
import { instagramMediaLibraryFolderSchema } from "@/features/instagram-scheduler/contracts";
import {
  INSTAGRAM_LIBRARY_LIST_LIMIT,
  serializeInstagramLibraryMedia,
  storeInstagramLibraryMedia,
} from "@/features/instagram-scheduler/media-library.server";
import { requireUser } from "@/lib/auth-server";
import {
  legacyMarketingDbAdmin,
  marketingDbAdmin,
  shouldReadLegacyMarketingDatabase,
} from "@/lib/firebase-marketing-admin";
import { AppError } from "@/lib/observability/app-error";
import { withApiErrorHandling } from "@/lib/observability/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isMissingIndexError(cause: unknown) {
  const code = (cause as { code?: unknown } | null)?.code;
  return code === 9 || code === "9" || code === "failed-precondition";
}

function createdAtMillis(doc: DocumentSnapshot) {
  const value = doc.data()?.createdAt;
  return typeof value?.toMillis === "function" ? value.toMillis() : 0;
}

async function listWorkspaceMediaFrom(db: Firestore, workspaceId: string) {
  const collection = db.collection("instagramMediaLibrary");
  try {
    const snapshot = await collection
      .where("workspace_id", "==", workspaceId)
      .orderBy("createdAt", "desc")
      .limit(INSTAGRAM_LIBRARY_LIST_LIMIT)
      .get();
    return snapshot.docs;
  } catch (cause) {
    if (!isMissingIndexError(cause)) throw cause;
    const snapshot = await collection
      .where("workspace_id", "==", workspaceId)
      .limit(INSTAGRAM_LIBRARY_LIST_LIMIT)
      .get();
    return snapshot.docs.sort((left, right) => createdAtMillis(right) - createdAtMillis(left));
  }
}

export const GET = withApiErrorHandling(
  {
    source: "api",
    operation: "listInstagramMediaLibrary",
    routeOrJob: "/api/integrations/instagram/media",
  },
  async (request: NextRequest) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);

    const [currentDocs, legacyDocs] = await Promise.all([
      listWorkspaceMediaFrom(marketingDbAdmin, context.workspace_id),
      shouldReadLegacyMarketingDatabase()
        ? listWorkspaceMediaFrom(legacyMarketingDbAdmin, context.workspace_id)
        : Promise.resolve([]),
    ]);
    const byId = new Map(legacyDocs.map((doc) => [doc.id, doc]));
    currentDocs.forEach((doc) => byId.set(doc.id, doc));
    const docs = [...byId.values()]
      .sort((left, right) => createdAtMillis(right) - createdAtMillis(left))
      .slice(0, INSTAGRAM_LIBRARY_LIST_LIMIT);

    return NextResponse.json(
      { items: docs.map(serializeInstagramLibraryMedia) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
);

export const POST = withApiErrorHandling(
  {
    source: "api",
    operation: "uploadInstagramMediaLibrary",
    routeOrJob: "/api/integrations/instagram/media",
  },
  async (request: NextRequest) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);

    const form = await request.formData();
    const file = form.get("file");
    const folderResult = instagramMediaLibraryFolderSchema.safeParse(form.get("folder") ?? "Uploads");
    if (!(file instanceof File) || !folderResult.success) {
      throw new AppError({
        code: "INSTAGRAM_LIBRARY_INVALID_UPLOAD",
        kind: "VALIDATION",
        safeMessage: folderResult.success ? "Selecione um arquivo." : folderResult.error.issues[0]?.message,
        reportable: false,
      });
    }

    const item = await storeInstagramLibraryMedia({
      context,
      file,
      folder: folderResult.data,
    });

    return NextResponse.json(
      { item },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  },
);
