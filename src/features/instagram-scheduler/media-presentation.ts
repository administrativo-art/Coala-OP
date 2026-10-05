import type { InstagramPublicationFormat } from "./contracts";

export type MediaDimensions = { width?: number | null; height?: number | null };
export type PresentationMedia = MediaDimensions & { kind: "image" | "video" };

export function mediaRatio(media?: MediaDimensions | null): number | null {
  const { width, height } = media ?? {};
  return typeof width === "number" && typeof height === "number"
    && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height : null;
}

/** Same range enforced at the scheduling boundary; not the native app's editor. */
export function isFeedImageRatio(ratio: number) {
  return Number.isFinite(ratio) && ratio >= 0.8 && ratio <= 1.91;
}

export function mediaDimensionsLabel(media?: MediaDimensions | null) {
  const ratio = mediaRatio(media);
  if (!ratio || !media) return "Dimensões não disponíveis";
  const common = [[1, "1:1"], [4 / 5, "4:5"], [3 / 4, "3:4"], [9 / 16, "9:16"], [16 / 9, "16:9"], [1.91, "1,91:1"]] as const;
  const proportion = common.find(([value]) => Math.abs(value - ratio) < 0.002)?.[1]
    ?? `${ratio.toFixed(2).replace(".", ",")}:1`;
  return `${media.width} × ${media.height} px · ${proportion} · ${ratio === 1 ? "quadrada" : ratio < 1 ? "vertical" : "horizontal"}`;
}

export function mediaCompatibility(format: InstagramPublicationFormat, media?: PresentationMedia | null) {
  const ratio = mediaRatio(media);
  if (format === "reel" && media?.kind === "image") {
    return { status: "invalid", message: "Reels exigem vídeo; esta mídia é uma imagem." } as const;
  }
  if (format === "feed_image" && media?.kind === "video") {
    return { status: "invalid", message: "Este formato de Feed exige uma imagem." } as const;
  }
  if (!ratio) return { status: "unknown", message: "Não foi possível verificar a proporção desta mídia." } as const;
  if (format === "feed_image" || format === "carousel") {
    if (media?.kind === "video") return { status: "warning", message: "Dimensões identificadas. A compatibilidade técnica do vídeo ainda precisa ser validada." } as const;
    return isFeedImageRatio(ratio)
      ? { status: "compatible", message: "Proporção compatível com o Feed pelo agendador." } as const
      : { status: "invalid", message: "Fora da proporção aceita pelo agendador: use de 4:5 a 1,91:1." } as const;
  }
  const target = format === "story" ? "Stories" : "Reels";
  return Math.abs(ratio - 9 / 16) < 0.002
    ? { status: "compatible", message: `Proporção recomendada para ${target}: 9:16.${media?.kind === "video" ? " Duração e codec não verificados nesta prévia." : ""}` } as const
    : { status: "warning", message: `Para ${target}, recomenda-se 9:16 (1080 × 1920). A prévia preserva a mídia com margens; o Instagram pode ajustar o enquadramento.` } as const;
}

/** Feed uses the source ratio; a carousel uses the first frame. Vertical placements have a 9:16 viewport. */
export function mediaPreviewRatio(format: InstagramPublicationFormat, media?: MediaDimensions | null, first?: MediaDimensions | null) {
  if (format === "story" || format === "reel") return 9 / 16;
  return mediaRatio(format === "carousel" ? first : media) ?? 1;
}

export function carouselHasDifferentRatios(media: readonly MediaDimensions[]) {
  const first = mediaRatio(media[0]);
  return first !== null && media.some((item) => {
    const ratio = mediaRatio(item);
    return ratio !== null && Math.abs(ratio - first) > 0.002;
  });
}
