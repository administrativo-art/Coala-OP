import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  cleanInterCobrancaWebhookUrl,
  interBankingWebhookSchema,
  interCobrancaWebhookSchema,
  interWebhookBodyFits,
  interWebhookExpiry,
  readBoundedInterWebhookBody,
} from "../../src/lib/integrations/inter/webhook-contract";

const validCobranca = {
  codigoSolicitacao: "5d5df9e3-84c5-4a9f-a4e1-475f33c1c659",
  seuNumero: "COALA-1",
  situacao: "RECEBIDO",
  dataHoraSituacao: "2026-10-12T00:00:00-03:00",
};

test("Inter webhook schemas retain only allowlisted notification fields", () => {
  const cobranca = interCobrancaWebhookSchema.parse([{ ...validCobranca, pagador: { cpfCnpj: "secret" } }]);
  assert.equal("pagador" in cobranca[0], false);

  const banking = interBankingWebhookSchema.parse({ codigoSolicitacao: "request-1", status: "PAGO", beneficiary: "secret" });
  assert.deepEqual(banking, { codigoSolicitacao: "request-1", status: "PAGO" });
  assert.equal(interBankingWebhookSchema.safeParse({ status: "PAGO" }).success, false);
});

test("Inter webhook input is bounded by item count and bytes", () => {
  assert.equal(interCobrancaWebhookSchema.safeParse(Array.from({ length: 26 }, () => validCobranca)).success, false);
  assert.equal(interWebhookBodyFits("{}", "65536"), true);
  assert.equal(interWebhookBodyFits("{}", "65537"), false);
  assert.equal(interWebhookBodyFits("x".repeat(65_537), null), false);
});

test("Inter webhook body reader stops before buffering an oversized request", async () => {
  const accepted = await readBoundedInterWebhookBody(new Request("https://coala.example", {
    method: "POST",
    body: "{}",
  }));
  assert.equal(accepted, "{}");

  const rejected = await readBoundedInterWebhookBody(new Request("https://coala.example", {
    method: "POST",
    body: "x".repeat(65_537),
  }));
  assert.equal(rejected, null);
});

test("Inter receipt retention is 30 days", () => {
  const now = Date.UTC(2026, 9, 12);
  assert.equal(interWebhookExpiry(now).getTime() - now, 30 * 24 * 60 * 60 * 1_000);
});

test("financial Firestore configuration keeps webhook receipt TTL enabled", async () => {
  const config = JSON.parse(await readFile("firestore.financial.indexes.json", "utf8")) as {
    fieldOverrides?: Array<{ collectionGroup?: string; fieldPath?: string; ttl?: boolean }>;
  };
  assert.ok(config.fieldOverrides?.some((field) =>
    field.collectionGroup === "interWebhookRawEvents"
    && field.fieldPath === "expiresAt"
    && field.ttl === true));
});

test("Inter callback URL is HTTPS and contains no secret-bearing query", () => {
  assert.equal(cleanInterCobrancaWebhookUrl("https://coala.example/base?old=1").toString(), "https://coala.example/api/webhooks/inter/cobranca");
  assert.throws(() => cleanInterCobrancaWebhookUrl("http://coala.example"));
  assert.throws(() => cleanInterCobrancaWebhookUrl("https://user:pass@coala.example"));
});

test("Inter webhook routes use secureRoute and do not consume query secrets or raw bodies", async () => {
  const [cobranca, banking, configuration, reconciliation] = await Promise.all([
    readFile("src/app/api/webhooks/inter/cobranca/route.ts", "utf8"),
    readFile("src/app/api/webhooks/inter/banking/route.ts", "utf8"),
    readFile("src/app/api/financial/cash-deposits/inter/webhook/route.ts", "utf8"),
    readFile("src/app/api/jobs/inter/cobrancas/reconcile/route.ts", "utf8"),
  ]);
  for (const source of [cobranca, banking, configuration, reconciliation]) {
    assert.match(source, /secureRoute/);
  }
  assert.doesNotMatch(cobranca, /searchParams\.get\(["']secret/);
  assert.doesNotMatch(banking, /searchParams\.get\(["']token/);
  assert.doesNotMatch(configuration, /INTER_WEBHOOK_SECRET|searchParams\.set/);
  assert.doesNotMatch(cobranca, /rawBody,\s*$/m);
});

