import { AppError } from "@/lib/observability/app-error";

const ENDPOINT = "https://conciliation.stone.com.br/v2/merchant";
const TIMEOUT_MS = 30_000;

class StonePixRequestError extends AppError {}

function failure(code: string, retryable = false): AppError {
  return new StonePixRequestError({
    code,
    kind: retryable ? "TRANSIENT_EXTERNAL" : "PERMANENT_EXTERNAL",
    safeMessage: "Não foi possível solicitar o arquivo Pix à Stone.",
  });
}
function validateInput(document: string, referenceDate: string) {
  const parsed = new Date(`${referenceDate}T00:00:00.000Z`);
  if (!/^(?:\d{11}|\d{14})$/.test(document)
    || !/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)
    || !Number.isFinite(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== referenceDate) {
    throw new AppError({ code: "STONE_PIX_REQUEST_INVALID_INPUT", kind: "VALIDATION" });
  }
}

export async function requestStonePixFile(
  input: { document: string; referenceDate: string },
  dependencies: { apiKey: string | undefined; fetcher?: typeof fetch; signal?: AbortSignal },
) {
  validateInput(input.document, input.referenceDate);
  const apiKey = dependencies.apiKey?.trim();
  if (!apiKey || /[\r\n:]/.test(apiKey)) throw failure("STONE_PIX_REQUEST_NOT_CONFIGURED");
  try {
    const response = await (dependencies.fetcher ?? fetch)(
      `${ENDPOINT}/${input.document}/conciliation-file/pix/${input.referenceDate}`,
      {
        method: "POST",
        cache: "no-store",
        redirect: "manual",
        signal: dependencies.signal
          ? AbortSignal.any([dependencies.signal, AbortSignal.timeout(TIMEOUT_MS)])
          : AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
          "x-user-type": "client",
          Accept: "application/json",
        },
      },
    );
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return { status: response.status };
    if (response.status === 401 || response.status === 403) {
      throw failure("STONE_PIX_REQUEST_CREDENTIAL_REJECTED");
    }
    throw failure("STONE_PIX_REQUEST_UPSTREAM_REJECTED",
      response.status === 408 || response.status === 429 || response.status >= 500);
  } catch (error) {
    if (error instanceof StonePixRequestError) throw failure(error.code, error.retryable);
    throw failure("STONE_PIX_REQUEST_UNAVAILABLE", true);
  }
}
