import https from "node:https";
import axios, { type AxiosInstance } from "axios";
import { getInterConfig } from "./config.server";

type TokenCache = { accessToken: string; expiresAt: number; scope: string };
let tokenCache: TokenCache | null = null;

function createAgent() {
  const config = getInterConfig();
  return new https.Agent({ cert: config.certificate, key: config.privateKey, keepAlive: true, minVersion: "TLSv1.2" });
}

async function accessToken(scope: string) {
  const normalizedScope = scope.split(/\s+/).filter(Boolean).sort().join(" ");
  if (tokenCache && tokenCache.scope === normalizedScope && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }
  const config = getInterConfig();
  const payload = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
    scope: normalizedScope,
  });
  const response = await axios.post(config.tokenUrl, payload.toString(), {
    httpsAgent: createAgent(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 20_000,
  });
  const token = String(response.data?.access_token ?? "");
  if (!token) throw new Error("O Banco Inter não retornou um token de acesso.");
  tokenCache = {
    accessToken: token,
    expiresAt: Date.now() + Math.max(60, Number(response.data?.expires_in ?? 3600)) * 1000,
    scope: normalizedScope,
  };
  return token;
}

export async function createInterClient(scope: string): Promise<AxiosInstance> {
  const config = getInterConfig();
  const token = await accessToken(scope);
  return axios.create({
    baseURL: config.apiBaseUrl,
    httpsAgent: createAgent(),
    timeout: 25_000,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(config.accountNumber ? { "x-conta-corrente": config.accountNumber } : {}),
    },
  });
}

export function clearInterTokenCache() {
  tokenCache = null;
}
