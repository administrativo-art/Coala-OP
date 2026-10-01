import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";

import {
  metaGraphApiVersion,
  metaInstagramAccountId,
  metaSystemUserToken,
} from "./instagram-meta-config.js";
import {
  instagramContentSnapshotStage,
  instagramSnapshotWindows,
  mergeInstagramInsightPayloads,
  parseInstagramContentSnapshot,
  parseInstagramSnapshotTotals,
  parseInstagramStorySnapshot,
  type InstagramContentSnapshot,
  type InstagramSnapshotWindow,
  type InstagramStorySnapshot,
} from "./instagram-insights-snapshot.js";

const db = getFirestore("coala");
const ACCOUNT_COLLECTION = "instagramAccountInsightsDaily";
const STORY_COLLECTION = "instagramStoryInsightSnapshots";
const CONTENT_COLLECTION = "instagramContentInsightSnapshots";

type GraphPayload = { data?: unknown };
type GraphMedia = Record<string, unknown>;

class MetaGraphError extends Error {
  readonly status: number;
  readonly code?: number;

  constructor(status: number, code?: number) {
    super(`Meta Graph respondeu HTTP ${status}.`);
    this.name = "MetaGraphError";
    this.status = status;
    this.code = code;
  }
}

function errorMetadata(error: unknown) {
  return error instanceof MetaGraphError
    ? { provider: "meta", providerStatus: error.status, providerCode: error.code }
    : { errorType: error instanceof Error ? error.name : "unknown" };
}

