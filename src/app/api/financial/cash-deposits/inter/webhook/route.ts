import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashDepositAccess } from "@/features/financial/cash-closures/access.server";
import {
  configureCobrancaWebhook,
  retrieveConfiguredCobrancaWebhook,
} from "@/lib/integrations/inter/cobrancas";
import { getInterCobrancaEnvironment } from "@/lib/integrations/inter/config.server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function targetWebhookUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const secret = process.env.INTER_WEBHOOK_SECRET?.trim();
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL não configurada.");
  if (!secret) throw new Error("INTER_WEBHOOK_SECRET não configurado.");
  const url = new URL("/api/webhooks/inter/cobranca", appUrl);
  url.searchParams.set("secret", secret);
  return url;
}

function safeUrl(value: string) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "get-inter-cobranca-webhook",
  routeOrJob: "/api/financial/cash-deposits/inter/webhook",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  try {
    assertCashDepositAccess(context, "view");
  } catch (cause) {
    throw new AppError({ code: "INTER_WEBHOOK_VIEW_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  const configured = await retrieveConfiguredCobrancaWebhook();
  return NextResponse.json({
    environment: getInterCobrancaEnvironment(),
    webhookUrl: safeUrl(configured.webhookUrl),
  }, { headers: { "Cache-Control": "private, no-store" } });
});

export const POST = withApiErrorHandling({
  source: "api-financial",
  operation: "configure-inter-cobranca-webhook",
  routeOrJob: "/api/financial/cash-deposits/inter/webhook",
}, async (request: NextRequest) => {
  const context = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  try {
    assertCashDepositAccess(context, "issue");
  } catch (cause) {
    throw new AppError({ code: "INTER_WEBHOOK_CONFIGURE_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  const webhookUrl = targetWebhookUrl();
  await configureCobrancaWebhook(webhookUrl.toString());
  return NextResponse.json({
    ok: true,
    environment: getInterCobrancaEnvironment(),
    webhookUrl: safeUrl(webhookUrl.toString()),
  }, { headers: { "Cache-Control": "private, no-store" } });
});
