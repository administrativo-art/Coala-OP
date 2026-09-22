import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSafeStoneDownloadUrl,
  parseStoneMoneyToCents,
  parseStonePixCsv,
  parseStonePixWebhookPayload,
  verifyStoneWebhookSecret,
} from "../../src/lib/integrations/stone/pix-conciliation";

test("valida o segredo sem aceitar valores ausentes", () => {
  assert.equal(verifyStoneWebhookSecret("segredo", "segredo"), true);
  assert.equal(verifyStoneWebhookSecret("errado", "segredo"), false);
  assert.equal(verifyStoneWebhookSecret(null, "segredo"), false);
  assert.equal(verifyStoneWebhookSecret("segredo", undefined), false);
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

test("converte valores monetários usados nos CSVs brasileiros", () => {
  assert.equal(parseStoneMoneyToCents("10.50"), 1_050);
  assert.equal(parseStoneMoneyToCents("1.234,56"), 123_456);
  assert.equal(parseStoneMoneyToCents("R$ 7,00"), 700);
  assert.equal(parseStoneMoneyToCents(""), 0);
});

test("extrai apenas campos operacionais e resume o CSV Pix", () => {
  const csv = [
    "id,amount,status,payment_method,created_at,merchant__document,pix_transaction__pix_key,pix_transaction__payer__name,pix_transaction__payer__document,pix_transaction__paid_amount,pix_transaction__canceled_amount,pix_transaction__fee_amount,pix_transaction__type,pix_transaction__terminal__type,pix_transaction__terminal__serial_number,pix_transaction__detail__operation,pix_transaction__detail__provider_datetime,pix_transaction__detail__operation_amount",
    "tx-1,87.00,paid,pix,2026-09-20T12:40:13Z,14276603000125,chave-secreta,Maria,12345678900,87.00,0,0,dynamic,POS,terminal-1,payment,2026-09-20T12:40:14Z,87.00",
  ].join("\n");
  const parsed = parseStonePixCsv(csv);

  assert.equal(parsed.summary.transactionCount, 1);
  assert.equal(parsed.summary.grossAmountCents, 8_700);
  assert.equal(parsed.summary.paidAmountCents, 8_700);
  assert.equal(parsed.summary.netAmountCents, 8_700);
  assert.equal(parsed.transactions[0]?.transactionId, "tx-1");
  assert.equal("pixKey" in (parsed.transactions[0] ?? {}), false);
  assert.equal("payerName" in (parsed.transactions[0] ?? {}), false);
  assert.equal("payerDocument" in (parsed.transactions[0] ?? {}), false);
});
