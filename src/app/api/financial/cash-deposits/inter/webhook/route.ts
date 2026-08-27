import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertCashDepositAccess } from "@/features/financial/cash-closures/access.server";
import {
  configureCobrancaWebhook,
  retrieveConfiguredCobrancaWebhook,
} from "@/lib/integrations/inter/cobrancas";
import { getInterCobrancaEnvironment } from "@/lib/integrations/inter/config.server";

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

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    assertCashDepositAccess(context, "view");
    const configured = await retrieveConfiguredCobrancaWebhook();
    return NextResponse.json({
      environment: getInterCobrancaEnvironment(),
      webhookUrl: safeUrl(configured.webhookUrl),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar webhook Inter.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    assertCashDepositAccess(context, "issue");
    const webhookUrl = targetWebhookUrl();
    await configureCobrancaWebhook(webhookUrl.toString());
    return NextResponse.json({
      ok: true,
      environment: getInterCobrancaEnvironment(),
      webhookUrl: safeUrl(webhookUrl.toString()),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao configurar webhook Inter.";
    return NextResponse.json({ error: message }, { status: message.includes("permissão") ? 403 : 400 });
  }
}
