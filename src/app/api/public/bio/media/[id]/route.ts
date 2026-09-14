import { NextRequest, NextResponse } from "next/server";

import { dbAdmin } from "@/lib/firebase-admin";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { publicBioProjection } from "@/lib/public-bio";
import { bioMediaFile } from "@/lib/public-bio-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiErrorHandling<{ params: Promise<{ id: string }> }>({
  source: "api", operation: "get-published-bio-image", routeOrJob: "/api/public/bio/media/[id]",
}, async (_request: NextRequest, { params }) => {
  const { id } = await params;
  const snapshot = await dbAdmin.collection("public_site_settings").doc("coala-bio").get();
  const page = publicBioProjection(snapshot.get("published"));
  if (!page || ![...page.menuImages, ...page.promotionImages].some((image) => image.id === id)) {
    throw new AppError({ code: "PUBLIC_BIO_IMAGE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Imagem não encontrada." });
  }
  const file = bioMediaFile(id);
  const [exists] = await file.exists();
  if (!exists) throw new AppError({ code: "PUBLIC_BIO_IMAGE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Imagem não encontrada." });
  const [buffer] = await file.download();
  return new NextResponse(new Uint8Array(buffer), { headers: {
    "Content-Type": "image/webp", "Cache-Control": "public, max-age=60, s-maxage=300", "X-Content-Type-Options": "nosniff",
  } });
});
