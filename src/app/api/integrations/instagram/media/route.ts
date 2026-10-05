import { NextRequest, NextResponse } from "next/server";

import { requireInstagramSchedulerAccess } from "@/features/instagram-scheduler/access.server";
import { instagramMediaFolderParentSchema } from "@/features/instagram-scheduler/contracts";
import {
  INSTAGRAM_LIBRARY_LIST_LIMIT,
  serializeInstagramLibraryMedia,
  storeInstagramLibraryMedia,
} from "@/features/instagram-scheduler/media-library.server";
import { requireInstagramMediaFolder } from "@/features/instagram-scheduler/media-folders.server";
import { requireUser } from "@/lib/auth-server";
import { marketingDbAdmin } from "@/lib/firebase-marketing-admin";
import { AppError } from "@/lib/observability/app-error";
import { withApiErrorHandling } from "@/lib/observability/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDIA_ID = /^[0-9a-f-]{36}$/i;

function invalid(message: string): never {
  throw new AppError({
    code: "INSTAGRAM_LIBRARY_INVALID_REQUEST",
    kind: "VALIDATION",
    safeMessage: message,
    reportable: false,
  });
}

/** `root` (ou ausente) = raiz da biblioteca; caso contrário, o UUID da pasta. */
function parseFolderParam(value: FormDataEntryValue | string | null) {
  if (value === null || value === "" || value === "root") return null;
  const parsed = instagramMediaFolderParentSchema.safeParse(value);
  if (!parsed.success) invalid("Pasta inválida.");
  return parsed.data;
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

    const params = request.nextUrl.searchParams;
    const folderId = parseFolderParam(params.get("folderId"));
    const cursor = params.get("cursor");
    if (cursor !== null && !MEDIA_ID.test(cursor)) invalid("Cursor inválido.");

    const collection = marketingDbAdmin.collection("instagramMediaLibrary");
    let query = collection
      .where("workspace_id", "==", context.workspace_id)
      .where("folderId", "==", folderId)
      .orderBy("createdAt", "desc")
      .limit(INSTAGRAM_LIBRARY_LIST_LIMIT + 1);
    if (cursor) {
      const cursorSnapshot = await collection.doc(cursor).get();
      if (!cursorSnapshot.exists || cursorSnapshot.data()?.workspace_id !== context.workspace_id) {
        invalid("Cursor inválido.");
      }
      query = query.startAfter(cursorSnapshot);
    }
    const snapshot = await query.get();
    const page = snapshot.docs.slice(0, INSTAGRAM_LIBRARY_LIST_LIMIT);

    return NextResponse.json(
      {
        items: page.map(serializeInstagramLibraryMedia),
        nextCursor: snapshot.docs.length > INSTAGRAM_LIBRARY_LIST_LIMIT ? page[page.length - 1]!.id : null,
      },
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
    const folderId = parseFolderParam(form.get("folderId"));
    if (!(file instanceof File)) {
      throw new AppError({
        code: "INSTAGRAM_LIBRARY_INVALID_UPLOAD",
        kind: "VALIDATION",
        safeMessage: "Selecione um arquivo.",
        reportable: false,
      });
    }
    await requireInstagramMediaFolder(context.workspace_id, folderId);

    const item = await storeInstagramLibraryMedia({
      context,
      file,
      folderId,
    });

    return NextResponse.json(
      { item },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  },
);