async function graphGet<T>(path: string, token: string, params: Record<string, string>): Promise<T> {
  const version = metaGraphApiVersion.value().replace(/^\/+|\/+$/g, "");
  const url = new URL(`https://graph.facebook.com/${version}/${path.replace(/^\//, "")}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({})) as T & {
    error?: { code?: number };
  };
  if (!response.ok || payload.error) throw new MetaGraphError(response.status, payload.error?.code);
  return payload;
}

async function optionalGraphGet<T>(path: string, token: string, params: Record<string, string>) {
  try {
    return await graphGet<T>(path, token, params);
  } catch (error) {
    logger.warn("[instagramInsightsSnapshotScheduler] optional Meta metric unavailable", {
      pathType: path.endsWith("/insights") ? "insights" : "other",
      ...errorMetadata(error),
    });
    return null;
  }
}

function mediaData(payload: GraphPayload | null) {
  return Array.isArray(payload?.data)
    ? payload.data.filter((item): item is GraphMedia => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await task(items[index]!);
    }
  }));
  return output;
}

async function fetchAccountDay(accountId: string, token: string, window: InstagramSnapshotWindow) {
  const params = { since: window.since, until: window.until, period: "day" };
  const [totals, follows] = await Promise.all([
    graphGet<GraphPayload>(`${accountId}/insights`, token, {
      ...params,
      metric: "views,reach,accounts_engaged,total_interactions,likes,comments,shares,saves,replies,reposts",
      metric_type: "total_value",
    }),
    optionalGraphGet<GraphPayload>(`${accountId}/insights`, token, {
      ...params,
      metric: "follows_and_unfollows",
      metric_type: "total_value",
      breakdown: "follow_type",
    }),
  ]);
  return {
    window,
    totals: parseInstagramSnapshotTotals(mergeInstagramInsightPayloads(totals, follows)),
  };
}

async function fetchStorySnapshots(accountId: string, token: string) {
  const stories = await graphGet<GraphPayload>(`${accountId}/stories`, token, {
    limit: "25",
    fields: "id,caption,media_type,media_product_type,permalink,timestamp",
  });
  return (await mapConcurrent(mediaData(stories), 3, async (media) => {
    const id = typeof media.id === "string" ? media.id : null;
    if (!id) return null;
    const [core, actions] = await Promise.all([
      optionalGraphGet<GraphPayload>(`${id}/insights`, token, { metric: "reach,views,shares,replies" }),
      optionalGraphGet<GraphPayload>(`${id}/insights`, token, { metric: "link_clicks,profile_activity" }),
    ]);
    return parseInstagramStorySnapshot(media, mergeInstagramInsightPayloads(core, actions));
  })).filter((story): story is InstagramStorySnapshot => story !== null);
}

async function fetchContentSnapshots(accountId: string, token: string, now: Date) {
  const mediaPayload = await graphGet<GraphPayload>(`${accountId}/media`, token, {
    limit: "50",
    fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
  });
  const candidates = mediaData(mediaPayload).flatMap((media) => {
    const publishedAt = typeof media.timestamp === "string" ? media.timestamp : "";
    const stage = instagramContentSnapshotStage(publishedAt, now);
    return stage ? [{ media, stage }] : [];
  });
  return (await mapConcurrent(candidates, 3, async ({ media, stage }) => {
    const id = typeof media.id === "string" ? media.id : null;
    if (!id) return null;
    const insights = await optionalGraphGet<GraphPayload>(`${id}/insights`, token, {
      metric: "reach,saved,shares,total_interactions,views",
    });
    const snapshot = parseInstagramContentSnapshot(media, insights);
    return snapshot ? { snapshot, stage } : null;
  })).filter((item): item is { snapshot: InstagramContentSnapshot; stage: "first48h" | "day7" | "day30" } => item !== null);
}

function formatFromContent(snapshot: InstagramContentSnapshot) {
  if (snapshot.mediaProductType?.toUpperCase() === "REELS") return "Reel";
  if (snapshot.mediaType?.toUpperCase() === "CAROUSEL_ALBUM") return "Carrossel";
  return "Feed";
}

async function writeSnapshots(params: {
  accountId: string;
  now: Date;
  profile: { username?: unknown; followers_count?: unknown; media_count?: unknown } | null;
  accountDays: Array<Awaited<ReturnType<typeof fetchAccountDay>>>;
  stories: InstagramStorySnapshot[];
  content: Array<{ snapshot: InstagramContentSnapshot; stage: "first48h" | "day7" | "day30" }>;
}) {
  const capturedAt = Timestamp.fromDate(params.now);
  const batch = db.batch();
  params.accountDays.forEach(({ window, totals }) => {
    const profileFields = window.current ? {
      username: typeof params.profile?.username === "string" ? params.profile.username : null,
      followersCount: typeof params.profile?.followers_count === "number" ? params.profile.followers_count : null,
      mediaCount: typeof params.profile?.media_count === "number" ? params.profile.media_count : null,
    } : {};
    batch.set(db.collection(ACCOUNT_COLLECTION).doc(window.date), {
      date: window.date,
      accountId: params.accountId,
      ...profileFields,
      ...totals,
      rangeSince: Timestamp.fromMillis(Number(window.since) * 1_000),
      rangeUntil: Timestamp.fromMillis(Number(window.until) * 1_000),
      settled: window.settled,
      capturedAt,
      captureCount: FieldValue.increment(1),
      schemaVersion: 1,
      source: "meta-graph-api",
    }, { merge: true });
  });

  params.stories.forEach((story) => {
    const publishedAt = Timestamp.fromDate(new Date(story.publishedAt));
    batch.set(db.collection(STORY_COLLECTION).doc(story.id), {
      ...story,
      accountId: params.accountId,
      format: "Story",
      publishedAt,
      expiresAtEstimate: Timestamp.fromMillis(publishedAt.toMillis() + 24 * 60 * 60 * 1_000),
      lastCapturedAt: capturedAt,
      captureCount: FieldValue.increment(1),
      schemaVersion: 1,
      source: "meta-graph-api",
    }, { merge: true });
  });

  params.content.forEach(({ snapshot, stage }) => {
    batch.set(db.collection(CONTENT_COLLECTION).doc(`${snapshot.id}_${stage}`), {
      ...snapshot,
      accountId: params.accountId,
      format: formatFromContent(snapshot),
      stage,
      publishedAt: Timestamp.fromDate(new Date(snapshot.publishedAt)),
      capturedAt,
      captureCount: FieldValue.increment(1),
      schemaVersion: 1,
      source: "meta-graph-api",
    }, { merge: true });
  });

  if (params.accountDays.length || params.stories.length || params.content.length) await batch.commit();
}

export const instagramInsightsSnapshotScheduler = onSchedule({
  schedule: "17 */6 * * *",
  timeZone: "America/Belem",
  retryCount: 0,
  timeoutSeconds: 300,
  memory: "256MiB",
  maxInstances: 1,
  secrets: [metaSystemUserToken],
}, async () => {
  const token = metaSystemUserToken.value().trim();
  if (!token) throw new Error("META_SYSTEM_USER_TOKEN não está configurado.");

  const accountId = metaInstagramAccountId.value().trim();
  if (!/^\d{8,32}$/.test(accountId)) throw new Error("META_INSTAGRAM_ACCOUNT_ID inválido.");
  const now = new Date();
  const windows = instagramSnapshotWindows(now, 3);

  const [profileResult, accountResults, storiesResult, contentResult] = await Promise.all([
    graphGet<{ username?: unknown; followers_count?: unknown; media_count?: unknown }>(accountId, token, {
      fields: "username,followers_count,media_count",
    }).then((value) => ({ value, error: null })).catch((error: unknown) => ({ value: null, error })),
    Promise.allSettled(windows.map((window) => fetchAccountDay(accountId, token, window))),
    fetchStorySnapshots(accountId, token)
      .then((value) => ({ value, error: null }))
      .catch((error: unknown) => ({ value: [], error })),
    fetchContentSnapshots(accountId, token, now)
      .then((value) => ({ value, error: null }))
      .catch((error: unknown) => ({ value: [], error })),
  ]);

  const accountDays = accountResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  await writeSnapshots({
    accountId,
    now,
    profile: profileResult.value,
    accountDays,
    stories: storiesResult.value,
    content: contentResult.value,
  });

  logger.info("[instagramInsightsSnapshotScheduler] snapshot completed", {
    accountDays: accountDays.length,
    stories: storiesResult.value.length,
    contentStages: contentResult.value.length,
  });

  if (profileResult.error) {
    logger.warn("[instagramInsightsSnapshotScheduler] profile unavailable", errorMetadata(profileResult.error));
  }
  accountResults.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.error("[instagramInsightsSnapshotScheduler] account day unavailable", {
        date: windows[index]?.date,
        ...errorMetadata(result.reason),
      });
    }
  });
  if (storiesResult.error) {
    logger.error("[instagramInsightsSnapshotScheduler] stories unavailable", errorMetadata(storiesResult.error));
  }
  if (contentResult.error) {
    logger.warn("[instagramInsightsSnapshotScheduler] content milestones unavailable", errorMetadata(contentResult.error));
  }

  const currentDayCaptured = accountDays.some((item) => item.window.current);
  if (!currentDayCaptured || storiesResult.error) {
    throw new Error("A coleta obrigatória de métricas do Instagram ficou incompleta.");
  }
});
