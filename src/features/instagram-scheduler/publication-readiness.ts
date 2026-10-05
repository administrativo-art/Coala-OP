export const INSTAGRAM_PUBLICATION_RULES_VERSION = "meta-instagram-v25-2026-10-05";

export type InstagramPublicationFormat = "feed_image" | "carousel" | "reel" | "story";

export type InstagramPublicationMedia = {
  kind?: "image" | "video" | string;
  contentType?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  frameRate?: number | null;
  videoBitrateBps?: number | null;
  audioSampleRateHz?: number | null;
  fastStart?: boolean | null;
  hasEditList?: boolean | null;
};

export type InstagramPublicationIssue = {
  code: string;
  mediaIndex: number | null;
  message: string;
};

export type InstagramPublicationReadiness = {
  status: "certified" | "blocked";
  rulesVersion: typeof INSTAGRAM_PUBLICATION_RULES_VERSION;
  issues: InstagramPublicationIssue[];
};

const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const VIDEO_MAX_BYTES = 24 * 1024 * 1024;
const FEED_MIN_RATIO = 4 / 5;
const FEED_MAX_RATIO = 1.91;
const VERTICAL_RATIO = 9 / 16;
const VERTICAL_RATIO_TOLERANCE = 0.01;
const VIDEO_CODECS = new Set(["avc1", "avc3", "hvc1", "hev1"]);

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function issue(
  issues: InstagramPublicationIssue[],
  code: string,
  message: string,
  mediaIndex: number | null = null,
) {
  issues.push({ code, mediaIndex, message });
}

function validateImage(
  media: InstagramPublicationMedia,
  index: number,
  format: InstagramPublicationFormat,
  issues: InstagramPublicationIssue[],
) {
  if (media.contentType !== "image/jpeg") {
    issue(issues, "IMAGE_NOT_JPEG", "A imagem oficial precisa estar em JPEG.", index);
  }
  if (!finitePositive(media.sizeBytes) || media.sizeBytes > IMAGE_MAX_BYTES) {
    issue(issues, "IMAGE_SIZE_INVALID", "A imagem precisa ter até 8 MB.", index);
  }
  if (!finitePositive(media.width) || !finitePositive(media.height)) {
    issue(issues, "IMAGE_DIMENSIONS_MISSING", "Não foi possível certificar as dimensões da imagem.", index);
    return;
  }
  if (media.width < 320 || media.width > 1_440) {
    issue(issues, "IMAGE_WIDTH_INVALID", "A largura da imagem precisa ficar entre 320 e 1440 pixels.", index);
  }
  const ratio = media.width / media.height;
  if (format === "story") {
    if (Math.abs(ratio - VERTICAL_RATIO) > VERTICAL_RATIO_TOLERANCE) {
      issue(issues, "STORY_RATIO_INVALID", "A imagem de Story precisa estar em 9:16, preferencialmente 1080 × 1920.", index);
    }
  } else if (ratio < FEED_MIN_RATIO || ratio > FEED_MAX_RATIO) {
    issue(issues, "FEED_RATIO_INVALID", "A imagem de Feed ou carrossel precisa ter proporção entre 4:5 e 1,91:1.", index);
  }
}

