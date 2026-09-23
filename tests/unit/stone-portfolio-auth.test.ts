import assert from "node:assert/strict";
import test from "node:test";
import { verifyStonePortfolioSyncSecret } from "../../src/features/financial/receivables/portfolio-auth";

const secret = "a".repeat(64);

test("aceita o token correto mesmo quando o Secret Manager preserva newline", () => {
  assert.equal(verifyStonePortfolioSyncSecret(`Bearer ${secret}`, `${secret}\n`), true);
  assert.equal(verifyStonePortfolioSyncSecret(`Bearer ${secret}`, `  ${secret}\r\n`), true);
});

test("não aceita ausência, token diferente ou segredo fora do formato", () => {
  assert.equal(verifyStonePortfolioSyncSecret(null, secret), false);
  assert.equal(verifyStonePortfolioSyncSecret(`Bearer ${"b".repeat(64)}`, secret), false);
  assert.equal(verifyStonePortfolioSyncSecret(`Bearer ${secret}`, "short"), false);
});
