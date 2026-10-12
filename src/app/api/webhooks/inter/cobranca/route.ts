import { createHash } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { type z } from "zod";

import { WORKSPACE_ID } from "@/lib/workspace";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { interCobrancaWebhookSchema } from "@/lib/integrations/inter/cobrancas";
import { getInterAccountNumber, getInterCobrancaEnvironment } from "@/lib/integrations/inter/config.server";
import { interWebhookExpiry, readBoundedInterWebhookBody } from "@/lib/integrations/inter/webhook-contract";
import { handleInterWebhookItem } from "@/features/financial/cash-deposits/inter-service.server";
import { AppError } from "@/lib/observability/app-error";
import { createInMemoryRateLimiter } from "@/lib/observability/rate-limit";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };
type CobrancaWebhookInput = z.infer<typeof interCobrancaWebhookSchema>;

const limiter = createInMemoryRateLimiter({ limit: 60, windowMs: 60_000, maxKeys: 10_000 });
const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "inter.cobranca.webhook.receive",
  version: 1,
  surface: { method: "POST", path: "/api/webhooks/inter/cobranca" },
  exposure: "public",
  identity: { kind: "none" },
  authorization: { kind: "none" },
  resourceScope: { kind: "none" },
  input: { kind: "schema", schema: "inter.cobranca.webhook-v3", unknownFields: "strip" },
  effects: { mode: "external", audit: "client-declared" },
  errorExposure: "sanitized",
});

const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, undefined, CobrancaWebhookInput, undefined>(contract, {
  async parseInput({ request }) {
    if (request.nextUrl.searchParams.size > 0) {
      throw new AppError({ code: "INTER_WEBHOOK_QUERY_REJECTED", kind: "VALIDATION", safeMessage: "A URL do webhook não aceita parâmetros.", reportable: false });
    }
    const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rate = limiter.check(client);
    if (!rate.allowed) {
      throw new AppError({ code: "INTER_WEBHOOK_RATE_LIMITED", kind: "EXPECTED_BUSINESS", httpStatus: 429, safeMessage: "Muitas notificações. Tente novamente mais tarde.", reportable: false, retryable: true });
    }
    const expectedAccount = getInterAccountNumber(getInterCobrancaEnvironment());
    if (expectedAccount && request.headers.get("x-conta-corrente") !== expectedAccount) {
      throw new AppError({ code: "INTER_WEBHOOK_ACCOUNT_MISMATCH", kind: "AUTHENTICATION", safeMessage: "Webhook não autorizado.", reportable: false });
    }
    const rawBody = await readBoundedInterWebhookBody(request);
    if (rawBody === null) {
      throw new AppError({ code: "INTER_WEBHOOK_PAYLOAD_TOO_LARGE", kind: "VALIDATION", httpStatus: 413, safeMessage: "Payload muito grande.", reportable: false });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch (cause) {
      throw new AppError({ code: "INTER_WEBHOOK_INVALID_JSON", kind: "VALIDATION", safeMessage: "JSON inválido.", reportable: false, cause });
    }
    const parsed = interCobrancaWebhookSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AppError({ code: "INTER_WEBHOOK_INVALID_PAYLOAD", kind: "VALIDATION", safeMessage: "Payload fora do contrato esperado.", reportable: false, cause: parsed.error });
    }
    return parsed.data;
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ request, security }) => {
  const receivedAt = new Date();
  const rawRef = financialDbAdmin.collection("interWebhookRawEvents").doc();
  const idempotencyKey = request.headers.get("x-chave-idempotencia");
  const accountNumber = request.headers.get("x-conta-corrente");
  await rawRef.set({
    id: rawRef.id,
    workspaceId: WORKSPACE_ID,
    receivedAt: Timestamp.fromDate(receivedAt),
    expiresAt: Timestamp.fromDate(interWebhookExpiry(receivedAt.getTime())),
    contentType: (request.headers.get("content-type") ?? "").slice(0, 120),
    byteLength: Buffer.byteLength(JSON.stringify(security.input), "utf8"),
    itemCount: security.input.length,
    eventHash: createHash("sha256").update(JSON.stringify(security.input)).digest("hex"),
    idempotencyKeyHash: idempotencyKey ? createHash("sha256").update(idempotencyKey).digest("hex") : null,
    accountNumberHash: accountNumber ? createHash("sha256").update(accountNumber).digest("hex") : null,
    valid: true,
    trustSource: "client-declared",
  });
  const results = [];
  for (const item of security.input) {
    results.push(await handleInterWebhookItem({
      item,
      workspaceId: WORKSPACE_ID,
      idempotencyKey,
    }));
  }
  return NextResponse.json({ ok: true, processed: results.length, results });
});
