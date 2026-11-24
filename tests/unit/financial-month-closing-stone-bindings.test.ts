import assert from "node:assert/strict";
import test from "node:test";

import type { FinancialAgentMapping } from "../../src/features/financial/agent/contracts";
import { feeBindings, salesBindings } from "../../src/features/financial/month-closing/stone-bindings";

const mapping = (overrides: Partial<FinancialAgentMapping> & { id: string }): FinancialAgentMapping => ({
  workspaceId: "w", kioskId: "tirirical", accountId: "acc", stoneCodes: ["111"], terminalIds: [], status: "active",
  validFrom: "2026-01-01", validTo: null, ...overrides,
});

test("vínculo encerrado que vigorava no mês entra, como na tela de origem", () => {
  const old = mapping({ id: "antigo", status: "inactive", validTo: "2026-10-31" });
  const current = mapping({ id: "novo", validFrom: "2026-11-01" });
  assert.deepEqual(salesBindings([old, current], "2026-10-01", "2026-10-31").map((entry) => entry.id), ["antigo"]);
  assert.deepEqual(feeBindings([old, current], "2026-10-31").map((entry) => entry.id), ["antigo"]);
});

test("vínculo inativo sem data de fim, por terminal ou fora do mês não entra", () => {
  const inactiveOpen = mapping({ id: "a", status: "inactive" });
  const terminal = mapping({ id: "b", terminalIds: ["T1"] });
  const future = mapping({ id: "c", validFrom: "2026-12-01" });
  assert.deepEqual(salesBindings([inactiveOpen, terminal, future], "2026-10-01", "2026-10-31"), []);
  assert.deepEqual(feeBindings([inactiveOpen, terminal, future], "2026-10-31"), []);
});

test("troca de vínculo no meio do mês: Vendas conta os dois; Taxas fica com o vigente na data de referência", () => {
  const first = mapping({ id: "um", status: "inactive", validTo: "2026-10-14" });
  const second = mapping({ id: "dois", validFrom: "2026-10-15" });
  assert.deepEqual(salesBindings([first, second], "2026-10-01", "2026-10-31").map((entry) => entry.id), ["um", "dois"]);
  assert.deepEqual(feeBindings([first, second], "2026-10-31").map((entry) => entry.id), ["dois"]);
});

test("um vínculo com vários StoneCodes gera um item por StoneCode", () => {
  const many = mapping({ id: "m", stoneCodes: ["111", "222"] });
  assert.deepEqual(feeBindings([many], "2026-10-31").map((entry) => entry.stoneCode), ["111", "222"]);
});

test("vínculos concorrentes para o mesmo StoneCode em Taxas falham fechado", () => {
  const a = mapping({ id: "a" });
  const b = mapping({ id: "b", kioskId: "outro" });
  assert.throws(() => feeBindings([a, b], "2026-10-31"), /concorrentes/);
});
