import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PaymentCliError, paymentCliErrorMessage, paymentCliFetch, paymentCliJson } from "../../../scripts/financial/payment-cli-transport";

test("transporte fixa origens, rejeita redirect e limita tempo sem rede real", async () => {
  const endpoints = [
    "https://op.coalashakes.com/api/financial/payment-requests/order_123/submit",
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword",
    "https://securetoken.googleapis.com/v1/token",
    "https://firestore.googleapis.com/v1/projects/demo-cli/databases/coala-financeiro/documents:runQuery",
  ];
  for (const url of endpoints) {
    let calls = 0;
    const fetcher: typeof fetch = async (_url, init) => {
      calls++;
      assert.equal(init?.redirect, "error");
      assert.equal(init?.cache, "no-store");
      assert.ok(init?.signal instanceof AbortSignal);
      return Response.json({ ok: true });
    };
    assert.equal((await paymentCliFetch(url, { redirect: "follow" }, fetcher)).status, 200);
    assert.equal(calls, 1);
  }
  for (const url of ["https://example.invalid", "http://op.coalashakes.com", "https://user:pass@op.coalashakes.com", "invalid"]) {
    await assert.rejects(paymentCliFetch(url, {}, async () => { assert.fail("não deve chamar fetch"); }), PaymentCliError);
  }
});

test("falha de envio nunca é repetida e nunca expõe erro/token bruto", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error("Bearer TOKEN_FICTICIO password=SEGREDO_FICTICIO"); };
  await assert.rejects(paymentCliFetch("https://op.coalashakes.com/api/financial/payment-requests/order_123/submit", { method: "POST" }, fetcher), error => {
    const message = paymentCliErrorMessage(error);
    assert.match(message, /incerto.*consulte o status/);
    assert.doesNotMatch(message, /TOKEN_FICTICIO|SEGREDO_FICTICIO/);
    return true;
  });
  assert.equal(calls, 1);
  assert.doesNotMatch(paymentCliErrorMessage(new Error("SEGREDO_FICTICIO")), /SEGREDO_FICTICIO/);
  assert.equal(paymentCliErrorMessage(new PaymentCliError("Informe --id.")), "Informe --id.");
});

test("resposta inválida e redirect não viram sucesso nem imprimem payload", async () => {
  await assert.rejects(paymentCliFetch("https://op.coalashakes.com", {}, async () => new Response(null, { status: 307 })), PaymentCliError);
  await assert.rejects(paymentCliJson(new Response("TOKEN_FICTICIO não é JSON")), error => {
    assert.match(paymentCliErrorMessage(error), /Resposta inválida/);
    assert.doesNotMatch(paymentCliErrorMessage(error), /TOKEN_FICTICIO/);
    return true;
  });
});

test("CLI usa somente transporte protegido e mantém segredo fora de argv", () => {
  // Include the .mts entry in tsc via its ESM declaration path, without executing it.
  const sessionExport: keyof typeof import("../../../scripts/financial/coala-authenticated-payment.mjs") = "withCoalaSession";
  const source = readFileSync(new URL("../../../scripts/financial/coala-authenticated-payment.mts", import.meta.url), "utf8");
  assert.match(source, new RegExp(`export async function ${sessionExport}`));
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.match(source, /paymentCliErrorMessage\(error\)/);
  assert.match(source, /input: command === "write" \? token : undefined/);
  assert.match(source, /request\?\.id !== id/);
});
