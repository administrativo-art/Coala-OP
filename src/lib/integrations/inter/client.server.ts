import https from "node:https";
import axios, { type AxiosInstance } from "axios";
import {
  getInterCobrancaEnvironment,
  getInterConfig,
  type InterEnvironment,
} from "./config.server";

type TokenCache = { accessToken: string; expiresAt: number };
const tokenCache = new Map<string, TokenCache>();

function createAgent(environment: InterEnvironment) {
  const config = getInterConfig(environment);
  return new https.Agent({
    cert: config.certificate,
    key: config.privateKey,
    keepAlive: true,
    minVersion: "TLSv1.2",
  });
}

async function accessToken(scope: string, environment: InterEnvironment) {
  const normalizedScope = scope.split(/\s+/).filter(Boolean).sort().join(" ");
  const cacheKey = `${environment}:${normalizedScope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;

  const config = getInterConfig(environment);
  const payload = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
    scope: normalizedScope,
  });
  const response = await axios.post(config.tokenUrl, payload.toString(), {
    httpsAgent: createAgent(environment),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 20_000,
  });
  const token = String(response.data?.access_token ?? "");
  if (!token) throw new Error("O Banco Inter não retornou um token de acesso.");
  tokenCache.set(cacheKey, {
    accessToken: token,
    expiresAt: Date.now() + Math.max(60, Number(response.data?.expires_in ?? 3600)) * 1000,
  });
  return token;
}

export async function createInterClient(
  scope: string,
  options: { environment?: InterEnvironment; basePath?: string } = {},
): Promise<AxiosInstance> {
  const environment = options.environment ?? getInterConfig().environment;
  const config = getInterConfig(environment);
  const token = await accessToken(scope, environment);
  return axios.create({
    baseURL: `${config.apiBaseUrl}${options.basePath ?? ""}`,
    httpsAgent: createAgent(environment),
    timeout: 25_000,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(config.accountNumber ? { "x-conta-corrente": config.accountNumber } : {}),
    },
  });
}

export function createInterCobrancaClient(scope: "boleto-cobranca.read" | "boleto-cobranca.write") {
  return createInterClient(scope, {
    environment: getInterCobrancaEnvironment(),
    basePath: "/cobranca/v3",
  });
}

export function clearInterTokenCache() {
  tokenCache.clear();
}
