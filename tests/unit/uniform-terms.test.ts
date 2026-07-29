import assert from "node:assert/strict";
import test from "node:test";

import { getDocumentTypeConfig } from "../../src/lib/hr/employee-document-catalog";
import {
  isUniformTransactionId,
  parseUniformSignature,
  uniformDocumentTypeCode,
} from "../../src/features/uniforms/term-core";
import {
  UNIFORM_SYSTEM_TEMPLATES,
  uniformSystemTemplateById,
  uniformSystemTemplateId,
} from "../../src/features/uniforms/template-catalog";

test("cada movimentação de uniforme possui tipo documental próprio", () => {
  assert.equal(uniformDocumentTypeCode("delivery"), "UNIFORM_DELIVERY");
  assert.equal(uniformDocumentTypeCode("exchange"), "UNIFORM_EXCHANGE");
  assert.equal(uniformDocumentTypeCode("return"), "UNIFORM_RETURN");

  for (const code of ["UNIFORM_DELIVERY", "UNIFORM_EXCHANGE", "UNIFORM_RETURN"]) {
    const config = getDocumentTypeConfig(code);
    assert.equal(config.code, code);
    assert.equal(config.category, "uniforms");
    assert.equal(config.accessPolicyId, "HR_OPERATIONAL");
  }
});

test("os três termos aparecem como modelos nativos do sistema", () => {
  assert.equal(UNIFORM_SYSTEM_TEMPLATES.length, 3);
  assert.equal(uniformSystemTemplateId("delivery"), "system-uniform-delivery");
  assert.equal(uniformSystemTemplateId("exchange"), "system-uniform-exchange");
  assert.equal(uniformSystemTemplateId("return"), "system-uniform-return");
  assert.equal(uniformSystemTemplateById("system-uniform-exchange")?.category, "Uniformes");
  assert.equal(uniformSystemTemplateById("inexistente"), null);
});

test("protocolo aceita UUID e rejeita identificador arbitrário", () => {
  assert.equal(isUniformTransactionId("f5f2aa27-6582-4622-aaa4-416a4523f33f"), true);
  assert.equal(isUniformTransactionId("uniforme-123"), false);
});

test("assinatura PNG é validada e recebe hash estável", () => {
  const signature = `data:image/png;base64,${Buffer.from("assinatura").toString("base64")}`;
  const first = parseUniformSignature(signature, "colaborador");
  const second = parseUniformSignature(signature, "colaborador");
  assert.equal(first.dataUrl, signature);
  assert.equal(first.imageHash, second.imageHash);
  assert.equal(first.imageHash.length, 64);
  assert.throws(() => parseUniformSignature("data:image/jpeg;base64,AAAA", "colaborador"));
});
