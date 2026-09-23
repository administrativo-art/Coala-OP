import { z } from "zod";
import { AppError } from "../observability/app-error";

const BASE_URL = "https://api.tabletcloud.com.br";
export const PDV_COUPON_READ_MAX_BYTES = 8 * 1024 * 1024;
const credentialsSchema = z.object({
  company: z.string().min(1).max(128).regex(/^[^\r\n:]+$/),
  token: z.string().min(1).max(4096).regex(/^[^\r\n]+$/),
  username: z.string().min(1).max(512), password: z.string().min(1).max(512),
}).strict();
export type PdvReadCredentials = z.infer<typeof credentialsSchema>;
class PdvReadError extends AppError {}
function failure(code: string, retryable = false) {
  return new PdvReadError({ code, kind: retryable ? "TRANSIENT_EXTERNAL" : "PERMANENT_EXTERNAL",
    safeMessage: "Não foi possível consultar os cupons PDV com segurança. Confira a integração e tente novamente." });
}

async function boundedJson(response: Response, maxBytes: number) {
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    throw failure("PDV_REVIEW_UPSTREAM_REJECTED", response.status === 429 || response.status >= 500);
  }
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw failure("PDV_REVIEW_TOO_LARGE");
  }
  if (!response.body) throw failure("PDV_REVIEW_INVALID_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw failure("PDV_REVIEW_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as unknown; }
  catch { throw failure("PDV_REVIEW_INVALID_RESPONSE"); }
}

/** One bounded day, no ledger writes. Credentials only from server runtime.
 * Unlike the legacy synchronization reader, unknown envelopes never mean zero. */
export async function fetchPdvCouponsReadOnly(input: { filialId: string; referenceDate: string },
  dependencies: { credentials: unknown; signal?: AbortSignal; fetcher?: typeof fetch }) {
  const date = input.referenceDate;
  if (!/^\d{1,20}$/.test(input.filialId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new AppError({ code: "PDV_REVIEW_INVALID_INPUT", kind: "VALIDATION" });
  }
  const validated = credentialsSchema.safeParse(dependencies.credentials);
  if (!validated.success) throw failure("PDV_REVIEW_NOT_CONFIGURED");
  const credentials = validated.data;
  const signal = AbortSignal.any([AbortSignal.timeout(60_000), ...(dependencies.signal ? [dependencies.signal] : [])]);
  const fetcher = dependencies.fetcher ?? fetch;
  try {
    signal.throwIfAborted();
    const authResponse = await fetcher(`${BASE_URL}/token`, {
      method: "POST", cache: "no-store", redirect: "manual", signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${credentials.company}:${credentials.token}`).toString("base64")}`, Token: credentials.token },
      body: new URLSearchParams({ grant_type: "password", username: credentials.username, password: credentials.password }).toString(),
    });
    const token = z.object({ access_token: z.string().min(1).max(8192).regex(/^[^\r\n]+$/) })
      .safeParse(await boundedJson(authResponse, 64 * 1024));
    if (!token.success) throw failure("PDV_REVIEW_INVALID_RESPONSE");
    signal.throwIfAborted();
    const response = await fetcher(`${BASE_URL}/cupom/get/${date}/${date}/${input.filialId}`, {
      cache: "no-store", redirect: "manual", signal,
      headers: { Authorization: `Bearer ${token.data.access_token}`, CodEmpresa: credentials.company,
        Token: credentials.token, Accept: "application/json" },
    });
    const raw = await boundedJson(response, PDV_COUPON_READ_MAX_BYTES);
    signal.throwIfAborted();
    const rows = z.array(z.record(z.unknown())).max(500);
    const parsed = z.union([rows, z.object({ data: rows }).strict()]).safeParse(raw);
    if (!parsed.success) throw failure("PDV_REVIEW_INVALID_RESPONSE");
    return Array.isArray(parsed.data) ? parsed.data : parsed.data.data;
  } catch (error) {
    // Never forward provider bodies, tokens, thrown client messages or foreign AppErrors.
    if (error instanceof PdvReadError) throw failure(error.code, error.retryable);
    throw failure("PDV_REVIEW_UNAVAILABLE", true);
  }
}
