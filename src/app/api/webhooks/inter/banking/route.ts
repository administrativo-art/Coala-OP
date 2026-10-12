import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { type z } from "zod";

import { getInterAccountNumber, getInterEnvironment } from "@/lib/integrations/inter/config.server";
import { interBankingWebhookSchema, readBoundedInterWebhookBody } from "@/lib/integrations/inter/webhook-contract";
import { addPaymentEvent, findPaymentRequestByInterId } from "@/features/financial/payment-requests/repository.server";
import { refreshPaymentRequest } from "@/features/financial/payment-requests/service.server";
import { AppError } from "@/lib/observability/app-error";
import { createInMemoryRateLimiter } from "@/lib/observability/rate-limit";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };
type BankingWebhookInput = z.infer<typeof interBankingWebhookSchema>;

const limiter = createInMemoryRateLimiter({ limit: 60, windowMs: 60_000, maxKeys: 10_000 });
const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "inter.banking.webhook.receive",
  version: 1,
  surface: { method: "POST", path: "/api/webhooks/inter/banking" },
  exposure: "public",
  identity: { kind: "none" },
  authorization: { kind: "none" },
  resourceScope: { kind: "none" },
  input: { kind: "schema", schema: "inter.banking.webhook", unknownFields: "strip" },
  effects: { mode: "external", audit: "client-declared" },
  errorExposure: "sanitized",
});

const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, undefined, BankingWebhookInput, undefined>(contract, {
  async parseInput({ request }) {
    if (request.nextUrl.searchParams.size > 0) {
      throw new AppError({ code: "INTER_BANKING_WEBHOOK_QUERY_REJECTED", kind: "VALIDATION", safeMessage: "A URL do webhook não aceita parâmetros.", reportable: false });
    }
    const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!limiter.check(client).allowed) {
      throw new AppError({ code: "INTER_BANKING_WEBHOOK_RATE_LIMITED", kind: "EXPECTED_BUSINESS", httpStatus: 429, safeMessage: "Muitas notificações. Tente novamente mais tarde.", reportable: false, retryable: true });
    }
    const expectedAccount = getInterAccountNumber(getInterEnvironment());
    if (expectedAccount && request.headers.get("x-conta-corrente") !== expectedAccount) {
      throw new AppError({ code: "INTER_BANKING_WEBHOOK_ACCOUNT_MISMATCH", kind: "AUTHENTICATION", safeMessage: "Webhook não autorizado.", reportable: false });
    }
    const rawBody = await readBoundedInterWebhookBody(request);
    if (rawBody === null) {
      throw new AppError({ code: "INTER_BANKING_WEBHOOK_PAYLOAD_TOO_LARGE", kind: "VALIDATION", httpStatus: 413, safeMessage: "Payload muito grande.", reportable: false });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch (cause) {
      throw new AppError({ code: "INTER_BANKING_WEBHOOK_INVALID_JSON", kind: "VALIDATION", safeMessage: "JSON inválido.", reportable: false, cause });
    }
    const parsed = interBankingWebhookSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AppError({ code: "INTER_BANKING_WEBHOOK_INVALID_PAYLOAD", kind: "VALIDATION", safeMessage: "Payload fora do contrato esperado.", reportable: false, cause: parsed.error });
    }
    return parsed.data;
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
    const body = security.input;
    const interRequestId = body.codigoTransacao ?? body.codigoSolicitacao ?? body.transacaoPix?.codigoSolicitacao ?? "";
    const payment = await findPaymentRequestByInterId(interRequestId);
    if (!payment) return NextResponse.json({ accepted: true, matched: false });
    const eventHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    await addPaymentEvent(payment.id, "INTER_WEBHOOK_RECEIVED", "system", { interRequestId, reportedStatus: body.statusPagamento ?? body.status ?? null, trustSource: "client-declared" }, `webhook_${eventHash}`);
    await refreshPaymentRequest(payment.id, "system");
    return NextResponse.json({ accepted: true, matched: true });
});
