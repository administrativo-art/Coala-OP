import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSafeStoneDownloadUrl,
  parseStoneAmountInCents,
  parseStonePixCsv,
  parseStonePixMerchantIdentity,
  parseStonePixWebhookPayload,
  verifyStoneWebhookSecret,
} from "../../src/lib/integrations/stone/pix-conciliation";

test("valida o segredo sem aceitar valores ausentes", () => {
  assert.equal(verifyStoneWebhookSecret("segredo", "segredo"), true);
  assert.equal(verifyStoneWebhookSecret("errado", "segredo"), false);
  assert.equal(verifyStoneWebhookSecret(null, "segredo"), false);
  assert.equal(verifyStoneWebhookSecret("segredo", undefined), false);
});

const syntheticIdentity = "[{name=Cliente, value=123456789}, {name=Terminal, value=TEST-001}]";

test("preserva StoneCode e terminal no formato do exemplo oficial, sem inferir unidade", () => {
  assert.deepEqual(parseStonePixMerchantIdentity(syntheticIdentity, "TEST-001"), {
    version: 1, status: "identified", stoneCode: "123456789", terminalSerialNumber: "TEST-001",
  });
  assert.equal(parseStonePixMerchantIdentity(
    "[{name=Terminal, value=TEST-001}, {name=Cliente, value=123456789}]", undefined,
  ).stoneCode, "123456789");
});

test("não atribui unidade por serial quando additional_data está ausente", () => {
  for (const value of [undefined, null, "", "  ", "[]"]) {
    assert.deepEqual(parseStonePixMerchantIdentity(value, "TEST-001"), {
      version: 1, status: "missing", stoneCode: null, terminalSerialNumber: null,
    });
  }
});

test("rejeita identidades incompletas, repetidas, desconhecidas ou truncáveis", () => {
  for (const value of [
    {}, 123, "[{name=Cliente, value=123456789}]",
    "[{name=Cliente, value=123}, {name=Cliente, value=123}]",
    syntheticIdentity.replace("Cliente", "stoneCode"),
    syntheticIdentity.replace("123456789", "0123456789"),
    syntheticIdentity.replace("123456789", "1e8"),
    syntheticIdentity.replace("123456789", "9".repeat(21)),
    syntheticIdentity.replace("TEST-001", "X".repeat(161)),
    `${syntheticIdentity}suffix`,
    `[${syntheticIdentity.slice(1, -1)}, {name=Pagador, value=privado}]`,
    "x".repeat(1025),
  ]) {
    const identity = parseStonePixMerchantIdentity(value, undefined);
    assert.equal(identity.status, "invalid");
    assert.equal(identity.stoneCode, null);
  }
});

test("divergência de terminal impede atribuição, sem normalizar case ou pontuação", () => {
  for (const serial of ["OTHER", "test-001", "TEST001", 123, "TEST-001" + "X".repeat(161)]) {
    assert.deepEqual(parseStonePixMerchantIdentity(syntheticIdentity, serial), {
      version: 1, status: "terminal_conflict", stoneCode: null, terminalSerialNumber: null,
    });
  }
});

test("CSV conserva evidência de identidade sem persistir additional_data bruto", () => {
  const parsed = parseStonePixCsv([
    "id;amount;pix_transaction__additional_data;pix_transaction__terminal__serial_number",
    `event-1;100;${syntheticIdentity};TEST-001`,
    "event-2;100;[];TEST-001",
    "event-3;100;[{name=Pagador, value=PRIVATE-PAYER}];TEST-001",
  ].join("\n"));
  assert.equal(parsed.transactions[0].merchantIdentity.stoneCode, "123456789");
  assert.equal(parsed.transactions[1].merchantIdentity.status, "missing");
  assert.equal(parsed.transactions[2].merchantIdentity.status, "invalid");
  assert.equal(JSON.stringify(parsed).includes("PRIVATE-PAYER"), false);
  assert.equal(JSON.stringify(parsed).includes("additional_data"), false);
  assert.equal(parsed.summary.grossAmountCents, 300);
});

test("aceita a validação e normaliza a notificação Pix", () => {
  assert.deepEqual(parseStonePixWebhookPayload({ type: "validation_notification" }), {
    type: "validation_notification",
  });
  assert.deepEqual(parseStonePixWebhookPayload({
    type: "pix",
    url: "https://arquivos.stone.com.br/arquivo.csv?token=privado",
    document: "14.276.603/0001-25",
    referenceDate: "2026-09-20",
  }), {
    type: "pix",
    url: "https://arquivos.stone.com.br/arquivo.csv?token=privado",
    document: "14276603000125",
    referenceDate: "2026-09-20",
  });
});

test("rejeita URLs que permitiriam acesso a redes locais", () => {
  assert.equal(assertSafeStoneDownloadUrl("https://arquivos.stone.com.br/file.csv").hostname,
    "arquivos.stone.com.br");
  for (const url of [
    "http://arquivos.stone.com.br/file.csv",
    "https://localhost/file.csv",
    "https://127.0.0.1/file.csv",
    "https://servico.internal/file.csv",
  ]) {
    assert.throws(() => assertSafeStoneDownloadUrl(url), /unsafe_download_url/);
  }
});

test("preserva os valores inteiros em centavos usados no CSV da Stone", () => {
  assert.equal(parseStoneAmountInCents("1050"), 1_050);
  assert.equal(parseStoneAmountInCents(1_234), 1_234);
  assert.equal(parseStoneAmountInCents("700,0"), 700);
  assert.equal(parseStoneAmountInCents(""), 0);
});

test("extrai apenas campos operacionais e resume o CSV Pix", () => {
  const csv = [
    "id;amount;status;payment_method;created_at;merchant__document;pix_transaction__pix_key;pix_transaction__payer__name;pix_transaction__payer__document;pix_transaction__paid_amount;pix_transaction__canceled_amount;pix_transaction__fee_amount;pix_transaction__type;pix_transaction__terminal__type;pix_transaction__terminal__serial_number;pix_transaction__detail__operation;pix_transaction__detail__provider_datetime;pix_transaction__detail__operation_amount",
    "tx-1;8700;paid;pix;2026-09-20T12:40:13Z;14276603000125;chave-secreta;Maria;12345678900;8700;0;63;dynamic;POS;terminal-1;payment;2026-09-20T12:40:14Z;8700",
  ].join("\n");
  const parsed = parseStonePixCsv(csv);

  assert.equal(parsed.summary.transactionCount, 1);
  assert.equal(parsed.summary.grossAmountCents, 8_700);
  assert.equal(parsed.summary.paidAmountCents, 8_700);
  assert.equal(parsed.summary.feeAmountCents, 63);
  assert.equal(parsed.summary.netAmountCents, 8_637);
  assert.equal(parsed.transactions[0]?.transactionId, "tx-1");
  assert.equal("pixKey" in (parsed.transactions[0] ?? {}), false);
  assert.equal("payerName" in (parsed.transactions[0] ?? {}), false);
  assert.equal("payerDocument" in (parsed.transactions[0] ?? {}), false);
});
