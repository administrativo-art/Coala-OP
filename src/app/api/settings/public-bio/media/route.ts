import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";

import { AppError, withApiErrorHandling } from "@/lib/observability";
import { bioMediaFile, BIO_IMAGE_MAX_BYTES, requireBioManager } from "@/lib/public-bio-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApiErrorHandling({
  source: "api", operation: "upload-public-bio-image", routeOrJob: "/api/settings/public-bio/media",
}, async (request: NextRequest) => {
  const actor = await requireBioManager(request);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size === 0 || file.size > BIO_IMAGE_MAX_BYTES) {
    throw new AppError({ code: "PUBLIC_BIO_INVALID_IMAGE", kind: "VALIDATION", safeMessage: "Envie JPG, PNG ou WebP com até 8 MB." });
  }
  const source = Buffer.from(await file.arrayBuffer());
  let optimized: Buffer;
  try {
    const image = sharp(source, { limitInputPixels: 24_000_000, failOn: "error" });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "")) throw new Error("unsupported format");
    optimized = await image.rotate().resize({ width: 1600, height: 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toBuffer();
  } catch {
    throw new AppError({ code: "PUBLIC_BIO_INVALID_IMAGE", kind: "VALIDATION", safeMessage: "A imagem não pôde ser processada. Envie JPG, PNG ou WebP válido." });
  }
  const id = randomUUID();
  await bioMediaFile(id).save(optimized, {
    resumable: false,
    metadata: { contentType: "image/webp", cacheControl: "private, no-store", metadata: { uploadedBy: actor.decoded.uid } },
  });
  return NextResponse.json({ id }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
});
