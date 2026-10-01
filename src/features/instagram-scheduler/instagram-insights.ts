import type {
  InstagramInsightContentItem,
  InstagramInsightTotals,
} from "./contracts";

type UnknownRecord = Record<string, unknown>;

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
  if (Array.isArray(item.values) && item.values.length) {
    return record(item.values.at(-1))?.value;
  }
  return undefined;
}

export function metricMap(payload: unknown): Map<string, unknown> {
  const data = record(payload)?.data;
  const result = new Map<string, unknown>();
  if (!Array.isArray(data)) return result;
  for (const candidate of data) {
    const item = record(candidate);
    const name = text(item?.name);
    if (item && name) result.set(name, insightValue(item));
  }
  return result;
}

function metricItem(payload: unknown, metricName: string): UnknownRecord | null {
  const data = record(payload)?.data;
  if (!Array.isArray(data)) return null;
  return data.map(record).find((item) => text(item?.name) === metricName) ?? null;
}

function breakdownNumber(value: unknown, dimension: string): number | null {
  const total = record(value);
  const breakdowns = total?.breakdowns;
  if (!Array.isArray(breakdowns)) return null;
  for (const candidate of breakdowns) {
    const breakdown = record(candidate);
    const results = breakdown?.results;
    if (!Array.isArray(results)) continue;
    for (const candidateResult of results) {
      const result = record(candidateResult);
      const keys = Array.isArray(result?.dimension_values) ? result.dimension_values : [];
      if (keys.includes(dimension)) return finiteNumber(result?.value);
    }
  }
  return null;
}

export function parseAccountInsightTotals(payload: unknown): InstagramInsightTotals {
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

export function sumAccountInsightTotals(values: InstagramInsightTotals[]): InstagramInsightTotals {
  const sum = (key: keyof InstagramInsightTotals) => {
    const available = values.map((value) => value[key]).filter((value): value is number => value !== null);
    return available.length ? available.reduce((total, value) => total + value, 0) : null;
  };
  return {
    views: sum("views"),
    reach: sum("reach"),
    accountsEngaged: sum("accountsEngaged"),
    totalInteractions: sum("totalInteractions"),
    likes: sum("likes"),
    comments: sum("comments"),
    shares: sum("shares"),
    saves: sum("saves"),
    replies: sum("replies"),
    reposts: sum("reposts"),
    follows: sum("follows"),
    unfollows: sum("unfollows"),
  };
}

export function mergeReachSeries(series: Array<Array<{ date: string; value: number }>>) {
  const merged = new Map<string, number>();
  series.flat().forEach((point) => merged.set(point.date, (merged.get(point.date) ?? 0) + point.value));
  return [...merged.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function parseReachSeries(payload: unknown): Array<{ date: string; value: number }> {
  const data = record(payload)?.data;
  if (!Array.isArray(data)) return [];
  const reach = data.map(record).find((item) => text(item?.name) === "reach");
  if (!reach || !Array.isArray(reach.values)) return [];
  return reach.values.flatMap((candidate) => {
    const value = record(candidate);
    const endTime = text(value?.end_time);
    const amount = finiteNumber(value?.value);
    if (!endTime || amount === null) return [];
    const date = new Date(endTime);
    if (Number.isNaN(date.getTime())) return [];
    return [{ date: date.toISOString().slice(0, 10), value: amount }];
  });
}

function contentFormat(media: UnknownRecord, story: boolean): InstagramInsightContentItem["format"] {
  if (story) return "Story";
  if (text(media.media_product_type)?.toUpperCase() === "REELS") return "Reel";
  if (text(media.media_type)?.toUpperCase() === "CAROUSEL_ALBUM") return "Carrossel";
  return "Feed";
}

function profileActivityBioClicks(payload: unknown): number | null {
  const item = metricItem(payload, "profile_activity");
  const breakdown = breakdownNumber(item?.total_value, "BIO_LINK_CLICKED");
  if (breakdown !== null) return breakdown;
  return finiteNumber(insightValue(item ?? {}));
}

export function parseContentInsight(
  mediaValue: unknown,
  insightsPayload: unknown,
  options: { story?: boolean } = {},
): InstagramInsightContentItem | null {
  const media = record(mediaValue);
  const id = text(media?.id);
  const publishedAt = text(media?.timestamp);
  if (!media || !id || !publishedAt || Number.isNaN(Date.parse(publishedAt))) return null;
  const metrics = metricMap(insightsPayload);
  const mediaUrl = text(media.thumbnail_url) ?? text(media.media_url);
  return {
    id,
    format: contentFormat(media, options.story === true),
    caption: text(media.caption) ?? "",
    previewUrl: mediaUrl?.startsWith("https://") ? mediaUrl : null,
    permalink: text(media.permalink)?.startsWith("https://") ? text(media.permalink) : null,
    publishedAt: new Date(publishedAt).toISOString(),
    views: finiteNumber(metrics.get("views")),
    reach: finiteNumber(metrics.get("reach")),
    totalInteractions: finiteNumber(metrics.get("total_interactions")),
    likes: finiteNumber(metrics.get("likes")) ?? finiteNumber(media.like_count),
    comments: finiteNumber(metrics.get("comments")) ?? finiteNumber(media.comments_count),
    shares: finiteNumber(metrics.get("shares")),
    saves: finiteNumber(metrics.get("saved")),
    replies: finiteNumber(metrics.get("replies")),
    bioLinkClicks: profileActivityBioClicks(insightsPayload),
    storyLinkClicks: finiteNumber(metrics.get("link_clicks")),
  };
}

export function mediaData(payload: unknown): unknown[] {
  const data = record(payload)?.data;
  return Array.isArray(data) ? data : [];
}
