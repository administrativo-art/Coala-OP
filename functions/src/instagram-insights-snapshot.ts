const DAY_MS = 24 * 60 * 60 * 1_000;

type UnknownRecord = Record<string, unknown>;

export type InstagramSnapshotTotals = {
  views: number | null;
  reach: number | null;
  accountsEngaged: number | null;
  totalInteractions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  replies: number | null;
  reposts: number | null;
  follows: number | null;
  unfollows: number | null;
};

export type InstagramSnapshotWindow = {
  date: string;
  since: string;
  until: string;
  current: boolean;
  settled: boolean;
};

export type InstagramStorySnapshot = {
  id: string;
  caption: string;
  permalink: string | null;
  publishedAt: string;
  mediaType: string | null;
  views: number | null;
  reach: number | null;
  shares: number | null;
  replies: number | null;
  bioLinkClicks: number | null;
  storyLinkClicks: number | null;
};

export type InstagramContentSnapshot = {
  id: string;
  caption: string;
  permalink: string | null;
  publishedAt: string;
  mediaType: string | null;
  mediaProductType: string | null;
  views: number | null;
  reach: number | null;
  totalInteractions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
};

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function insightValue(item: UnknownRecord): unknown {
  const total = record(item.total_value);
  if (total && "value" in total) return total.value;
  if (Array.isArray(item.values) && item.values.length > 0) {
    return record(item.values[item.values.length - 1])?.value;
  }
  return undefined;
}

function metricItems(payload: unknown) {
  const data = record(payload)?.data;
  return Array.isArray(data) ? data.map(record).filter((item) => item !== null) : [];
}

function metricMap(payload: unknown) {
  const result = new Map<string, unknown>();
  metricItems(payload).forEach((item) => {
    const name = text(item.name);
    if (name) result.set(name, insightValue(item));
  });
  return result;
}

function breakdownNumber(value: unknown, dimension: string): number | null {
  const breakdowns = record(value)?.breakdowns;
  if (!Array.isArray(breakdowns)) return null;
  for (const candidate of breakdowns) {
    const results = record(candidate)?.results;
    if (!Array.isArray(results)) continue;
    for (const candidateResult of results) {
      const result = record(candidateResult);
      const dimensions = Array.isArray(result?.dimension_values) ? result.dimension_values : [];
      if (dimensions.includes(dimension)) return finiteNumber(result?.value);
    }
  }
  return null;
}

function metricItem(payload: unknown, name: string) {
  return metricItems(payload).find((item) => text(item.name) === name) ?? null;
}

function safeHttpsUrl(value: unknown) {
  const candidate = text(value);
  return candidate?.startsWith("https://") ? candidate : null;
}

export function mergeInstagramInsightPayloads(...payloads: Array<{ data?: unknown } | null>) {
  return {
    data: payloads.flatMap((payload) => Array.isArray(payload?.data) ? payload.data : []),
  };
}

export function parseInstagramSnapshotTotals(payload: unknown): InstagramSnapshotTotals {
  const metrics = metricMap(payload);
  const followsAndUnfollows = metricItem(payload, "follows_and_unfollows")?.total_value;
  return {
    views: finiteNumber(metrics.get("views")),
    reach: finiteNumber(metrics.get("reach")),
    accountsEngaged: finiteNumber(metrics.get("accounts_engaged")),
    totalInteractions: finiteNumber(metrics.get("total_interactions")),
    likes: finiteNumber(metrics.get("likes")),
    comments: finiteNumber(metrics.get("comments")),
    shares: finiteNumber(metrics.get("shares")),
    saves: finiteNumber(metrics.get("saves")),
    replies: finiteNumber(metrics.get("replies")),
    reposts: finiteNumber(metrics.get("reposts")),
    follows: breakdownNumber(followsAndUnfollows, "FOLLOWER"),
    unfollows: breakdownNumber(followsAndUnfollows, "NON_FOLLOWER"),
  };
}

function localMidnight(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(
    parts.find((part) => part.type === type)?.value ?? 0,
  );
  return new Date(Date.UTC(number("year"), number("month") - 1, number("day"), 3));
}

export function instagramSnapshotWindows(now: Date, days = 3): InstagramSnapshotWindow[] {
  if (!Number.isInteger(days) || days < 1) return [];
  const currentStart = localMidnight(now);
  return Array.from({ length: days }, (_, index) => {
    const start = new Date(currentStart.getTime() - index * DAY_MS);
    const end = index === 0 ? now : new Date(start.getTime() + DAY_MS - 1_000);
    return {
      date: start.toISOString().slice(0, 10),
      since: String(Math.floor(start.getTime() / 1_000)),
      until: String(Math.floor(end.getTime() / 1_000)),
      current: index === 0,
      settled: index >= 2,
    };
  });
}

export function parseInstagramStorySnapshot(mediaValue: unknown, insightsPayload: unknown): InstagramStorySnapshot | null {
  const media = record(mediaValue);
  const id = text(media?.id);
  const publishedAt = text(media?.timestamp);
  if (!media || !id || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || !publishedAt || Number.isNaN(Date.parse(publishedAt))) {
    return null;
  }
  const metrics = metricMap(insightsPayload);
  const profileActivity = metricItem(insightsPayload, "profile_activity")?.total_value;
  return {
    id,
    caption: (text(media.caption) ?? "").slice(0, 2_200),
    permalink: safeHttpsUrl(media.permalink),
    publishedAt: new Date(publishedAt).toISOString(),
    mediaType: text(media.media_type),
    views: finiteNumber(metrics.get("views")),
    reach: finiteNumber(metrics.get("reach")),
    shares: finiteNumber(metrics.get("shares")),
    replies: finiteNumber(metrics.get("replies")),
    bioLinkClicks: breakdownNumber(profileActivity, "BIO_LINK_CLICKED"),
    storyLinkClicks: finiteNumber(metrics.get("link_clicks")),
  };
}

export function parseInstagramContentSnapshot(mediaValue: unknown, insightsPayload: unknown): InstagramContentSnapshot | null {
  const media = record(mediaValue);
  const id = text(media?.id);
  const publishedAt = text(media?.timestamp);
  if (!media || !id || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || !publishedAt || Number.isNaN(Date.parse(publishedAt))) {
    return null;
  }
  const metrics = metricMap(insightsPayload);
  return {
    id,
    caption: (text(media.caption) ?? "").slice(0, 2_200),
    permalink: safeHttpsUrl(media.permalink),
    publishedAt: new Date(publishedAt).toISOString(),
    mediaType: text(media.media_type),
    mediaProductType: text(media.media_product_type),
    views: finiteNumber(metrics.get("views")),
    reach: finiteNumber(metrics.get("reach")),
    totalInteractions: finiteNumber(metrics.get("total_interactions")),
    likes: finiteNumber(metrics.get("likes")) ?? finiteNumber(media.like_count),
    comments: finiteNumber(metrics.get("comments")) ?? finiteNumber(media.comments_count),
    shares: finiteNumber(metrics.get("shares")),
    saves: finiteNumber(metrics.get("saved")),
  };
}

export function instagramContentSnapshotStage(publishedAt: string, now: Date): "first48h" | "day7" | "day30" | null {
  const age = now.getTime() - Date.parse(publishedAt);
  if (!Number.isFinite(age) || age < 0) return null;
  if (age < 2 * DAY_MS) return "first48h";
  if (age >= 7 * DAY_MS && age < 8 * DAY_MS) return "day7";
  if (age >= 30 * DAY_MS && age < 31 * DAY_MS) return "day30";
  return null;
}