function validateVideo(
  media: InstagramPublicationMedia,
  index: number,
  format: InstagramPublicationFormat,
  issues: InstagramPublicationIssue[],
) {
  if (!new Set(["video/mp4", "video/quicktime"]).has(String(media.contentType))) {
    issue(issues, "VIDEO_CONTAINER_INVALID", "O vídeo precisa estar em MP4 ou MOV.", index);
  }
  if (!finitePositive(media.sizeBytes) || media.sizeBytes > VIDEO_MAX_BYTES) {
    issue(issues, "VIDEO_SIZE_INVALID", "O vídeo precisa ter até 24 MB no Coala One.", index);
  }
  if (!finitePositive(media.width) || !finitePositive(media.height)) {
    issue(issues, "VIDEO_DIMENSIONS_MISSING", "Não foi possível certificar as dimensões do vídeo.", index);
  } else {
    const ratio = media.width / media.height;
    if (format === "story" || format === "reel") {
      if (Math.abs(ratio - VERTICAL_RATIO) > VERTICAL_RATIO_TOLERANCE) {
        issue(issues, "VERTICAL_VIDEO_RATIO_INVALID", "Stories e Reels precisam estar em 9:16, preferencialmente 1080 × 1920.", index);
      }
    } else if (ratio < FEED_MIN_RATIO || ratio > FEED_MAX_RATIO) {
      issue(issues, "CAROUSEL_VIDEO_RATIO_INVALID", "O vídeo do carrossel precisa ter proporção entre 4:5 e 1,91:1.", index);
    }
    if (media.width > 1_920) {
      issue(issues, "VIDEO_WIDTH_INVALID", "O vídeo pode ter no máximo 1920 pixels na horizontal.", index);
    }
  }

  if (!media.videoCodec || !VIDEO_CODECS.has(media.videoCodec.toLowerCase())) {
    issue(issues, "VIDEO_CODEC_INVALID", "O vídeo precisa usar H.264 ou HEVC.", index);
  }
  if (media.audioCodec && media.audioCodec.toLowerCase() !== "mp4a") {
    issue(issues, "AUDIO_CODEC_INVALID", "Quando houver áudio, ele precisa usar AAC.", index);
  }
  if (!finitePositive(media.frameRate) || media.frameRate < 23 || media.frameRate > 60) {
    issue(issues, "VIDEO_FRAME_RATE_INVALID", "O vídeo precisa ter entre 23 e 60 FPS.", index);
  }
  if (!finitePositive(media.durationSeconds)) {
    issue(issues, "VIDEO_DURATION_MISSING", "Não foi possível certificar a duração do vídeo.", index);
  } else {
    const maximum = format === "story" ? 60 : 15 * 60;
    if (media.durationSeconds < 3 || media.durationSeconds > maximum) {
      issue(
        issues,
        "VIDEO_DURATION_INVALID",
        format === "story" ? "Cada Story em vídeo precisa ter de 3 a 60 segundos." : "O vídeo precisa ter de 3 segundos a 15 minutos.",
        index,
      );
    }
  }
  if (!finitePositive(media.videoBitrateBps) || media.videoBitrateBps > 25_000_000) {
    issue(issues, "VIDEO_BITRATE_INVALID", "O bitrate total estimado do vídeo precisa ser de até 25 Mbps.", index);
  }
  if (finitePositive(media.audioSampleRateHz) && media.audioSampleRateHz > 48_000) {
    issue(issues, "AUDIO_SAMPLE_RATE_INVALID", "O áudio precisa usar frequência de até 48 kHz.", index);
  }
  if (media.fastStart !== true) {
    issue(issues, "VIDEO_FAST_START_REQUIRED", "O vídeo precisa ter o átomo moov antes do mdat (fast start).", index);
  }
  if (media.hasEditList !== false) {
    issue(issues, "VIDEO_EDIT_LIST_NOT_ALLOWED", "O vídeo não pode conter edit lists.", index);
  }
}

export function certifyInstagramPublication(input: {
  format: InstagramPublicationFormat;
  media: InstagramPublicationMedia[];
}): InstagramPublicationReadiness {
  const { format, media } = input;
  const issues: InstagramPublicationIssue[] = [];
  const imageCount = media.filter((item) => item.kind === "image").length;
  const videoCount = media.filter((item) => item.kind === "video").length;

  if (format === "feed_image" && (media.length !== 1 || imageCount !== 1)) {
    issue(issues, "FEED_MEDIA_COUNT_INVALID", "Uma publicação de Feed exige exatamente uma imagem.");
  }
  if (format === "carousel" && (media.length < 2 || media.length > 10)) {
    issue(issues, "CAROUSEL_MEDIA_COUNT_INVALID", "Um carrossel exige de duas a dez mídias.");
  }
  if (format === "reel" && (media.length !== 1 || videoCount !== 1)) {
    issue(issues, "REEL_MEDIA_COUNT_INVALID", "Um Reel exige exatamente um vídeo.");
  }
  if (format === "story" && (media.length < 1 || media.length > 10)) {
    issue(issues, "STORY_MEDIA_COUNT_INVALID", "Uma sequência de Stories exige de uma a dez mídias.");
  }

  media.forEach((item, index) => {
    if (item.kind === "image") validateImage(item, index, format, issues);
    else if (item.kind === "video") validateVideo(item, index, format, issues);
    else issue(issues, "MEDIA_KIND_INVALID", "O tipo da mídia não é compatível com o Instagram.", index);
  });

  if (format === "carousel" && media.length >= 2) {
    const ratios = media.map((item) => finitePositive(item.width) && finitePositive(item.height) ? item.width / item.height : null);
    const first = ratios[0];
    if (first && ratios.some((ratio) => ratio !== null && Math.abs(ratio - first) > 0.01)) {
      issue(issues, "CAROUSEL_RATIO_MISMATCH", "Todas as mídias do carrossel precisam usar a mesma proporção para evitar cortes.");
    }
  }

  return {
    status: issues.length === 0 ? "certified" : "blocked",
    rulesVersion: INSTAGRAM_PUBLICATION_RULES_VERSION,
    issues,
  };
}
