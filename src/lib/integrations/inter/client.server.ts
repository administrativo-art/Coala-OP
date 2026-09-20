import { X509Certificate } from "node:crypto";
import https from "node:https";
import axios, { type AxiosError, type AxiosInstance } from "axios";
import { reportSystemError } from "@/lib/observability";
import {
  getInterCobrancaEnvironment,
  getInterConfig,
  type InterConfig,
  type InterEnvironment,
} from "./config.server";
import { InterApiError, isTransientInterFailure, safeInterApiError } from "./error";

type TokenCache = { accessToken: string; expiresAt: number };
type InterRetryConfig = NonNullable<AxiosError["config"]> & { __interReadRetryCount?: number };

const TOKEN_RETRY_LIMIT = 2;
const READ_RETRY_LIMIT = 2;
const MAX_RETRY_DELAY_MS = 5_000;
const CERTIFICATE_WARNING_DAYS = 45;
const CERTIFICATE_WARNING_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const tokenCache = new Map<string, TokenCache>();
const pendingTokenRequests = new Map<string, Promise<string>>();
const certificateWarningAt = new Map<string, number>();

export function inspectInterCertificateHealth(certificate: Buffer, now = Date.now()) {
  let parsed: X509Certificate;
  try {
    parsed = new X509Certificate(certificate);
  } catch {
    throw new InterApiError({
      code: "INTER_CERTIFICATE_INVALID",
      operation: "certificate-validation",
      safeMessage: "O certificado configurado para o Banco Inter é inválido.",
    });
  }
  const expiresAt = Date.parse(parsed.validTo);
  if (!Number.isFinite(expiresAt)) {
    throw new InterApiError({
      code: "INTER_CERTIFICATE_INVALID",
      operation: "certificate-validation",
      safeMessage: "Não foi possível determinar a validade do certificado do Banco Inter.",
    });
  }
  return {
    expired: expiresAt <= now,
    expiresAt,
    expiresOn: new Date(expiresAt).toISOString().slice(0, 10),
    daysRemaining: Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1_000)),
  };
}

function assertCertificateHealth(config: InterConfig, environment: InterEnvironment, now = Date.now()) {
  const health = inspectInterCertificateHealth(config.certificate, now);
  if (health.expired) {
    throw new InterApiError({
      code: "INTER_CERTIFICATE_EXPIRED",
      operation: "certificate-validation",
      safeMessage: `O certificado do Banco Inter venceu em ${health.expiresOn}.`,
    });
  }
  if (health.daysRemaining > CERTIFICATE_WARNING_DAYS) return;

  const warningKey = `${environment}:${health.expiresOn}`;
  const lastWarningAt = certificateWarningAt.get(warningKey) ?? 0;
  if (now - lastWarningAt < CERTIFICATE_WARNING_INTERVAL_MS) return;
  certificateWarningAt.set(warningKey, now);
  reportSystemError({
    error: new Error(
      `O certificado do Banco Inter vence em ${health.daysRemaining} dia(s), em ${health.expiresOn}.`,
    ),
    source: "inter-client",
    operation: "certificate-expiration-check",
    code: "INTER_CERTIFICATE_EXPIRING",
    kind: "PERMANENT_EXTERNAL",
    severity: health.daysRemaining <= 15 ? "high" : "medium",
    isTerminal: false,
    metadata: { provider: "Banco Inter", status: "expiring" },
  });
}

function createAgent(config: InterConfig, environment: InterEnvironment) {
  assertCertificateHealth(config, environment);
  return new https.Agent({
    cert: config.certificate,
    key: config.privateKey,
    keepAlive: true,
    minVersion: "TLSv1.2",
  });
}

function retryAfterMilliseconds(error: unknown, attempt: number) {
  let retryAfter: unknown;
  try {
    if (axios.isAxiosError(error)) {
      retryAfter = typeof error.response?.headers?.get === "function"
        ? error.response.headers.get("retry-after")
        : error.response?.headers?.["retry-after"];
    }
  } catch {
    retryAfter = undefined;
  }
  if (typeof retryAfter === "string" && /^\d+(?:\.\d+)?$/.test(retryAfter.trim())) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, Number(retryAfter) * 1_000));
  }
  if (typeof retryAfter === "string") {
    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, timestamp - Date.now()));
    }
  }
  const exponential = Math.min(MAX_RETRY_DELAY_MS, 250 * (2 ** attempt));
  return Math.round(exponential * (0.75 + Math.random() * 0.5));
}

