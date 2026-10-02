import "server-only";

import { adminApp } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";

import {
  mediaData,
  mergeReachSeries,
  parseAccountInsightTotals,
  parseContentInsight,
  parseFollowerDemographics,
  parseReachSeries,
  parseViewsByFollowType,
  sumAccountInsightTotals,
  sumViewsByFollowType,
} from "./instagram-insights";
import {
  parseInstagramPublishedFeed,
  parseInstagramPublishedProfile,
} from "./published-feed";
import type {
  InstagramAdsMetrics,
  InstagramAdsReport,
  InstagramAudienceReport,
  InstagramInsightsContentPage,
  InstagramInsightsDays,
  InstagramInsightsPeriod,
} from "./contracts";

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

function localDateString(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function insightsDateRange(period: InstagramInsightsPeriod, now = new Date()) {
  const until = localDateString(now);
  const since = period === "year"
    ? `${until.slice(0, 4)}-01-01`
    : localDateString(reportingRangeStart(now, period));
  return { since, until };
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
      const [totals, follows, reach, viewTypes] = await Promise.all([
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
        optionalGraphGet<{ data?: unknown }>(`${accountId}/insights`, {
          ...window,
          metric: "views",
          metric_type: "total_value",
          breakdown: "follow_type",
        }, token),
      ]);
      return {
        totals: parseAccountInsightTotals(mergeInsightPayloads(totals, follows)),
        viewsByFollowType: parseViewsByFollowType(viewTypes),
        reach: parseReachSeries(reach),
      };
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
    viewsByFollowType: sumViewsByFollowType(accountWindows.map((window) => window.viewsByFollowType)),
    reachSeries: mergeReachSeries(accountWindows.map((window) => window.reach)),
    content,
    activeStories,
  };
}

export async function fetchInstagramAudienceDemographics(): Promise<InstagramAudienceReport> {
  const token = await metaToken();
  const accountId = process.env.META_INSTAGRAM_ACCOUNT_ID ?? DEFAULT_INSTAGRAM_ACCOUNT_ID;
  const params = {
    metric: "follower_demographics",
    metric_type: "total_value",
    period: "lifetime",
    timeframe: "last_30_days",
  };
  const [ageGender, cities, countries] = await Promise.all([
    optionalGraphGet<{ data?: unknown }>(`${accountId}/insights`, { ...params, breakdown: "age,gender" }, token),
    optionalGraphGet<{ data?: unknown }>(`${accountId}/insights`, { ...params, breakdown: "city" }, token),
    optionalGraphGet<{ data?: unknown }>(`${accountId}/insights`, { ...params, breakdown: "country" }, token),
  ]);

  return {
    timeframe: "last_30_days",
    ageGender: ageGender ? parseFollowerDemographics(ageGender, ["age", "gender"]) : null,
    cities: cities ? parseFollowerDemographics(cities, ["city"]) : null,
    countries: countries ? parseFollowerDemographics(countries, ["country"]) : null,
  };
}

