import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptPaymentDestination,
  encryptPaymentDestination,
} from "../../../src/features/financial/beneficiaries/security.server";

const KEY = Buffer.alloc(32, 7).toString("base64");

test("protege e recupera um destino de pagamento com AES-256-GCM", () => {
  const source = { pixKey: "financeiro@example.com" };
  const encrypted = encryptPaymentDestination(source, KEY);
  assert.match(encrypted, /^v1\./);
  assert.equal(encrypted.includes(source.pixKey), false);
  assert.deepEqual(decryptPaymentDestination(encrypted, KEY), source);
});
test("recusa conteúdo adulterado", () => {
  const encrypted = encryptPaymentDestination({ pixKey: "12345678901" }, KEY);
  const changed = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;
  assert.throws(() => decryptPaymentDestination(changed, KEY));
});

test("exige chave com exatamente 32 bytes", () => {
  assert.throws(
    () => encryptPaymentDestination({ pixKey: "123" }, Buffer.from("curta").toString("base64")),
    /32 bytes/,
  );
});
