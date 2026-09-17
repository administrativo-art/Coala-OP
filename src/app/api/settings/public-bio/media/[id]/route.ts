import { NextRequest, NextResponse } from "next/server";

import { AppError, withApiErrorHandling } from "@/lib/observability";
import { bioMediaFile, requireBioManager } from "@/lib/public-bio-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling<{ params: Promise<{ id: string }> }>({
  source: "api", operation: "get-draft-public-bio-image", routeOrJob: "/api/settings/public-bio/media/[id]",
}, async (request: NextRequest, { params }) => {
  await requireBioManager(request);
  const { id } = await params;
  const file = bioMediaFile(id);
  const [exists] = await file.exists();
  if (!exists) throw new AppError({ code: "PUBLIC_BIO_IMAGE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Imagem não encontrada." });
  const [buffer] = await file.download();
  return new NextResponse(new Uint8Array(buffer), { headers: {
    "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
});
