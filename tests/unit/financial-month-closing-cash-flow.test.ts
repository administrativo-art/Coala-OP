import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCashFlow, type CashInput, type CashKioskInput } from "../../src/features/financial/month-closing/cash-flow";
import { dependsOnYou } from "../../src/features/financial/month-closing/presentation";

const kiosk = (overrides: Partial<CashKioskInput> = {}): CashKioskInput => ({
  key: "k", label: "Tiririca", closuresHref: "/caixa", depositsHref: "/dep",
  closureDays: 30, openDays: 0, depositDays: 25, unpaidDays: 0, unpaidCents: 0, ...overrides,
});
const flow = (cash: CashInput, canViewItems = true) => evaluateCashFlow({ cash, canViewItems, originHref: "/caixa?month=2026-10" });
const check = (result: ReturnType<typeof flow>, id: string) => result.checks.find((entry) => entry.id === id)!;

test("Dinheiro fecha sozinho com todos os dias aprovados e todos os depósitos pagos", () => {
  const result = flow({ monthOver: true, kiosks: [kiosk(), kiosk({ key: "m", label: "Matriz" })] });
  assert.equal(result.key, "cash");
  assert.equal(result.state, "ok");
  assert.deepEqual([check(result, "cash.closing").done, check(result, "cash.closing").total], [60, 60]);
  assert.deepEqual([check(result, "cash.deposit").done, check(result, "cash.deposit").total], [50, 50]);
  assert.equal(result.items.length, 0);
});

test("dia não aprovado trava o fechamento do caixa e segura também o depósito", () => {
  const result = flow({ monthOver: true, kiosks: [kiosk({ openDays: 2 })] });
  assert.equal(check(result, "cash.closing").state, "pending");
  assert.deepEqual([check(result, "cash.closing").done, check(result, "cash.closing").total], [28, 30]);
  assert.equal(check(result, "cash.deposit").state, "pending");
  assert.match(check(result, "cash.deposit").note ?? "", /todos os dias/);
  const item = result.items.find((entry) => entry.kind === "cash_closing_open")!;
  assert.equal(item.href, "/caixa");
  assert.equal(dependsOnYou(item), true);
});

test("depósito não pago aparece com valor e o fechamento do caixa continua conferido", () => {
  const result = flow({ monthOver: true, kiosks: [kiosk({ unpaidDays: 3, unpaidCents: 45000 })] });
  assert.equal(check(result, "cash.closing").state, "ok");
  assert.equal(check(result, "cash.deposit").state, "pending");
  assert.deepEqual([check(result, "cash.deposit").done, check(result, "cash.deposit").total], [22, 25]);
  const item = result.items.find((entry) => entry.kind === "cash_deposit_unpaid")!;
  assert.equal(item.amountCents, 45000);
  assert.equal(item.href, "/dep");
});

test("com o mês em curso as duas conferências ficam pendentes, nunca conferidas", () => {
  const result = flow({ monthOver: false, kiosks: [kiosk()] });
  assert.equal(result.state, "pending");
  assert.equal(check(result, "cash.closing").state, "pending");
  assert.equal(check(result, "cash.deposit").state, "pending");
  assert.equal(result.items.length, 0);
});

test("mês terminado sem nenhum fechamento de caixa lido não fecha", () => {
  const result = flow({ monthOver: true, kiosks: [] });
  assert.equal(result.state, "pending");
  assert.match(check(result, "cash.closing").note ?? "", /Nenhum fechamento/);
});

test("falha na leitura dos fechamentos deixa o fluxo indisponível", () => {
  const result = flow(null);
  assert.equal(result.state, "unavailable");
  assert.equal(check(result, "cash.closing").state, "unavailable");
  assert.equal(check(result, "cash.deposit").state, "unavailable");
});

test("sem permissão os itens ficam ocultos", () => {
  const hidden = flow({ monthOver: true, kiosks: [kiosk({ openDays: 1, unpaidDays: 1, unpaidCents: 100 })] }, false);
  assert.equal(hidden.items.length, 0);
  assert.equal(hidden.itemsHidden, true);
});
