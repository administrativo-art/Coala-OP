import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { navigationActiveHref } from "../../src/lib/navigation-active-href";
import {
  bankStatementsHref,
  cardStatementsHref,
  cardStatementsReturnHref,
  expensesReturnHref,
  financialSearchQuery,
  financialSidebarPath,
} from "../../src/features/financial/lib/reconciliation-navigation";
import { FINANCIAL_ROUTES } from "../../src/features/financial/lib/constants";

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

test("sidebar reúne conciliação e fechamento sem antecipar fechamento mensal", () => {
  const source = read("src/components/sidebar.tsx");
  const reconciliation = source.slice(source.indexOf('label: "Conciliação e fechamento"'), source.indexOf('label: "Fluxo de caixa"'));
  assert.match(reconciliation, /label: "Extratos bancários", href: "\/dashboard\/financial\/reconciliation\/bank-statements".*show: permissions\.financial\?\.audits\?\.view/);
  assert.match(reconciliation, /label: "Faturas de cartão de crédito".*show: permissions\.financial\?\.cardStatements\?\.view/);
  assert.match(reconciliation, /label: "Vendas e recebimentos".*show: isDefaultAdmin/);
  assert.match(reconciliation, /label: "Fechamento de caixa".*show: permissions\.financial\?\.view/);
  assert.match(reconciliation, /label: "Depósitos".*show: !permissions\.financial\?\.view && permissions\.financial\?\.cashDeposits\?\.view/);
  assert.match(source, /label: "Coala Financeiro".*show: isDefaultAdmin/);
  for (const label of ["Despesas", "Fechamento de caixa", "Visão do caixa"]) {
    assert.ok(source.includes(`label: "${label}"`));
  }
  assert.doesNotMatch(source, /label: "(Contas a pagar|Controle de caixa|Fechamento mensal|Antecipações Stone)"/);
  assert.equal((source.match(/label: "Faturas de cartão de crédito"/g) ?? []).length, 1);
  assert.match(source, /navigationActiveHref\(hrefs, financialSidebarPath/);
});

test("novas entradas reutilizam componentes protegidos e preservam rotas anteriores", () => {
  assert.match(read("src/app/dashboard/financial/reconciliation/card-statements/page.tsx"), /<CardStatementsPage \/>/);
  for (const route of ["expenses/card-statements", "expenses/import", "expenses"]) {
    const source = read(`src/app/dashboard/financial/${route}/page.tsx`);
    assert.match(source, /redirect\(/);
    assert.match(source, /financialSearchQuery/);
  }
  for (const route of ["stone-anticipations", "cash-flow/agent"]) {
    assert.match(read(`src/app/dashboard/financial/${route}/page.tsx`), /StoneAnticipationsPage/);
  }
  const page = read("src/features/financial/pages/stone-anticipations-page.tsx");
  assert.match(page, /if \(!isDefaultAdmin\)/);
  assert.match(page, /ainda não estão disponíveis neste agente/);
  assert.match(read("src/features/financial/pages/card-statements-page.tsx"), /if \(!canViewCardStatements\)/);
  const expensesPage = read("src/features/financial/pages/expenses-page.tsx");
  assert.doesNotMatch(expensesPage, /<FinancialImportPage embedded showImportControls=\{false\} \/>/);
  assert.match(expensesPage, /onImportComplete=\{\(sessionId\) =>/);
  assert.match(expensesPage, /bankStatementsHref\(expenseContextQuery, \{ sessionId, fromExpenses: true \}\)/);
  assert.match(expensesPage, /const expenseContextQuery = new URLSearchParams\(/);
  for (const value of ["status: statusFilter", "unit: unitFilter", "competence: competenceMonth", "date_from: dateFrom", "date_to: dateTo", "supplier: supplierFilter", "account_plan: accountPlanFilter"]) assert.ok(expensesPage.includes(value));
  for (const label of ["Cobranças recebidas", "Autorizações bancárias", "Importar extrato", "Novo lançamento", "Faturas de cartão"]) assert.ok(expensesPage.includes(label));
  const bankPage = read("src/features/financial/pages/bank-statements-page.tsx");
  assert.match(bankPage, /permissions\.financial\?\.audits\?\.view !== true/);
  assert.ok(bankPage.indexOf("FinancialAccessGuard title=") < bankPage.indexOf("<FinancialImportPage embedded"));
  assert.match(bankPage, /<PageContainer variant="wide"/);
  assert.match(bankPage, /<BackButton/);
  const importer = read("src/features/financial/pages/import-page.tsx");
  assert.match(importer, /url\.searchParams\.set\("session", sessionId\)/);
  assert.doesNotMatch(importer, /CardStatementsWorkspace/);
  assert.match(importer, /cardStatementsHref/);
  assert.match(importer, /FinancialCompetenceNavigator/);
  assert.match(importer, /!embedded \|\| \(showImportControls && !uploadOnly\)/);
  assert.match(importer, /FINANCIAL_ROUTES.bankStatements/);
});

test("upload abre a sessão criada, preserva filtros de Despesas e não herda cartão anterior", () => {
  const href = bankStatementsHref("unit=u1&status=pending&competence=2026-09&session=old&ledger=credit_card%3Ac1", { sessionId: "new/id", fromExpenses: true });
  const url = new URL(href, "https://navigation.local");
  assert.equal(url.pathname, FINANCIAL_ROUTES.bankStatements);
  assert.equal(url.searchParams.get("session"), "new/id");
  assert.equal(url.searchParams.get("ledger"), null);
  assert.equal(url.searchParams.get("returnTo"), `${expenses}?unit=u1&status=pending&competence=2026-09`);
});

test("atalho antigo preserva sessão, remove ledger e a volta não redireciona de novo à auditoria", () => {
  const url = new URL(bankStatementsHref("view=audits&session=s1&ledger=credit_card%3Ac1&unit=u1", { fromExpenses: true }), "https://navigation.local");
  assert.equal(url.searchParams.get("view"), null);
  assert.equal(url.searchParams.get("session"), "s1");
  assert.equal(url.searchParams.get("ledger"), null);
  assert.equal(url.searchParams.get("returnTo"), `${expenses}?unit=u1`);
  assert.equal(bankStatementsHref(), FINANCIAL_ROUTES.bankStatements);
});

test("atalho de cartão abre a página dedicada com competência, conta, cartão e retorno seguro", () => {
  const returnTo = `${FINANCIAL_ROUTES.bankStatements}?session=s%2F1&ledger=credit_card%3Aold`;
  const url = new URL(cardStatementsHref({
    monthKey: "2026-09",
    accountId: "a/1",
    paymentMethodId: "c/1",
    returnTo,
  }), "https://navigation.local");

  assert.equal(url.pathname, FINANCIAL_ROUTES.cardStatements);
  assert.equal(url.searchParams.get("month"), "2026-09");
  assert.equal(url.searchParams.get("accountId"), "a/1");
  assert.equal(url.searchParams.get("paymentMethodId"), "c/1");
  assert.equal(url.searchParams.get("returnTo"), `${FINANCIAL_ROUTES.bankStatements}?session=s%2F1`);
});

test("redirecionamento de fatura preserva cartão/conta/mês e parâmetros repetidos", () => {
  const query = financialSearchQuery({ month: "2026-09", accountId: "a/1", paymentMethodId: "c1", filter: ["a", "b"], absent: undefined });
  const params = new URLSearchParams(query);
  assert.equal(params.get("month"), "2026-09");
  assert.equal(params.get("accountId"), "a/1");
  assert.equal(params.get("paymentMethodId"), "c1");
  assert.deepEqual(params.getAll("filter"), ["a", "b"]);
  assert.equal(params.has("absent"), false);
});

test("retorno recusa destinos externos, protocolos e ciclos", () => {
  for (const value of [null, "https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "javascript:alert(1)", "/dashboard/financial/expenses-other", "/dashboard/financial/expenses/new"]) {
    assert.equal(expensesReturnHref(value), expenses);
  }
  assert.equal(expensesReturnHref(`${expenses}?view=audits&session=s1&ledger=c1&returnTo=bad&search=energia`), `${expenses}?search=energia`);
});

test("retorno das faturas aceita apenas Despesas ou o extrato bancário", () => {
  assert.equal(cardStatementsReturnHref(`${FINANCIAL_ROUTES.bankStatements}?session=s1&ledger=credit_card%3Ac1`), `${FINANCIAL_ROUTES.bankStatements}?session=s1`);
  assert.equal(cardStatementsReturnHref(`${expenses}?search=energia`), `${expenses}?search=energia`);
  for (const value of [null, "https://evil.invalid", "//evil.invalid", "/dashboard", `${expenses}/new`]) {
    assert.equal(cardStatementsReturnHref(value), expenses);
  }
});

test("depósitos e antecipações mantêm item pai selecionado sem conceder visibilidade", () => {
  const cash = `${root}/cash-closures`;
  const deposits = `${root}/cash-deposits`;
  const sales = `${root}/sales-reconciliation`;
  const anticipation = `${root}/stone-anticipations`;
  assert.equal(financialSidebarPath(deposits, [cash, sales]), cash);
  assert.equal(financialSidebarPath(anticipation, [cash, sales]), sales);
  assert.equal(financialSidebarPath(deposits, [deposits]), deposits);
  assert.equal(financialSidebarPath(anticipation, [expenses]), anticipation);
  assert.equal(financialSidebarPath(`${cash}/sessions/s1`, [cash]), `${cash}/sessions/s1`);
});

test("conciliação segue o contrato visual documentado", () => {
  const importer = read("src/features/financial/pages/import-page.tsx");
  const cards = read("src/features/financial/pages/card-statements-page.tsx");
  const guide = read("docs/engineering/ui-design-system.md");
  const navigator = read("src/features/financial/components/financial-competence-navigator.tsx");

  assert.match(importer, /<FinancialCompetenceNavigator/);
  assert.match(cards, /<FinancialCompetenceNavigator/);
  assert.match(cards, /data-ui="financial-card-selector"/);
  assert.match(navigator, /\bAnterior\b/);
  assert.match(navigator, /Próxima/);
  assert.match(guide, /Importar → Auditar → Fechar/);
  assert.match(guide, /\*\*Pendente\*\*/);
  assert.match(guide, /\*\*Conciliada\*\*/);
  assert.match(guide, /Use `BackButton`/);
});
