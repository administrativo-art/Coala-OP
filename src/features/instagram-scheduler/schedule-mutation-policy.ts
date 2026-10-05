import type { InstagramPublicationStatus } from "./contracts";

export const INSTAGRAM_SCHEDULE_MIN_LEAD_MS = 120_000;

type StatusLike = InstagramPublicationStatus | string | null | undefined;

/** Data, legenda e ordem dos Stories só mudam enquanto o envio ainda não começou. */
export function isInstagramScheduleEditableStatus(status: StatusLike) {
  return status === "scheduled" || status === "paused";
}

export function canCancelInstagramSchedule(status: StatusLike) {
  return status === "scheduled" || status === "paused";
}

export function canPauseInstagramSchedule(status: StatusLike) {
  return status === "scheduled";
}

export function canResumeInstagramSchedule(status: StatusLike) {
  return status === "paused";
}

/** Tirar da grade só faz sentido para o que já terminou; o que ainda vai ao ar usa Pausar, Cancelar ou Excluir. */
export function canHideInstagramScheduleFromGrid(status: StatusLike) {
  return status === "published"
    || status === "failed"
    || status === "manual_review"
    || status === "cancelled";
}

/** Só `uploading` e `processing` ficam de fora: há envio em andamento. */
export function canDeleteInstagramSchedule(status: StatusLike) {
  return status === "scheduled"
    || status === "paused"
    || status === "published"
    || status === "failed"
    || status === "manual_review"
    || status === "cancelled";
}

export function isInstagramScheduleTimeAllowed(
  value: Date,
  nowMs = Date.now(),
) {
  return Number.isFinite(value.getTime())
    && value.getTime() >= nowMs + INSTAGRAM_SCHEDULE_MIN_LEAD_MS;
}

export function reorderInstagramStoryMedia<T>(
  media: readonly T[],
  order: readonly number[],
): T[] | null {
  if (media.length !== order.length) return null;
  const seen = new Set<number>();
  const reordered: T[] = [];

  for (const index of order) {
    if (!Number.isInteger(index) || index < 0 || index >= media.length || seen.has(index)) {
      return null;
    }
    seen.add(index);
    reordered.push(media[index]!);
  }

  return reordered;
}

export function hasPublishedInstagramStoryItem(progress: unknown) {
  if (!progress || typeof progress !== "object") return false;
  const storyItems = (progress as { storyItems?: unknown }).storyItems;
  if (!Array.isArray(storyItems)) return false;
  return storyItems.some(
    (item) => Boolean(item && typeof item === "object" && (item as { publishedMediaId?: unknown }).publishedMediaId),
  );
}

/** Never discard containers after a publication request, including ambiguous results. */
export function canReplaceInstagramCaption(progress: unknown) {
  if (!progress || typeof progress !== "object") return true;
  const value = progress as Record<string, unknown>;
  if (value.publishRequestStartedAt || value.publishedMediaId) return false;
  return !Array.isArray(value.storyItems) || !value.storyItems.some((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    const frame = item as Record<string, unknown>;
    return Boolean(frame.publishRequestStartedAt || frame.publishedMediaId);
  });
}
