import "server-only";

import { GoogleAuth } from "google-auth-library";

import { AppError } from "@/lib/observability/app-error";

import {
  parseInstagramPublishedFeed,
  parseInstagramPublishedProfile,
} from "./published-feed";

const DEFAULT_PROJECT_ID = "smart-converter-752gf";
const DEFAULT_INSTAGRAM_ACCOUNT_ID = "17841476184089270";
const DEFAULT_GRAPH_VERSION = "v25.0";
const TOKEN_CACHE_MS = 5 * 60 * 1_000;

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
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const accessToken = await auth.getAccessToken();
  if (!accessToken) throw new Error("Credencial Google indisponível.");

  const projectId = firebaseProjectId();
  const secretName = process.env.META_SYSTEM_USER_TOKEN_SECRET ?? "META_SYSTEM_USER_TOKEN";
  const url = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/secrets/${encodeURIComponent(secretName)}/versions/latest:access`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
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

async function graphGet<T>(path: string, fields: string, token: string): Promise<T> {
  const version = (process.env.META_GRAPH_API_VERSION ?? DEFAULT_GRAPH_VERSION).replace(/^\/+|\/+$/g, "");
  const url = new URL(`https://graph.facebook.com/${version}/${path.replace(/^\//, "")}`);
  url.searchParams.set("fields", fields);
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
      code: "INSTAGRAM_FEED_GRAPH_ERROR",
      kind: response.status === 429 || response.status >= 500
        ? "TRANSIENT_EXTERNAL"
        : "PERMANENT_EXTERNAL",
      safeMessage: "Não foi possível carregar a grade atual do Instagram.",
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

export async function fetchInstagramPublishedFeed() {
  const token = await metaToken();
  const accountId = process.env.META_INSTAGRAM_ACCOUNT_ID ?? DEFAULT_INSTAGRAM_ACCOUNT_ID;
  const [profile, media] = await Promise.all([
    graphGet<{ username?: unknown; profile_picture_url?: unknown }>(
      accountId,
      "username,profile_picture_url",
      token,
    ),
    graphGet<{ data?: unknown }>(
      `${accountId}/media?limit=18`,
      "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,children{id,media_type,media_url,thumbnail_url}",
      token,
    ),
  ]);

  return {
    profile: parseInstagramPublishedProfile(profile),
    items: parseInstagramPublishedFeed(media, 18),
  };
}
