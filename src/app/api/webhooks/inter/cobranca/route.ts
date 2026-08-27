import { NextRequest, NextResponse } from "next/server";

import { WORKSPACE_ID } from "@/lib/workspace";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { interCobrancaWebhookSchema } from "@/lib/integrations/inter/cobrancas";
import { getInterConfig } from "@/lib/integrations/inter/config.server";
import {
  handleInterWebhookItem,
  verifyInterWebhookSecret,
} from "@/features/financial/cash-deposits/inter-service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const providedSecret = request.headers.get("x-inter-webhook-secret")
    ?? request.nextUrl.searchParams.get("secret");
  let expectedSecret: string | undefined;
  try {
    expectedSecret = getInterConfig().webhookSecret;
  } catch {
    expectedSecret = process.env.INTER_WEBHOOK_SECRET?.trim() || undefined;
  }
  if (!verifyInterWebhookSecret(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Webhook não autorizado." }, { status: 401 });
  }

  const rawBody = await request.text();
  const receivedAt = new Date().toISOString();
  const rawRef = financialDbAdmin.collection("interWebhookRawEvents").doc();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await rawRef.set({
      id: rawRef.id,
      workspaceId: WORKSPACE_ID,
      receivedAt,
      contentType: request.headers.get("content-type"),
      idempotencyKey: request.headers.get("x-chave-idempotencia"),
      rawBody,
      valid: false,
      error: "invalid_json",
    });
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const parsed = interCobrancaWebhookSchema.safeParse(payload);
  await rawRef.set({
    id: rawRef.id,
    workspaceId: WORKSPACE_ID,
    receivedAt,
    contentType: request.headers.get("content-type"),
    idempotencyKey: request.headers.get("x-chave-idempotencia"),
    accountNumber: request.headers.get("x-conta-corrente"),
    rawBody,
    valid: parsed.success,
    error: parsed.success ? null : parsed.error.flatten(),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload fora do contrato esperado." }, { status: 400 });
  }

  const idempotencyKey = request.headers.get("x-chave-idempotencia");
  const results = [];
  for (const item of parsed.data) {
    results.push(await handleInterWebhookItem({
      item,
      workspaceId: WORKSPACE_ID,
      idempotencyKey,
    }));
  }
  return NextResponse.json({ ok: true, processed: results.length, results });
}
