import sharp from "sharp";

import { AppError } from "@/lib/observability/app-error";

import type { InstagramMediaLibraryKind } from "./contracts";

export const INSTAGRAM_LIBRARY_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const INSTAGRAM_LIBRARY_VIDEO_MAX_BYTES = 24 * 1024 * 1024;

type DetectedMedia = {
  kind: InstagramMediaLibraryKind;
  contentType: string;
  extension: string;
  width: number | null;
  height: number | null;
};

function orientedDimensions(
  width: number | undefined,
  height: number | undefined,
  orientation: number | undefined,
) {
  if (!width || !height) return { width: null, height: null };
  return orientation && orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

function isIsoBaseMedia(buffer: Buffer) {
  return buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp";
}

export async function detectInstagramLibraryMedia(buffer: Buffer): Promise<DetectedMedia> {
  const isJpeg = buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff;
  const isPng = buffer.length >= 8
    && buffer[0] === 0x89
    && buffer.subarray(1, 4).toString("ascii") === "PNG";
  const isWebp = buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP";

  if (isJpeg || isPng || isWebp) {
    try {
      const metadata = await sharp(buffer, {
        failOn: "error",
        limitInputPixels: 32_000_000,
      }).metadata();
      const allowed = new Set(["jpeg", "png", "webp"]);
      if (!metadata.format || !allowed.has(metadata.format)) throw new Error("unsupported image");
      const dimensions = orientedDimensions(metadata.width, metadata.height, metadata.orientation);
      return {
        kind: "image",
        contentType: metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format}`,
        extension: metadata.format === "jpeg" ? "jpg" : metadata.format,
        ...dimensions,
      };
    } catch (cause) {
      throw new AppError({
        code: "INSTAGRAM_LIBRARY_INVALID_IMAGE",
        kind: "VALIDATION",
        safeMessage: "A imagem não pôde ser processada. Envie JPG, PNG ou WebP válido.",
        reportable: false,
        cause,
      });
    }
  }

  if (isIsoBaseMedia(buffer)) {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    const isQuickTime = brand === "qt  ";
    return {
      kind: "video",
      contentType: isQuickTime ? "video/quicktime" : "video/mp4",
      extension: isQuickTime ? "mov" : "mp4",
      width: null,
      height: null,
    };
  }

  throw new AppError({
    code: "INSTAGRAM_LIBRARY_INVALID_MEDIA",
    kind: "VALIDATION",
    safeMessage: "Envie uma imagem JPG, PNG ou WebP, ou um vídeo MP4 ou MOV válido.",
    reportable: false,
  });
}

export function safeInstagramLibraryFileName(value: string, extension: string) {
  const base = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 140) || "midia";
  return `${base}.${extension}`;
}
