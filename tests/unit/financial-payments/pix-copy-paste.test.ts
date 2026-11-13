import assert from "node:assert/strict";
import test from "node:test";

import { parseAllowedPixCopyPaste, pixCrc16 } from "../../../src/features/financial/payment-requests/pix-copy-paste";

// Pix da guia FGTS Digital 10/2026 da CT Sorvetes (documento recebido na caixa).
const fgts = "00020101021226900014br.gov.bcb.pix2568pix-qrcode.caixa.gov.br/api/v2/cobv/7848581fcaea42e993a4208953e6c5cb5204000053039865802BR5923CAIXA ECONOMICA FEDERAL6008Brasilia62070503***6304DC8A";

function withCrc(body: string) {
  return `${body}6304${pixCrc16(`${body}6304`)}`;
}

test("aceita a guia FGTS Digital dinâmica da Caixa", () => {
  const parsed = parseAllowedPixCopyPaste(fgts);
  assert.ok(parsed);
  assert.equal(parsed.receiver, "fgts_digital");
  assert.equal(parsed.merchantName, "CAIXA ECONOMICA FEDERAL");
  assert.equal(parsed.locationHost, "pix-qrcode.caixa.gov.br");
  assert.equal(parsed.amountCents, null);
  assert.match(parsed.payloadHash, /^[0-9a-f]{64}$/);
});

test("recusa CRC incorreto e código truncado", () => {
  assert.equal(parseAllowedPixCopyPaste(`${fgts.slice(0, -4)}0000`), null);
  assert.equal(parseAllowedPixCopyPaste(fgts.slice(0, -10)), null);
  assert.equal(parseAllowedPixCopyPaste(` ${fgts} x`), null);
});

test("recusa recebedor, domínio ou chave fora da allowlist", () => {
  const body = fgts.slice(0, -8);
  assert.equal(parseAllowedPixCopyPaste(withCrc(body.replace("5923CAIXA ECONOMICA FEDERAL", "5923CAIXA ECONOMICA FALSA  "))), null);
  assert.equal(parseAllowedPixCopyPaste(withCrc(body.replace("pix-qrcode.caixa.gov.br", "pix-qrcode.caixa.gov.xx"))), null);
  const staticKey = "00020126360014br.gov.bcb.pix0114+5598999999999520400005303986540510.005802BR5923CAIXA ECONOMICA FEDERAL6008Brasilia62070503***";
  assert.equal(parseAllowedPixCopyPaste(withCrc(staticKey)), null);
});

test("lê valor explícito quando presente", () => {
  const body = fgts.slice(0, -8).replace("5303986", "530398654073785.07");
  assert.equal(parseAllowedPixCopyPaste(withCrc(body))?.amountCents, 378507);
});
