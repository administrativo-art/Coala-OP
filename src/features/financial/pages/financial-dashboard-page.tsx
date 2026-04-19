"use client";

import Link from "next/link";
import { ArrowRight, BarChart3, CircleDollarSign, Landmark, Settings, Wallet } from "lucide-react";
import { useFinancialDashboardIndicators } from "@/features/financial/hooks/use-dashboard-indicators";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import { financialCollection } from "@/features/financial/lib/repositories";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function KpiCard({
  label,
  value,
  description,
  icon: Icon,
}: {
  label: string;
  value: string;
  description: string;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function ShortcutCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Card className="transition-colors hover:border-primary/40">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" size="sm">
          <Link href={href}>
            Abrir
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function FinancialDashboardPage() {
  const { user, permissions } = useAuth();
  const { indicators, loading } = useFinancialDashboardIndicators();
  const { data: expenses } = useFinancialCollection<any>(financialCollection("expenses"));

  if (!permissions.financial?.dashboard) {
    return (
      <FinancialAccessGuard
        title="Painel financeiro"
        description="Seu perfil não possui permissão para visualizar o painel consolidado do financeiro."
      />
    );
  }

  const pendingExpenses = (expenses || [])
    .filter((expense) => expense.status === "pending")
    .sort((a, b) => (toDate(a.dueDate)?.getTime() || 0) - (toDate(b.dueDate)?.getTime() || 0))
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Painel financeiro</h1>
        <p className="text-muted-foreground">
          Visão consolidada do módulo financeiro para {user?.username ?? "o usuário atual"}.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-32 w-full" />)
        ) : (
          <>
            <KpiCard
              label="Despesas em aberto"
              value={formatCurrency(indicators.openExpenses)}
              description="Compromissos ainda pendentes de liquidação."
              icon={CircleDollarSign}
            />
            <KpiCard
              label="Vencimentos em 30 dias"
              value={formatCurrency(indicators.upcomingDue)}
              description="Monitoramento do curto prazo."
              icon={BarChart3}
            />
            <KpiCard
              label="Caixa consolidado"
              value={formatCurrency(indicators.cash)}
              description="Entradas menos pagamentos e ajustes de saída."
              icon={Wallet}
            />
            <KpiCard
              label="Resultado DRE"
              value={formatCurrency(indicators.dre)}
              description="Receitas realizadas menos despesas pagas."
              icon={Landmark}
            />
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-5">
        {permissions.financial?.expenses?.view && (
          <ShortcutCard
            href={FINANCIAL_ROUTES.expenses}
            title="Despesas"
            description="Lançamento, edição, contas a pagar e importação de extratos."
          />
        )}
        {permissions.financial?.cashFlow?.view && (
          <ShortcutCard
            href={FINANCIAL_ROUTES.cashFlow}
            title="Fluxo de caixa"
            description="Receitas, transferências, ajustes e saldo por conta."
          />
        )}
        {permissions.financial?.financialFlow && (
          <ShortcutCard
            href={FINANCIAL_ROUTES.financialFlow}
            title="Fluxo financeiro"
            description="Análise do provisionado versus liquidado ao longo do período."
          />
        )}
        {permissions.financial?.dre && (
          <ShortcutCard
            href={FINANCIAL_ROUTES.dre}
            title="DRE"
            description="Resultado do período com comparativos por competência."
          />
        )}
        {permissions.financial?.settings?.view && (
          <ShortcutCard
            href={FINANCIAL_ROUTES.settings}
            title="Configurações"
            description="Cadastros financeiros, contas bancárias e aliases de importação."
          />
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Próximas despesas pendentes</CardTitle>
          <CardDescription>Itens com vencimento mais próximo no banco dedicado do financeiro.</CardDescription>
        </CardHeader>
        <CardContent>
          {pendingExpenses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma despesa pendente encontrada.</p>
          ) : (
            <div className="space-y-3">
              {pendingExpenses.map((expense) => (
                <div key={expense.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="font-medium">{expense.description}</p>
                    <p className="text-xs text-muted-foreground">
                      Vencimento: {toDate(expense.dueDate) ? new Intl.DateTimeFormat("pt-BR").format(toDate(expense.dueDate)!) : "—"}
                    </p>
                  </div>
                  <span className="font-mono text-sm font-semibold">{formatCurrency(expense.totalValue || 0)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
