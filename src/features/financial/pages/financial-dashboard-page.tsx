"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar } from "lucide-react";
import { useFinancialDashboardIndicators } from "@/features/financial/hooks/use-dashboard-indicators";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { formatCurrency } from "@/features/financial/lib/utils";
import { financialCollection } from "@/features/financial/lib/repositories";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { ManagementDashboardBuilder } from "@/features/management-dashboard/builder-context";
import { MANAGEMENT_WIDGET_BY_ID } from "@/features/management-dashboard/catalog";
import { buildFinancialDashboard } from "@/features/management-dashboard/financial/data";
import {
  BankAccountsWidget,
  CashMonthWidget,
  CompetenceWidget,
  ExpenseListWidget,
  ForecastWidget,
  RankingWidget,
  SummaryWidget,
} from "@/features/management-dashboard/financial/widgets";
import { HubWidget, type HubAttention, type HubLink } from "@/features/management-dashboard/widgets/hub-widget";
import { widgetIcons } from "@/features/management-dashboard/widgets/icons";
import type { ManagementWidgetId } from "@/features/management-dashboard/types";
import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { PageContainer } from "@/components/layout/page-container";
import { PageHero } from "@/components/patterns/page-hero";
import { HeroChip } from "@/components/patterns/hero-chip";

const link = (label: string, description: string, href: string, icon: HubLink["icon"], tone: HubLink["tone"], badge?: number | null): HubLink => ({ label, description, href, icon, tone, badge });