async function waitBeforeRetry(error: unknown, attempt: number) {
  const delay = retryAfterMilliseconds(error, attempt);
  if (delay <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

async function requestAccessToken(normalizedScope: string, environment: InterEnvironment) {
  const config = getInterConfig(environment);
  const payload = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
    scope: normalizedScope,
  });
  for (let attempt = 0; attempt <= TOKEN_RETRY_LIMIT; attempt += 1) {
    try {
      const response = await axios.post(config.tokenUrl, payload.toString(), {
        httpsAgent: createAgent(config, environment),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 20_000,
      });
      const token = String(response.data?.access_token ?? "");
      if (!token) {
        throw new InterApiError({
          code: "INTER_TOKEN_MISSING",
          operation: "oauth-token",
          safeMessage: "O Banco Inter não retornou um token de acesso.",
        });
      }
      return {
        accessToken: token,
        expiresAt: Date.now() + Math.max(60, Number(response.data?.expires_in ?? 3600)) * 1_000,
      };
    } catch (error) {
      if (attempt < TOKEN_RETRY_LIMIT && isTransientInterFailure(error)) {
        await waitBeforeRetry(error, attempt);
        continue;
      }
      throw safeInterApiError(error, "oauth-token");
    }
  }
  throw new InterApiError({ code: "INTER_TOKEN_FAILED", operation: "oauth-token" });
}

async function accessToken(scope: string, environment: InterEnvironment) {
  const normalizedScope = scope.split(/\s+/).filter(Boolean).sort().join(" ");
  const cacheKey = `${environment}:${normalizedScope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;

  const pending = pendingTokenRequests.get(cacheKey);
  if (pending) return pending;

  const request = requestAccessToken(normalizedScope, environment).then((token) => {
    tokenCache.set(cacheKey, token);
    return token.accessToken;
  });
  pendingTokenRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (pendingTokenRequests.get(cacheKey) === request) pendingTokenRequests.delete(cacheKey);
  }
}

function attachSafeReadRetry(client: AxiosInstance) {
  client.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      let requestConfig: InterRetryConfig | undefined;
      try {
        if (axios.isAxiosError(error) && error.config) requestConfig = error.config as InterRetryConfig;
      } catch {
        requestConfig = undefined;
      }
      const method = requestConfig?.method?.toUpperCase();
      const retryCount = requestConfig?.__interReadRetryCount ?? 0;
      const idempotentRead = method === "GET" || method === "HEAD" || method === "OPTIONS";
      if (requestConfig && idempotentRead && retryCount < READ_RETRY_LIMIT && isTransientInterFailure(error)) {
        requestConfig.__interReadRetryCount = retryCount + 1;
        await waitBeforeRetry(error, retryCount);
        return client.request(requestConfig);
      }
      throw safeInterApiError(error, "api-request");
    },
  );
}

export async function createInterClient(
  scope: string,
  options: { environment?: InterEnvironment; basePath?: string } = {},
): Promise<AxiosInstance> {
  const environment = options.environment ?? getInterConfig().environment;
  const config = getInterConfig(environment);
  const token = await accessToken(scope, environment);
  const client = axios.create({
    baseURL: `${config.apiBaseUrl}${options.basePath ?? ""}`,
    httpsAgent: createAgent(config, environment),
    timeout: 25_000,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(config.accountNumber ? { "x-conta-corrente": config.accountNumber } : {}),
    },
  });
  attachSafeReadRetry(client);
  return client;
}

export function createInterCobrancaClient(scope: "boleto-cobranca.read" | "boleto-cobranca.write") {
  return createInterClient(scope, {
    environment: getInterCobrancaEnvironment(),
    basePath: "/cobranca/v3",
  });
}

export function clearInterTokenCache() {
  tokenCache.clear();
  pendingTokenRequests.clear();
}
