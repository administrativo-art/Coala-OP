import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { navigationActiveHref } from "../../src/lib/navigation-active-href";

const root = "/dashboard/financial";
const expenses = `${root}/expenses`;
const audit = `${expenses}?view=audits`;
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("extrato destaca conciliação sem perder identificação quando há sessão, ledger ou filtros", () => {
  const hrefs = ["/dashboard", root, expenses, audit];
  for (const search of ["view=audits", "session=abc&view=audits&ledger=credit_card%3Ac1&status=pending"]) {
    assert.equal(navigationActiveHref(hrefs, expenses, search), audit);
  }
  assert.equal(navigationActiveHref(hrefs, expenses, "view=expenses"), expenses);
  assert.equal(navigationActiveHref(hrefs, expenses, "session=abc"), expenses);
  assert.equal(navigationActiveHref(hrefs.filter(href => href !== audit), expenses, "view=audits"), expenses);
});

test("rota mais específica vence e agrupadores não são destinos", () => {
  const cards = `${expenses}/card-statements`;
  const agent = `${root}/cash-flow/agent`;
  assert.equal(navigationActiveHref([expenses, audit, cards], cards, "view=audits"), cards);
  assert.equal(navigationActiveHref([`${root}/cash-flow`, agent], agent, ""), agent);
  assert.equal(navigationActiveHref(["/dashboard", "__group:cash-flow"], "/dashboard/unknown", ""), null);
  assert.equal(navigationActiveHref([expenses], `${expenses}-other`, ""), null);
});

test("sidebar mantém contas a pagar e controle de caixa e coloca conciliação antes do fluxo", () => {
  const source = read("src/components/sidebar.tsx");
  const reconciliation = source.slice(source.indexOf('label: "Conciliação"'), source.indexOf('label: "Fluxo de caixa"'));
  assert.match(reconciliation, /label: "Extrato bancário", href: "\/dashboard\/financial\/expenses\?view=audits".*show: permissions\.financial\?\.audits\?\.view/);
  assert.match(reconciliation, /label: "Faturas de cartão".*show: permissions\.financial\?\.cardStatements\?\.view/);
  assert.match(reconciliation, /label: "Antecipações Stone".*show: isDefaultAdmin/);
  assert.match(source, /label: "Coala Financeiro".*show: isDefaultAdmin/);
  for (const label of ["Contas a pagar", "Despesas", "Controle de caixa", "Fechamento do caixa", "Depósitos", "Visão do caixa"]) {
    assert.ok(source.includes(`label: "${label}"`));
  }
  assert.match(source, /navigationActiveHref\(flatItems\.map/);
});

test("novas entradas reutilizam componentes protegidos e preservam rotas anteriores", () => {
  for (const route of ["expenses/card-statements", "reconciliation/card-statements"]) {
    assert.match(read(`src/app/dashboard/financial/${route}/page.tsx`), /<CardStatementsPage \/>/);
  }
  for (const route of ["stone-anticipations", "cash-flow/agent"]) {
    assert.match(read(`src/app/dashboard/financial/${route}/page.tsx`), /StoneAnticipationsPage/);
  }
  const page = read("src/features/financial/pages/stone-anticipations-page.tsx");
  assert.match(page, /if \(!isDefaultAdmin\)/);
  assert.match(page, /ainda não estão disponíveis neste agente/);
  assert.match(read("src/features/financial/pages/card-statements-page.tsx"), /if \(!canViewCardStatements\)/);
  assert.match(read("src/features/financial/pages/expenses-page.tsx"), /<FinancialImportPage embedded showImportControls=\{false\} \/>/);
  const importer = read("src/features/financial/pages/import-page.tsx");
  assert.match(importer, /url\.searchParams\.set\("session", sessionId\)/);
  assert.match(importer, /url\.searchParams\.set\("ledger", view\)/);
});
