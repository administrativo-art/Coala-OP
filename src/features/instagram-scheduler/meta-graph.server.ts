import "server-only";

import { adminApp } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";

import {
  mediaData,
  mergeReachSeries,
  parseAccountInsightTotals,
  parseContentInsight,
  parseReachSeries,
  sumAccountInsightTotals,
} from "./instagram-insights";
import {
  parseInstagramPublishedFeed,
  parseInstagramPublishedProfile,
} from "./published-feed";
import type { InstagramInsightsDays } from "./contracts";

const DEFAULT_PROJECT_ID = "smart-converter-752gf";
const DEFAULT_INSTAGRAM_ACCOUNT_ID = "17841476184089270";
const DEFAULT_GRAPH_VERSION = "v25.0";
const TOKEN_CACHE_MS = 5 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_INSIGHTS_WINDOW_SECONDS = 30 * 24 * 60 * 60 - 1;

let cachedToken: { value: string; expiresAt: number } | null = null;

function firebaseProjectId() {
  const configured = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.FIREBASE_PROJECT_ID;
  if (configured) return configured;
  try {
    const config = JSON.parse(process.env.FIREBASE_CONFIG ?? "{}") as { projectId?: unknown };
    if (typeof config.projectId === "string" && config.projectId) return config.projectId;
  } catch {
    // O fallback abaixo mantém o projeto local explícito.
  }
  return DEFAULT_PROJECT_ID;
}

async function tokenFromSecretManager() {
  const credential = adminApp.options.credential;
  if (!credential) throw new Error("Credencial Google indisponível.");
  const accessToken = await credential.getAccessToken();
  if (!accessToken.access_token) throw new Error("Credencial Google indisponível.");

  const projectId = firebaseProjectId();
  const secretName = process.env.META_SYSTEM_USER_TOKEN_SECRET ?? "META_SYSTEM_USER_TOKEN";
  const url = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/secrets/${encodeURIComponent(secretName)}/versions/latest:access`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken.access_token}` },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as {
    payload?: { data?: unknown };
  };
  if (!response.ok || typeof payload.payload?.data !== "string") {
    throw new Error(`Secret Manager respondeu HTTP ${response.status}.`);
  }
  return Buffer.from(payload.payload.data, "base64").toString("utf8").trim();
}

async function metaToken() {
  const configured = process.env.META_SYSTEM_USER_TOKEN?.trim();
  if (configured) return configured;
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  try {
    const value = await tokenFromSecretManager();
    if (!value) throw new Error("Token Meta vazio.");
    cachedToken = { value, expiresAt: Date.now() + TOKEN_CACHE_MS };
    return value;
  } catch (cause) {
    throw new AppError({
      code: "INSTAGRAM_FEED_CREDENTIAL_UNAVAILABLE",
      kind: "PERMANENT_EXTERNAL",
      safeMessage: "A credencial para consultar o Instagram não está disponível.",
      cause,
      metadata: { provider: "meta" },
    });
  }
}

type GraphErrorContext = {
  code: string;
  safeMessage: string;
};

const feedError: GraphErrorContext = {
  code: "INSTAGRAM_FEED_GRAPH_ERROR",
  safeMessage: "Não foi possível carregar a grade atual do Instagram.",
};

const insightsError: GraphErrorContext = {
  code: "INSTAGRAM_INSIGHTS_GRAPH_ERROR",
  safeMessage: "Não foi possível carregar os dados de desempenho do Instagram.",
};

