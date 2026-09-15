import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { confirmedBankBalanceSchema, reaisToCents } from "../../src/features/financial/cash-flow/opening-balance";

test("converte saldo assinado em centavos sem presumir zero", () => {
  assert.equal(reaisToCents(123.45), 12_345);
  assert.equal(reaisToCents(-10.01), -1_001);
  assert.throws(() => reaisToCents(Number.NaN), /Saldo inválido/);
});

test("confirmação exige instante, fonte e justificativa auditável", () => {
  assert.equal(confirmedBankBalanceSchema.safeParse({
    balanceCents: 12_345,
    confirmedAt: "2026-09-15T13:30:00-03:00",
    source: "bank_statement",
    reason: "Saldo conferido no extrato.",
  }).success, true);
  assert.equal(confirmedBankBalanceSchema.safeParse({ balanceCents: 0 }).success, false);
});

test("saldo confirmado é escrito no servidor com evento imutável e permissão própria", async () => {
  const [service, route, projection] = await Promise.all([
    readFile(new URL("../../src/features/financial/cash-flow/opening-balance.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/app/api/financial/bank-accounts/[accountId]/confirmed-balance/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/features/financial/cash-flow/projection.server.ts", import.meta.url), "utf8"),
  ]);
  assert.match(service, /runTransaction/);
  assert.match(service, /collection\("events"\)/);
  assert.match(service, /confirmedBalanceCents/);
  assert.match(route, /manageBankAccounts/);
  assert.match(projection, /balanceConfirmedAt/);
  assert.match(projection, /Number\.isSafeInteger\(confirmedBalance\) && confirmedAt/);
});
