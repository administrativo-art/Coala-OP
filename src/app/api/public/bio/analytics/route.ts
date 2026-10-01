import { createHash, timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  publicBioAnalyticsEventSchema,
  recordPublicBioAnalyticsEvent,
} from "@/features/instagram-scheduler/public-bio-analytics.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { createInMemoryRateLimiter } from "@/lib/observability/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createInMemoryRateLimiter({ limit: 90, windowMs: 60_000, maxKeys: 10_000 });

function requestKey(request: NextRequest) {
  const forwardedKey = request.headers.get("x-coala-client-key");
  if (forwardedKey && /^[0-9a-f]{64}$/.test(forwardedKey)) return forwardedKey;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  return createHash("sha256").update(`${forwarded}|${userAgent}`).digest("hex");
}

function hasValidIngestToken(request: NextRequest) {
  const expected = process.env.BIO_ANALYTICS_INGEST_TOKEN;
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export const POST = withApiErrorHandling({
  source: "api",
  operation: "recordPublicBioAnalytics",
  routeOrJob: "/api/public/bio/analytics",
}, async (request: NextRequest) => {
  if (request.headers.get("x-coala-bio-source") !== "public-site" || !hasValidIngestToken(request)) {
    throw new AppError({
      code: "PUBLIC_BIO_ANALYTICS_FORBIDDEN",
      kind: "AUTHORIZATION",
      safeMessage: "Origem não autorizada.",
      reportable: false,
    });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2_048) {
    throw new AppError({
      code: "PUBLIC_BIO_ANALYTICS_PAYLOAD_TOO_LARGE",
      kind: "VALIDATION",
      safeMessage: "Evento inválido.",
    });
  }
  const rate = limiter.check(requestKey(request));
  if (!rate.allowed) {
    throw new AppError({
      code: "PUBLIC_BIO_ANALYTICS_RATE_LIMITED",
      kind: "EXPECTED_BUSINESS",
      httpStatus: 429,
      safeMessage: "Muitas tentativas. Aguarde um instante.",
      reportable: false,
      retryable: true,
    });
  }
  const parsed = publicBioAnalyticsEventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError({
      code: "PUBLIC_BIO_ANALYTICS_INVALID_EVENT",
      kind: "VALIDATION",
      safeMessage: "Evento inválido.",
    });
  }

  await recordPublicBioAnalyticsEvent(parsed.data);
  return new NextResponse(null, {
    status: 202,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
