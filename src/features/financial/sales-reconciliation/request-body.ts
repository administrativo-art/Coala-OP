import { AppError } from "@/lib/observability/app-error";

export async function readSalesReviewBody(request: Request): Promise<unknown> {
  const invalid = () => new AppError({ code: "SALES_REVIEW_INVALID_BODY", kind: "VALIDATION",
    safeMessage: "Solicitação inválida ou maior que o limite permitido." });
  const length = request.headers.get("content-length");
  if (!request.body || (length !== null && (!/^\d+$/.test(length) || Number(length) > 2048))) throw invalid();
  const reader = request.body.getReader();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) throw invalid();
      chunks.push(value);
    }
    signal.throwIfAborted();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { throw invalid(); }
  finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
