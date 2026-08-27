import { NextResponse, type NextRequest } from "next/server";
import { verifyAuth } from "@/lib/verify-auth";
import { AppError, reportSystemError, withApiErrorHandling } from "@/lib/observability";
import { ClientErrorIngestSchema } from "@/lib/observability/client-event-schema";
import { createInMemoryRateLimiter } from "@/lib/observability/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32_768;
const limiter = createInMemoryRateLimiter({ limit: 20, windowMs: 60_000 });

async function readBody(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new AppError({
      code: "CLIENT_ERROR_PAYLOAD_TOO_LARGE",
      kind: "VALIDATION",
      httpStatus: 413,
      safeMessage: "O evento excede o tamanho permitido.",
    });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    throw new AppError({
      code: "CLIENT_ERROR_PAYLOAD_TOO_LARGE",
      kind: "VALIDATION",
      httpStatus: 413,
      safeMessage: "O evento excede o tamanho permitido.",
    });
  }
  try {
    return ClientErrorIngestSchema.parse(JSON.parse(raw));
  } catch (cause) {
    throw new AppError({
      code: "CLIENT_ERROR_PAYLOAD_INVALID",
      kind: "VALIDATION",
      safeMessage: "Evento de erro inválido.",
      cause,
    });
  }
}

export const POST = withApiErrorHandling({
  source: "api-observability",
  operation: "ingest-client-error",
  routeOrJob: "/api/observability/client-errors",
}, async (request: NextRequest, _context, observation) => {
  const actor = await verifyAuth(request, { enforceProfileCompliance: false }).catch((cause) => {
    throw new AppError({ code: "CLIENT_ERROR_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const rate = limiter.check(actor.uid);
  if (!rate.allowed) {
    throw new AppError({
      code: "CLIENT_ERROR_RATE_LIMITED",
      kind: "EXPECTED_BUSINESS",
      httpStatus: 429,
      safeMessage: "Muitos eventos foram enviados. Aguarde antes de tentar novamente.",
    });
  }
  const payload = await readBody(request);
  const error = new Error(payload.messageSanitized);
  error.name = payload.errorName;
  error.stack = payload.stackSanitized;
  const reference = reportSystemError({
    error,
    eventId: payload.eventId,
    code: payload.source === "render" ? "CLIENT_RENDER_FAILED" : "CLIENT_UNEXPECTED_ERROR",
    kind: "UNEXPECTED_APPLICATION",
    severity: payload.source === "background" ? "medium" : "high",
    source: `browser-${payload.source}`,
    operation: payload.operation,
    routeOrJob: payload.routeOrJob,
    requestId: observation.requestId,
    correlationId: observation.correlationId,
    isTerminal: payload.source !== "background",
    metadata: { provider: "browser", status: "captured" },
  });
  return NextResponse.json({ accepted: true, eventId: reference.eventId, requestId: observation.requestId }, { status: 202 });
});
