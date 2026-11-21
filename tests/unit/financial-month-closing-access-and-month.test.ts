import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../src/lib/observability/app-error";
import {
  assertMonthClosingAccess,
  canViewMonthClosing,
  canViewMonthClosingExpenseItems,
  canViewMonthClosingStoneItems,
} from "../../src/features/financial/month-closing/access";
import { defaultClosingMonth, formatCents, formatDateBr, isClosableRange, monthLabel, shiftMonth, todayKey } from "../../src/features/financial/month-closing/month";
import { dependsOnYou, nextDueDate } from "../../src/features/financial/month-closing/presentation";
import type { ClosingItem } from "../../src/features/financial/month-closing/types";

const actor = (financial: Record<string, unknown> | undefined, isDefaultAdmin = false) => ({ isDefaultAdmin, permissions: { financial: financial as never } });

test("sem a permissão própria ninguém vê o fechamento, nem com financial.view", () => {
  assert.equal(canViewMonthClosing(actor({ view: true })), false);
  assert.equal(canViewMonthClosing(actor({ view: true, monthClosings: { view: false } })), false);
  assert.equal(canViewMonthClosing(actor(undefined)), false);
});

test("a permissão própria sem financial.view também não basta", () => {
  assert.equal(canViewMonthClosing(actor({ view: false, monthClosings: { view: true } })), false);
});

test("financial.view e monthClosings.view liberam; administrador padrão sempre", () => {
  assert.equal(canViewMonthClosing(actor({ view: true, monthClosings: { view: true } })), true);
  assert.equal(canViewMonthClosing(actor(undefined, true)), true);
});

test("os itens de despesa exigem também financial.expenses.view", () => {
  assert.equal(canViewMonthClosingExpenseItems(actor({ view: true, monthClosings: { view: true } })), false);
  assert.equal(canViewMonthClosingExpenseItems(actor({ view: true, monthClosings: { view: true }, expenses: { view: true } })), true);
  assert.equal(canViewMonthClosingExpenseItems(actor({ view: true, expenses: { view: true } })), false);
  assert.equal(canViewMonthClosingExpenseItems(actor(undefined, true)), true);
});

test("os itens de Vendas e Taxas seguem as telas de origem: só administrador padrão", () => {
  assert.equal(canViewMonthClosingStoneItems(actor({ view: true, monthClosings: { view: true }, expenses: { view: true } })), false);
  assert.equal(canViewMonthClosingStoneItems(actor(undefined, true)), true);
});

test("assertMonthClosingAccess nega como erro de autorização sanitizado", () => {
  assert.throws(() => assertMonthClosingAccess(actor({ view: true })), (error) => error instanceof AppError && error.kind === "AUTHORIZATION");
  assert.doesNotThrow(() => assertMonthClosingAccess(actor({ view: true, monthClosings: { view: true } })));
});

test("shiftMonth atravessa a virada do ano", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2027-01", -1), "2026-12");
  assert.equal(shiftMonth("2026-10", -2), "2026-08");
});

test("a competência padrão é o mês anterior, nunca antes do início da DRE", () => {
  assert.equal(defaultClosingMonth(new Date("2026-11-20T15:00:00Z")), "2026-10");
  assert.equal(defaultClosingMonth(new Date("2026-08-10T15:00:00Z")), "2026-08");
  assert.equal(defaultClosingMonth(new Date("2026-01-10T15:00:00Z")), "2026-08");
});

test("hoje é calculado no fuso do negócio: 01:00 UTC ainda é o dia anterior em Belém", () => {
  assert.equal(todayKey(new Date("2026-12-01T01:00:00Z")), "2026-11-30");
  assert.equal(defaultClosingMonth(new Date("2026-12-01T01:00:00Z")), "2026-10");
});

test("o intervalo vai do início da DRE até o mês corrente", () => {
  const now = new Date("2026-11-20T15:00:00Z");
  assert.equal(isClosableRange("2026-07", now), false);
  assert.equal(isClosableRange("2026-08", now), true);
  assert.equal(isClosableRange("2026-11", now), true);
  assert.equal(isClosableRange("2026-12", now), false);
  assert.equal(isClosableRange("2026-13", now), false);
});

test("apresentação: mês por extenso, data brasileira e moeda", () => {
  assert.equal(monthLabel("2026-10"), "outubro de 2026");
  assert.equal(formatDateBr("2026-11-05"), "05/11/2026");
  assert.equal(formatDateBr(null), "—");
  assert.match(formatCents(123456), /^R\$\s1\.234,56$/);
  assert.equal(formatCents(null), "—");
});

test("depende de você × aguarda data, e a próxima data considera só o que aguarda", () => {
  const make = (id: string, kind: ClosingItem["kind"], dueDate: string | null): ClosingItem => ({ id, checkId: "c", kind, tone: "warn", title: id, detail: "", dueDate, amountCents: null, href: "/x" });
  const items = [make("a", "overdue", "2026-11-14"), make("b", "awaiting_due_date", "2026-11-25"), make("c", "awaiting_due_date", "2026-11-23"), make("d", "awaiting_due_date", "2026-11-10")];
  assert.equal(dependsOnYou(items[0]), true);
  assert.equal(dependsOnYou(items[1]), false);
  assert.equal(nextDueDate(items, "2026-11-20"), "2026-11-23");
  assert.equal(nextDueDate([make("a", "overdue", "2026-11-14")], "2026-11-20"), null);
});
