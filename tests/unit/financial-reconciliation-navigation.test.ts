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
  assert.match(reconciliation, /label: "Conciliação de vendas".*show: isDefaultAdmin/);
  assert.match(reconciliation, /label: "Conciliação de recebimentos".*show: isDefaultAdmin/);
  assert.match(reconciliation, /label: "Fechamento de caixa".*show: permissions\.financial\?\.view/);
  assert.match(reconciliation, /label: "Fechamento de caixa"[\s\S]*label: "Depósitos"/);
  assert.match(reconciliation, /label: "Depósitos".*show: permissions\.financial\?\.cashDeposits\?\.view/);
  assert.match(source, /label: "Coala Financeiro".*show: isDefaultAdmin/);
  assert.doesNotMatch(source, /label: "Orçamento × despesas"/);
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
  assert.match(read("src/app/dashboard/financial/stone-receipts/page.tsx"), /<StoneReceiptsPage \/>/);
  const receiptsPage = read("src/features/financial/receipts-reconciliation/receipts-page.tsx");
  assert.match(receiptsPage, /if \(!isDefaultAdmin\)/);
  assert.match(receiptsPage, /useEffect\(\(\) => \{[\s\S]*stone-mappings\?resource=mappings/);
  assert.match(receiptsPage, /Selecione a unidade primeiro/);
  assert.match(receiptsPage, /Taxa contratada/);
  assert.match(receiptsPage, /Taxa praticada/);
  assert.doesNotMatch(receiptsPage, />Abrir contestação</);
  assert.doesNotMatch(receiptsPage, /href="\/dashboard\/financial\/sales-reconciliation"/);
  const salesPage = read("src/features/financial/sales-reconciliation/review-page.tsx");
  const salesRoute = read("src/app/dashboard/financial/sales-reconciliation/page.tsx");
  assert.match(salesPage, /useEffect\(\(\) => \{[\s\S]*stone-mappings\?resource=mappings/);
  assert.match(salesRoute, /const now = new Date\(\)/);
  assert.match(salesRoute, /financialDateKey\(now\)/);
  assert.match(salesRoute, /latestPublishedDate\(now\)/);
  assert.match(salesPage, /calendarToday[\s\S]*publishedThrough/);
  assert.match(salesPage, /Selecione a unidade primeiro/);
  assert.doesNotMatch(salesPage, /AcquirerFeesPanel/);
  assert.doesNotMatch(salesPage, /href="\/dashboard\/financial\/(stone-receipts|stone-anticipations)"/);
  assert.match(salesPage, /text: "Divergências", count: view\.attention\.length/);
  assert.match(read("src/features/financial/sales-reconciliation/review-view.ts"), /caseReasons\[row\.kind\]/);
  const page = read("src/features/financial/pages/stone-anticipations-page.tsx");
  assert.match(page, /if \(!isDefaultAdmin\)/);
  assert.match(page, /ainda não estão disponíveis neste agente/);
  assert.match(read("src/features/financial/pages/card-statements-page.tsx"), /if \(!canViewCardStatements\)/);
  const expensesPage = read("src/features/financial/pages/expenses-page.tsx");
  assert.match(expensesPage, /<FinancialImportPage/);
  assert.doesNotMatch(expensesPage, /<TabsList|Extratos bancários<\/span>/);
  assert.match(expensesPage, /<PageHeader/);
  assert.match(expensesPage, /<PageContainer variant="wide" surface/);
  for (const label of ["Cobranças recebidas", "Autorizações bancárias", "Ações", "Orçamento × despesas", "Importar extrato", "Novo lançamento"]) assert.ok(expensesPage.includes(label));
  assert.doesNotMatch(expensesPage, /Acessos rápidos/);
  assert.ok(expensesPage.indexOf("> Novo lançamento") < expensesPage.indexOf("<Menu className="));
  assert.doesNotMatch(expensesPage, />\s*Faturas de cartão\s*</);
  const bankPage = read("src/features/financial/pages/bank-statements-page.tsx");
  assert.match(bankPage, /permissions\.financial\?\.audits\?\.view !== true/);
  assert.ok(bankPage.indexOf("FinancialAccessGuard title=") < bankPage.indexOf("<FinancialImportPage"));
  assert.match(bankPage, /<PageContainer variant="wide"/);
  assert.match(bankPage, /back=\{\{/);
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

test("páginas contextuais mantêm o item pai selecionado sem conceder visibilidade", () => {
  const cash = `${root}/cash-closures`;
  const deposits = `${root}/cash-deposits`;
  const budgetComparison = `${root}/budget-comparison`;
  const sales = `${root}/sales-reconciliation`;
  const receipts = `${root}/stone-receipts`;
  const anticipation = `${root}/stone-anticipations`;
  assert.equal(financialSidebarPath(deposits, [cash, sales]), cash);
  assert.equal(financialSidebarPath(deposits, [cash, deposits, sales]), deposits);
  assert.equal(financialSidebarPath(anticipation, [cash, sales, receipts]), receipts);
  assert.equal(financialSidebarPath(deposits, [deposits]), deposits);
  assert.equal(financialSidebarPath(anticipation, [expenses]), anticipation);
  assert.equal(financialSidebarPath(budgetComparison, [expenses]), expenses);
  assert.equal(financialSidebarPath(budgetComparison, [budgetComparison, expenses]), budgetComparison);
  assert.equal(financialSidebarPath(`${cash}/sessions/s1`, [cash]), `${cash}/sessions/s1`);
});

test("orçamento × despesas segue o padrão contextual de Despesas", () => {
  const page = read("src/features/financial/pages/budget-comparison-page.tsx");
  const expensesPage = read("src/features/financial/pages/expenses-page.tsx");
  assert.match(page, /<PageContainer variant="wide" surface/);
  assert.match(page, /<PageHeader/);
  assert.match(page, /back=\{\{ fallbackHref: expensesHref, parentLabel: "Despesas" \}\}/);
  assert.match(expensesPage, /FINANCIAL_ROUTES\.budgetComparison/);
});

test("painel financeiro segue a superfície ampla sem duplicar a sidebar", () => {
  const page = read("src/features/financial/pages/financial-dashboard-page.tsx");
  assert.match(page, /<PageContainer variant="wide" surface/);
  assert.match(page, /<PageHeader/);
  assert.doesNotMatch(page, /function ShortcutCard|<ShortcutCard/);
  assert.match(page, /rounded-\[18px\]/);
});

test("pendência de auditoria filtra Despesas sem abrir uma página dedicada", () => {
  const expensesPage = read("src/features/financial/pages/expenses-page.tsx");
  const kpis = read("src/features/financial/components/expenses/kpi-flow-strip.tsx");
  const legacyRoute = read("src/app/dashboard/financial/expenses/pending-audit/page.tsx");
  assert.match(expensesPage, /onAuditClick=\{\(\) => setStatusFilter\("pending_audit"\)\}/);
  assert.match(expensesPage, /auditActive=\{statusFilter === "pending_audit"\}/);
  assert.match(expensesPage, /periodLabel=\{activePeriodLabel\}/);
  assert.match(expensesPage, /const shouldGroupByDueWeek = Boolean\(dateFrom \|\| dateTo \|\| activeCompetenceLabel\)/);
  assert.doesNotMatch(kpis, /auditHref|next\/link/);
  assert.match(kpis, /onClick=\{onAuditClick\}/);
  assert.match(legacyRoute, /redirect\(`\$\{FINANCIAL_ROUTES\.expenses\}\?status=pending_audit`\)/);
});

test("Despesas oferece limpeza completa dos filtros e retorna ao mês atual", () => {
  const expensesPageSource = read("src/features/financial/pages/expenses-page.tsx");
  assert.match(expensesPageSource, /function clearExpenseFilters\(\)/);
  assert.match(expensesPageSource, /setStatusFilter\("all"\)/);
  assert.match(expensesPageSource, /setDateFrom\(format\(startOfMonth\(now\), "yyyy-MM-dd"\)\)/);
  assert.match(expensesPageSource, /setDateTo\(format\(endOfMonth\(now\), "yyyy-MM-dd"\)\)/);
  assert.match(expensesPageSource, /setCompetenceMonth\("all"\)/);
  assert.match(expensesPageSource, /setUnitFilter\("all"\)/);
  assert.match(expensesPageSource, />\s*Limpar filtros\s*</);
});

test("linhas semanais de Despesas usam colunas fixas para manter o alinhamento", () => {
  const expensesPageSource = read("src/features/financial/pages/expenses-page.tsx");
  assert.match(expensesPageSource, /grid-cols-\[16px_16px_210px_160px_120px_minmax\(160px,1fr\)\]/);
  assert.match(expensesPageSource, /min-w-\[760px\]/);
});

test("conciliação segue o contrato visual documentado", () => {
  const importer = read("src/features/financial/pages/import-page.tsx");
  const cards = read("src/features/financial/pages/card-statements-page.tsx");
  const bankStatements = read("src/features/financial/pages/bank-statements-page.tsx");
  const pageHeader = read("src/components/layout/page-header.tsx");
  const pageContainer = read("src/components/layout/page-container.tsx");
  const deposits = read("src/features/financial/cash-deposits/cash-deposits-page.tsx");
  const cashControlNavigation = read("src/features/financial/cash-closures/components/cash-control-navigation.tsx");
  const guide = read("docs/engineering/ui-design-system.md");
  const navigator = read("src/features/financial/components/financial-competence-navigator.tsx");

  assert.match(importer, /<FinancialCompetenceNavigator/);
  assert.match(cards, /<FinancialCompetenceNavigator/);
  assert.match(cards, /data-ui="financial-card-selector"/);
  assert.match(cards, /<PageContainer variant="wide"/);
  assert.doesNotMatch(cards, /max-w-\[1360px\]/);
  assert.match(cards, /back=\{\{ fallbackHref: safeReturnHref, parentLabel: backParentLabel \}\}/);
  assert.doesNotMatch(cards, /Voltar ao extrato/);
  assert.match(importer, /data-ui="statement-overview-grid"/);
  assert.match(importer, /onClick=\{\(\) => setImportDialogOpen\(true\)\}/);
  assert.match(importer, /Informe o formato do arquivo e a conta bancária/);
  assert.match(bankStatements, /parentLabel: "Despesas"/);
  assert.match(bankStatements, /showImportControls=\{false\}/);
  assert.match(pageHeader, /data-ui="page-breadcrumb"/);
  assert.match(pageHeader, /<BackButton/);
  assert.match(pageHeader, /titleSize === 'compact'/);
  assert.match(pageContainer, /financial-page-surface/);
  assert.doesNotMatch(cashControlNavigation, /Depósitos|Coala · Financeiro/);
  assert.match(importer, /data-ui="statement-card-close"/);
  assert.match(importer, /data-ui="statement-card-selector"/);
  assert.match(importer, /Selecione o cartão/);
  assert.doesNotMatch(importer, /statementCloseChecklist/);
  assert.match(navigator, /\bAnterior\b/);
  assert.match(navigator, /Próxima/);
  assert.match(guide, /Importar → Auditar → Fechar/);
  assert.match(guide, /Importar → Conciliar → Fechar → Pagamento/);
  assert.match(cards, /label: "Conciliar"/);
  assert.match(cards, /label: "Pagamento"/);
  assert.doesNotMatch(cards, /label: "Auditar"/);
  assert.doesNotMatch(cards, /label: "Conferir"/);
  assert.match(guide, /\*\*Pendente\*\*/);
  assert.match(guide, /\*\*Conciliada\*\*/);
  assert.match(guide, /Use a opção `back` de `PageHeader`/);
  assert.match(guide, /texto-base em `14px`/);
  assert.match(guide, /Itens permanentes do módulo ficam na sidebar/);
  assert.match(deposits, /<PageContainer variant="wide" surface/);
  assert.match(deposits, /<PageHeader[\s\S]*titleSize="compact"/);
  assert.doesNotMatch(deposits, /Financeiro <span[^>]*>›<\/span> Depósitos em dinheiro/);
  assert.match(deposits, /bg-zinc-900/);
});
