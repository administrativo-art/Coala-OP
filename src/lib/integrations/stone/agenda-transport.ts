import { AppError } from "../../observability/app-error";

// Transport only: the XML is NOT a validated financial record. The consumer must
// validate Header (merchant/date/layout) and normalize events before using it.
const ENDPOINT = "https://conciliation.stone.com.br/v2/merchant";
export const STONE_AGENDA_MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

type AgendaRequest = { stoneCode: string; referenceDate: string };

class StoneAgendaError extends AppError {}

function failure(code: string, retryable = false): AppError {
  return new StoneAgendaError({
    code,
    kind: retryable ? "TRANSIENT_EXTERNAL" : "PERMANENT_EXTERNAL",
    safeMessage: "Não foi possível consultar a agenda Stone com segurança.",
  });
}

function requestDate(input: AgendaRequest): string {
  const { stoneCode, referenceDate } = input;
  const date = new Date(`${referenceDate}T00:00:00Z`);
  if (
    !/^[0-9]{1,20}$/.test(stoneCode) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(referenceDate) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== referenceDate
  ) {
    throw new AppError({ code: "STONE_AGENDA_INVALID_INPUT", kind: "VALIDATION" });
  }
  return referenceDate.replaceAll("-", "");
}

async function readBoundedXml(response: Response): Promise<string> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > STONE_AGENDA_MAX_BYTES)) {
    await response.body?.cancel().catch(() => undefined);
    throw failure("STONE_AGENDA_TOO_LARGE");
  }
  if (!response.body) throw failure("STONE_AGENDA_EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > STONE_AGENDA_MAX_BYTES) {
        throw failure("STONE_AGENDA_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (size === 0) throw failure("STONE_AGENDA_EMPTY_RESPONSE");
  const bytes = Buffer.concat(chunks);
  // Native fetch decompresses HTTP Content-Encoding. Do not interpret arbitrary
  // ZIP/gzip attachments as XML or attempt an unbounded second decompression.
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw failure("STONE_AGENDA_INVALID_RESPONSE");
  }
  if (!xml.trimStart().startsWith("<") || /<!\s*(DOCTYPE|ENTITY)\b/i.test(xml)) {
    throw failure("STONE_AGENDA_INVALID_RESPONSE");
  }
  return xml;
}

/** Internal transport. Injected credentials must originate in server runtime,
 * never from request data. Do not expose the returned XML to the browser/logs. */
export async function fetchStoneAgendaXml(
  input: AgendaRequest,
  dependencies: { apiKey: string | undefined; fetcher?: typeof fetch },
): Promise<string> {
  const date = requestDate(input);
  const apiKey = dependencies.apiKey;
  if (!apiKey || !apiKey.trim() || /[\r\n:]/.test(apiKey)) {
    throw failure("STONE_AGENDA_NOT_CONFIGURED");
  }
  try {
    const response = await (dependencies.fetcher ?? fetch)(
      `${ENDPOINT}/${input.stoneCode}/conciliation-file/${date}?layout=XML2_2`,
      {
        method: "GET",
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
          "x-user-type": "client",
          "X-Accept-Redirect": "false",
          Accept: "application/xml",
          "Accept-Encoding": "gzip",
        },
      },
    );
    if (response.status !== 200) {
      // No response bodies, URLs, provider messages or request objects in errors.
      await response.body?.cancel().catch(() => undefined);
      if (response.status >= 300 && response.status < 400) {
        throw failure("STONE_AGENDA_REDIRECT_BLOCKED");
      }
      if (response.status === 401 || response.status === 403) {
        throw failure("STONE_AGENDA_CREDENTIAL_REJECTED");
      }
      // 404 is not evidence of zero sales or an empty receivable schedule.
      throw failure("STONE_AGENDA_UPSTREAM_REJECTED", response.status === 429 || response.status >= 500);
    }
    return await readBoundedXml(response);
  } catch (error) {
    // Only errors constructed in this module may cross the boundary; even an
    // injected HTTP client's AppError could contain credentials in metadata.
    if (error instanceof StoneAgendaError) {
      throw failure(error.code, error.retryable);
    }
    throw failure("STONE_AGENDA_UNAVAILABLE", true);
  }
}