function numericField(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function adMetrics(value: unknown): InstagramAdsMetrics {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    impressions: numericField(row.impressions),
    reach: numericField(row.reach),
    spend: numericField(row.spend),
    clicks: numericField(row.clicks),
    ctr: numericField(row.ctr),
    cpc: numericField(row.cpc),
    cpm: numericField(row.cpm),
    frequency: numericField(row.frequency),
  };
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function emptyAdsReport(
  period: InstagramInsightsPeriod,
  status: InstagramAdsReport["status"],
  range = insightsDateRange(period),
): InstagramAdsReport {
  return {
    period,
    ...range,
    status,
    accountName: null,
    currency: null,
    totals: null,
    campaigns: [],
    hasMoreCampaigns: false,
  };
}

export async function fetchInstagramAdsInsights(period: InstagramInsightsPeriod): Promise<InstagramAdsReport> {
  const token = await metaToken();
  const range = insightsDateRange(period);
  const accounts = await optionalGraphGet<{
    data?: unknown;
    paging?: { next?: unknown };
  }>("me/adaccounts", {
    fields: "id,name,currency,account_status",
    limit: "50",
  }, token);
  if (!accounts) return emptyAdsReport(period, "unavailable", range);

  const activeAccounts = mediaData(accounts).filter((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const status = numericField((candidate as Record<string, unknown>).account_status);
    return status === 1;
  });
  if (activeAccounts.length === 0) return emptyAdsReport(period, "no_account", range);
  if (activeAccounts.length !== 1 || typeof accounts.paging?.next === "string") {
    return emptyAdsReport(period, "multiple_accounts", range);
  }

  const account = activeAccounts[0] as Record<string, unknown>;
  const rawId = stringField(account.id);
  if (!rawId || !/^(?:act_)?\d+$/.test(rawId)) return emptyAdsReport(period, "unavailable", range);
  const adAccountId = rawId.startsWith("act_") ? rawId : `act_${rawId}`;
  const timeRange = JSON.stringify({ since: range.since, until: range.until });
  const metricFields = "impressions,reach,spend,clicks,ctr,cpc,cpm,frequency";
  const [totalsPayload, campaignsPayload] = await Promise.all([
    optionalGraphGet<{ data?: unknown }>(`${adAccountId}/insights`, {
      level: "account",
      time_range: timeRange,
      fields: metricFields,
      limit: "1",
    }, token),
    optionalGraphGet<{
      data?: unknown;
      paging?: { next?: unknown };
    }>(`${adAccountId}/insights`, {
      level: "campaign",
      time_range: timeRange,
      fields: `campaign_name,objective,${metricFields}`,
      limit: "25",
    }, token),
  ]);
  if (!totalsPayload || !campaignsPayload) return emptyAdsReport(period, "unavailable", range);

  const totalRow = mediaData(totalsPayload)[0];
  const campaignRows = mediaData(campaignsPayload).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const row = candidate as Record<string, unknown>;
    const name = stringField(row.campaign_name);
    if (!name) return [];
    return [{ ...adMetrics(row), name, objective: stringField(row.objective) }];
  });
  const hasMoreCampaigns = typeof campaignsPayload.paging?.next === "string";

  if (!totalRow && campaignRows.length === 0) {
    return {
      ...emptyAdsReport(period, "empty", range),
      accountName: stringField(account.name),
      currency: stringField(account.currency),
    };
  }

  return {
    period,
    ...range,
    status: "available",
    accountName: stringField(account.name),
    currency: stringField(account.currency),
    totals: totalRow ? adMetrics(totalRow) : null,
    campaigns: campaignRows,
    hasMoreCampaigns,
  };
}

export async function fetchInstagramInsightsContentPage(
  period: InstagramInsightsPeriod,
  after: string | null,
): Promise<InstagramInsightsContentPage> {
  const token = await metaToken();
  const accountId = process.env.META_INSTAGRAM_ACCOUNT_ID ?? DEFAULT_INSTAGRAM_ACCOUNT_ID;
  const range = insightsDateRange(period);
  const params: Record<string, string> = {
    limit: "25",
    fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
  };
  if (after) params.after = after;

  const payload = await graphGet<{
    data?: unknown;
    paging?: { next?: unknown; cursors?: { after?: unknown } };
  }>(`${accountId}/media`, params, token, insightsError);
  const startTime = Date.parse(`${range.since}T03:00:00.000Z`);
  const endTimeExclusive = Date.parse(`${range.until}T03:00:00.000Z`) + DAY_MS;
  const pageMedia = mediaData(payload);
  const inRangeMedia = pageMedia.filter((media) => {
    if (!media || typeof media !== "object" || Array.isArray(media)) return false;
    const timestamp = (media as Record<string, unknown>).timestamp;
    const publishedAt = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
    return Number.isFinite(publishedAt) && publishedAt >= startTime && publishedAt < endTimeExclusive;
  });
  const oldestTimestamp = pageMedia.reduce<number | null>((oldest, media) => {
    if (!media || typeof media !== "object" || Array.isArray(media)) return oldest;
    const timestamp = (media as Record<string, unknown>).timestamp;
    const publishedAt = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
    return Number.isFinite(publishedAt) && (oldest === null || publishedAt < oldest) ? publishedAt : oldest;
  }, null);
  const hasNextPage = typeof payload.paging?.next === "string";
  const nextAfter = typeof payload.paging?.cursors?.after === "string"
    ? payload.paging.cursors.after
    : null;
  const hasMore = hasNextPage && Boolean(nextAfter) && (oldestTimestamp === null || oldestTimestamp >= startTime);
  const items = (await mapConcurrent(inRangeMedia, 4, async (media) => {
    const id = media && typeof media === "object" && !Array.isArray(media)
      ? (media as Record<string, unknown>).id
      : null;
    if (typeof id !== "string") return null;
    const insights = await optionalGraphGet<{ data?: unknown }>(`${id}/insights`, {
      metric: "reach,saved,shares,total_interactions,views",
    }, token);
    return parseContentInsight(media, insights);
  })).filter((item) => item !== null);

  return {
    period,
    items,
    nextAfter: hasMore ? nextAfter : null,
    hasMore,
  };
}