async function graphGet<T>(
  path: string,
  params: Record<string, string>,
  token: string,
  errorContext: GraphErrorContext = feedError,
): Promise<T> {
  const version = (process.env.META_GRAPH_API_VERSION ?? DEFAULT_GRAPH_VERSION).replace(/^\/+|\/+$/g, "");
  const url = new URL(`https://graph.facebook.com/${version}/${path.replace(/^\//, "")}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as T & {
    error?: { code?: unknown };
  };
  if (!response.ok || payload.error) {
    throw new AppError({
      code: errorContext.code,
      kind: response.status === 429 || response.status >= 500
        ? "TRANSIENT_EXTERNAL"
        : "PERMANENT_EXTERNAL",
      safeMessage: errorContext.safeMessage,
      httpStatus: response.status === 429 || response.status >= 500 ? 503 : 502,
      retryable: response.status === 429 || response.status >= 500,
      metadata: {
        provider: "meta",
        providerStatus: response.status,
        providerCode: payload.error?.code,
      },
    });
  }
  return payload;
}

async function optionalGraphGet<T>(path: string, params: Record<string, string>, token: string) {
  try {
    return await graphGet<T>(path, params, token, insightsError);
  } catch {
    return null;
  }
}

function mergeInsightPayloads(...payloads: Array<{ data?: unknown } | null>) {
  return {
    data: payloads.flatMap((payload) => Array.isArray(payload?.data) ? payload.data : []),
  };
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>) {
  const result = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await task(items[index]!);
    }
  }));
  return result;
}

function reportingRangeStart(now: Date, days: InstagramInsightsDays) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const currentLocalMidnightUtc = Date.UTC(number("year"), number("month") - 1, number("day"), 3);
  return new Date(currentLocalMidnightUtc - (days - 1) * DAY_MS);
}

function insightWindows(since: Date, until: Date) {
  const windows: Array<{ since: string; until: string; period: string }> = [];
  let cursor = Math.floor(since.getTime() / 1_000);
  const finalSecond = Math.floor(until.getTime() / 1_000);
  while (cursor <= finalSecond) {
    const windowEnd = Math.min(cursor + MAX_INSIGHTS_WINDOW_SECONDS, finalSecond);
    windows.push({ since: String(cursor), until: String(windowEnd), period: "day" });
    cursor = windowEnd + 1;
  }
  return windows;
}

export async function fetchInstagramPublishedFeed() {
  const token = await metaToken();
  const accountId = process.env.META_INSTAGRAM_ACCOUNT_ID ?? DEFAULT_INSTAGRAM_ACCOUNT_ID;
  const [profile, media] = await Promise.all([
    graphGet<{ username?: unknown; profile_picture_url?: unknown }>(
      accountId,
      { fields: "username,profile_picture_url" },
      token,
    ),
    graphGet<{ data?: unknown }>(
      `${accountId}/media`,
      {
        limit: "18",
        fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,children{id,media_type,media_url,thumbnail_url}",
      },
      token,
    ),
  ]);

  return {
    profile: parseInstagramPublishedProfile(profile),
    items: parseInstagramPublishedFeed(media, 18),
  };
}

export async function fetchInstagramInsights(days: InstagramInsightsDays) {
  const token = await metaToken();
  const accountId = process.env.META_INSTAGRAM_ACCOUNT_ID ?? DEFAULT_INSTAGRAM_ACCOUNT_ID;
  const until = new Date();
  const since = reportingRangeStart(until, days);
  const windows = insightWindows(since, until);

  const [profile, accountWindows, mediaPayload, storyPayload] = await Promise.all([
    graphGet<{
      username?: unknown;
      profile_picture_url?: unknown;
      followers_count?: unknown;
      media_count?: unknown;
    }>(accountId, { fields: "username,profile_picture_url,followers_count,media_count" }, token, insightsError),
    Promise.all(windows.map(async (window) => {
      const [totals, follows, reach] = await Promise.all([
        graphGet<{ data?: unknown }>(`${accountId}/insights`, {
          ...window,
          metric: "views,reach,accounts_engaged,total_interactions,likes,comments,shares,saves,replies,reposts",
          metric_type: "total_value",
        }, token, insightsError),
        optionalGraphGet<{ data?: unknown }>(`${accountId}/insights`, {
          ...window,
          metric: "follows_and_unfollows",
          metric_type: "total_value",
          breakdown: "follow_type",
        }, token),
        optionalGraphGet<{ data?: unknown }>(`${accountId}/insights`, {
          ...window,
          metric: "reach",
          metric_type: "time_series",
        }, token),
      ]);
      return { totals: parseAccountInsightTotals(mergeInsightPayloads(totals, follows)), reach: parseReachSeries(reach) };
    })),
    graphGet<{ data?: unknown }>(`${accountId}/media`, {
      limit: "18",
      fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
    }, token, insightsError),
    optionalGraphGet<{ data?: unknown }>(`${accountId}/stories`, {
      limit: "12",
      fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
    }, token),
  ]);

  const recentMedia = mediaData(mediaPayload).filter((candidate) => {
    const timestamp = candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? (candidate as Record<string, unknown>).timestamp
      : null;
    return typeof timestamp === "string" && Date.parse(timestamp) >= since.getTime();
  });

  const content = (await mapConcurrent(recentMedia, 4, async (media) => {
    const id = media && typeof media === "object" && !Array.isArray(media)
      ? (media as Record<string, unknown>).id
      : null;
    if (typeof id !== "string") return null;
    const insights = await optionalGraphGet<{ data?: unknown }>(`${id}/insights`, {
      metric: "reach,saved,shares,total_interactions,views",
    }, token);
    return parseContentInsight(media, insights);
  })).filter((item) => item !== null);

  const activeStories = (await mapConcurrent(mediaData(storyPayload), 3, async (media) => {
    const id = media && typeof media === "object" && !Array.isArray(media)
      ? (media as Record<string, unknown>).id
      : null;
    if (typeof id !== "string") return null;
    const [core, actions] = await Promise.all([
      optionalGraphGet<{ data?: unknown }>(`${id}/insights`, { metric: "reach,views,shares,replies" }, token),
      optionalGraphGet<{ data?: unknown }>(`${id}/insights`, { metric: "link_clicks,profile_activity" }, token),
    ]);
    return parseContentInsight(media, mergeInsightPayloads(core, actions), { story: true });
  })).filter((item) => item !== null);

  const parsedProfile = parseInstagramPublishedProfile(profile);
  return {
    range: {
      days,
      since: since.toISOString(),
      until: until.toISOString(),
    },
    profile: {
      ...parsedProfile,
      followersCount: typeof profile.followers_count === "number" ? profile.followers_count : null,
      mediaCount: typeof profile.media_count === "number" ? profile.media_count : null,
    },
    totals: sumAccountInsightTotals(accountWindows.map((window) => window.totals)),
    reachSeries: mergeReachSeries(accountWindows.map((window) => window.reach)),
    content,
    activeStories,
  };
}