export function FinancialDashboardPage() {
  const { user, firebaseUser, permissions } = useAuth();
  const { kiosks } = useKiosks();
  const expenseCollection = useFinancialCollection<any>(financialCollection("expenses"));
  const { indicators, loading: indicatorsLoading } = useFinancialDashboardIndicators(expenseCollection);
  const { data: transactions, loading: transactionsLoading } = useFinancialCollection<any>(financialCollection("transactions"));
  const { data: bankAccounts } = useFinancialCollection<any>(financialCollection("bankAccounts"));
  const { data: accountPlans } = useFinancialCollection<any>(financialCollection("accounts"));
  const loading = expenseCollection.loading || transactionsLoading;
  const unitNames = useMemo(() => kiosks.map((kiosk) => kiosk.name), [kiosks]);

  const data = useMemo(
    () => buildFinancialDashboard({
      expenses: expenseCollection.data || [],
      transactions: transactions || [],
      bankAccounts: bankAccounts || [],
      accountPlans: accountPlans || [],
      unitNames,
    }),
    [accountPlans, bankAccounts, expenseCollection.data, transactions, unitNames],
  );

  if (!permissions.financial?.dashboard) {
    return (
      <PageContainer variant="wide" surface>
        <FinancialAccessGuard
          title="Painel financeiro"
          description="Seu perfil não possui permissão para visualizar o painel consolidado do financeiro."
        />
      </PageContainer>
    );
  }

  const money = formatCurrency;
  const show = (id: ManagementWidgetId) => MANAGEMENT_WIDGET_BY_ID.get(id)?.canView(permissions) ?? false;
  const fin = permissions.financial;
  const only = (allowed: boolean | undefined, item: HubLink): HubLink[] => (allowed ? [item] : []);

  const payablesAttention: HubAttention[] = [
    ...(data.overdue.count > 0 ? [{ title: `${data.overdue.count} despesa(s) vencida(s)`, text: money(data.overdue.total), href: `${FINANCIAL_ROUTES.expenses}?status=overdue`, tone: "danger" as const, icon: widgetIcons.alerts }] : []),
    ...(data.pendingAudit.count > 0 ? [{ title: `${data.pendingAudit.count} aguardando auditoria`, text: money(data.pendingAudit.total), href: "/dashboard/financial/expenses/pending-audit", tone: "warn" as const, icon: widgetIcons.limits }] : []),
    ...(data.dueWeek.count > 0 ? [{ title: `${data.dueWeek.count} vencem em 7 dias`, text: money(data.dueWeek.total), href: FINANCIAL_ROUTES.expenses, tone: "info" as const, icon: widgetIcons.workday }] : []),
  ];

  return (
    <PageContainer variant="wide" surface className="space-y-4 pb-10 font-ds">
      <PageHero
        kicker="Financeiro"
        title="Painel financeiro"
        subtitle={`Olá, ${user?.username ?? "bem-vindo"}. Contas a pagar, caixa e resultado em um só lugar.`}
        actions={<span className="hidden items-center gap-2 rounded-ds-btn border border-white/[.14] px-3 py-2 text-xs font-bold text-ds-on-dark-2 sm:inline-flex"><Calendar className="h-4 w-4" />{format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}</span>}
        chips={<>
          <HeroChip value={data.overdue.count} label="Vencidas" tone="danger" />
          <HeroChip value={data.dueWeek.count} label="Vencem em 7 dias" tone="warning" />
          <HeroChip value={data.pendingAudit.count} label="Para auditar" tone="info" />
          <HeroChip value={money(indicators.openExpenses)} label="Em aberto" />
        </>}
      />

      <ManagementDashboardBuilder firebaseUser={firebaseUser} userId={firebaseUser?.uid ?? user?.id ?? ""} userName={user?.username ?? "Usuário"} permissions={permissions} scope="financial">
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-6 xl:grid-cols-12">
          {show("fin-summary") && <SummaryWidget indicators={indicators} loading={indicatorsLoading} money={money} />}
          {show("fin-overdue") && <ExpenseListWidget widgetId="fin-overdue" title="Vencidos" subtitle="Pendentes com vencimento passado" icon={widgetIcons.alerts} tone="danger" href={`${FINANCIAL_ROUTES.expenses}?status=overdue`} group={data.overdue} loading={loading} empty="Nenhuma despesa vencida." totalLabel="Total vencido" money={money} />}
          {show("fin-due-week") && <ExpenseListWidget widgetId="fin-due-week" title="A vencer em 7 dias" subtitle="Compromissos da semana" icon={widgetIcons.workday} tone="warn" href={FINANCIAL_ROUTES.expenses} group={data.dueWeek} loading={loading} empty="Nada vence nos próximos 7 dias." totalLabel="A pagar na semana" money={money} />}
          {show("fin-pending-audit") && <ExpenseListWidget widgetId="fin-pending-audit" title="Pendentes de auditoria" subtitle="Compras aguardando o financeiro" icon={widgetIcons.purchasing} tone="info" href="/dashboard/financial/expenses/pending-audit" group={data.pendingAudit} loading={loading} empty="Nenhuma despesa aguardando auditoria." totalLabel="Em auditoria" money={money} />}
          {show("fin-competence") && <CompetenceWidget data={data} loading={loading} money={money} />}
          {show("fin-cash-month") && <CashMonthWidget data={data} loading={loading} money={money} />}
          {show("fin-forecast") && <ForecastWidget buckets={data.forecast} loading={loading} money={money} />}
          {show("fin-top-categories") && <RankingWidget widgetId="fin-top-categories" title="Maiores categorias" subtitle={`Plano de contas · ${data.monthLabel}`} icon={widgetIcons.accounts} tone="accent" href={FINANCIAL_ROUTES.dre} rows={data.topCategories} loading={loading} empty="Sem despesas na competência." money={money} />}
          {show("fin-top-suppliers") && <RankingWidget widgetId="fin-top-suppliers" title="Maiores fornecedores" subtitle={`Competência · ${data.monthLabel}`} icon={widgetIcons.purchasing} tone="info" href={FINANCIAL_ROUTES.expenses} rows={data.topSuppliers} loading={loading} empty="Sem despesas na competência." money={money} />}
          {show("fin-units") && <RankingWidget widgetId="fin-units" title="Despesas por unidade" subtitle={`Rateio · ${data.monthLabel}`} icon={widgetIcons.places} tone="warn" href={FINANCIAL_ROUTES.dre} rows={data.units} loading={loading} empty="Sem despesas rateadas na competência." money={money} />}
          {show("fin-bank-accounts") && <BankAccountsWidget accounts={data.bankAccounts} loading={loading} money={money} />}

          {show("fin-payables-hub") && <HubWidget widgetId="fin-payables-hub" title="Central de pagamentos" compactTitle="Pagamentos" subtitle="Despesas, autorizações e cobranças" href={FINANCIAL_ROUTES.expenses} icon={widgetIcons.expenses} tone="danger"
            status={data.overdue.count > 0 ? { tone: "danger", label: `${data.overdue.count} vencida(s)` } : { tone: "ok", label: "Em dia" }}
            kpis={[{ label: "Vencidos", value: money(data.overdue.total), tone: data.overdue.count > 0 ? "danger" : "muted", icon: widgetIcons.alerts }, { label: "Na semana", value: money(data.dueWeek.total), tone: "warn", icon: widgetIcons.workday }, { label: "Em auditoria", value: money(data.pendingAudit.total), tone: "info", icon: widgetIcons.purchasing }, { label: "Em aberto", value: money(indicators.openExpenses), icon: widgetIcons.wallet }]}
            attention={payablesAttention}
            links={[
              ...only(fin?.expenses?.view, link("Despesas", "Lançar e acompanhar", FINANCIAL_ROUTES.expenses, widgetIcons.expenses, "danger", data.overdue.count)),
              ...only(fin?.expenses?.create, link("Novo lançamento", "Registrar despesa", FINANCIAL_ROUTES.newExpense, widgetIcons.income, "accent")),
              ...only(fin?.paymentRequests?.view, link("Autorizações", "Pagamentos no banco", FINANCIAL_ROUTES.paymentRequests, widgetIcons.payments, "warn")),
              ...only(fin?.inbox?.view, link("Caixa de cobranças", "Cobranças por e-mail", FINANCIAL_ROUTES.inbox, widgetIcons.requests, "info")),
              ...only(fin?.beneficiaries?.view, link("Beneficiários", "Favorecidos e dados de pagamento", "/dashboard/financial/beneficiaries", widgetIcons.collaborators, "ok")),
              ...only(fin?.view, link("Patrimônio", "Bens e equipamentos", "/dashboard/financial/assets", widgetIcons.inventory, "muted")),
            ]} />}
          {show("fin-reconciliation-hub") && <HubWidget widgetId="fin-reconciliation-hub" title="Central de conciliação" compactTitle="Conciliação" subtitle="Extratos, cartões, vendas e recebimentos" href={FINANCIAL_ROUTES.salesReconciliation} icon={widgetIcons.reconciliation} tone="warn"
            status={null}
            links={[
              ...only(fin?.audits?.view, link("Extratos bancários", "Auditoria do extrato", FINANCIAL_ROUTES.bankStatements, widgetIcons.statements, "info")),
              ...only(fin?.cardStatements?.view, link("Faturas de cartão", "Conciliar cobranças", FINANCIAL_ROUTES.cardStatements, widgetIcons.payments, "accent")),
              ...only(fin?.reconciliation?.view, link("Vendas × Stone", "PDV e adquirente", FINANCIAL_ROUTES.salesReconciliation, widgetIcons.reconciliation, "warn")),
              ...only(fin?.reconciliation?.view, link("Recebimentos", "Taxas e crédito bancário", FINANCIAL_ROUTES.stoneReceipts, widgetIcons.income, "ok")),
              ...only(fin?.reconciliation?.view, link("Recebíveis", "Carteira e previsões", "/dashboard/financial/cash-flow/receivables", widgetIcons.wallet, "info")),
              ...only(fin?.reconciliation?.view, link("Antecipações", "Pagamentos antecipados", FINANCIAL_ROUTES.stoneAnticipations, widgetIcons.limits, "danger")),
            ]} />}
          {show("fin-cash-control-hub") && <HubWidget widgetId="fin-cash-control-hub" title="Controle de caixa" compactTitle="Caixa físico" subtitle="Fechamento, contagem e depósitos" href="/dashboard/financial/cash-closures" icon={widgetIcons.cash} tone="ok"
            status={null}
            links={[
              ...only(fin?.cashClosures?.view, link("Fechamento do caixa", "Conferência diária", "/dashboard/financial/cash-closures", widgetIcons.wallet, "ok")),
              ...only(fin?.cashClosures?.view, link("Sessões de contagem", "Malotes e operadores", "/dashboard/financial/cash-closures", widgetIcons.counting, "accent")),
              ...only(fin?.cashDeposits?.view, link("Depósitos", "Contagem e envio ao banco", "/dashboard/financial/cash-deposits", widgetIcons.financeHub, "info")),
            ]} />}
          {show("fin-planning-hub") && <HubWidget widgetId="fin-planning-hub" title="Planejamento e resultado" compactTitle="Resultado" subtitle="DRE, orçamento e fluxo de caixa" href={FINANCIAL_ROUTES.dre} icon={widgetIcons.budgets} tone="info"
            status={null}
            links={[
              ...only(fin?.dre, link("DRE", "Resultado por centro", FINANCIAL_ROUTES.dre, widgetIcons.income, "info")),
              ...only(fin?.cashFlow?.view, link("Fluxo de caixa", "Entradas, saídas e saldo", FINANCIAL_ROUTES.cashFlow, widgetIcons.cash, "ok")),
              ...only(fin?.view, link("Orçamento × despesas", "Planejado e realizado", FINANCIAL_ROUTES.budgetComparison, widgetIcons.budgets, "warn")),
              ...only(fin?.settings?.view, link("Configurações", "Contas, centros e orçamentos", FINANCIAL_ROUTES.settings, widgetIcons.accounts, "muted")),
            ]} />}
        </div>
      </ManagementDashboardBuilder>
    </PageContainer>
  );
}
