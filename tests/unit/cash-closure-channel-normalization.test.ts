import assert from "node:assert/strict";
import test from "node:test";

import { normalizeChannel } from "../../src/features/financial/cash-closures/channel-normalization";

test("DINHEIRO e TROCO mapeiam para cash com sinais opostos", () => {
  const dinheiro = normalizeChannel("DINHEIRO");
  assert.equal(dinheiro.channel, "cash");
  assert.equal(dinheiro.sign, 1);
  assert.equal(dinheiro.isCashChange, false);

  const troco = normalizeChannel("TROCO");
  assert.equal(troco.channel, "cash");
  assert.equal(troco.sign, -1);
  assert.equal(troco.isCashChange, true);
});

test("variações de nome (acento, sufixo de adquirente) normalizam para o mesmo canal", () => {
  assert.equal(normalizeChannel("PIX STONE").channel, "pix");
  assert.equal(normalizeChannel("pix").channel, "pix");
  assert.equal(normalizeChannel("CARTÃO DÉBITO").channel, "debit_card");
  assert.equal(normalizeChannel("CARTAO DEBITO STONE VISA").channel, "debit_card");
  assert.equal(normalizeChannel("CARTÃO CRÉDITO").channel, "credit_card");
});

test("forma desconhecida cai em other", () => {
  const result = normalizeChannel("VALE REFEICAO XYZ");
  assert.equal(result.channel, "other");
  assert.equal(result.rawName, "VALE REFEICAO XYZ");
});
