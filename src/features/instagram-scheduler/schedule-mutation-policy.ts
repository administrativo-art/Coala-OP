import type { InstagramPublicationStatus } from "./contracts";

export const INSTAGRAM_SCHEDULE_MIN_LEAD_MS = 120_000;

export function isInstagramScheduleEditableStatus(
  status: InstagramPublicationStatus | string | null | undefined,
) {
  return status === "scheduled";
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
