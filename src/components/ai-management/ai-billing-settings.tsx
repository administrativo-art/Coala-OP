"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Coins,
  ExternalLink,
  Loader2,
  RefreshCw,
  ServerCog,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/use-auth";
import type { AiBillingOverview, AppCostBreakdown, AppCostOverview } from "@/features/ai-management/types";
import { cn } from "@/lib/utils";

type AiBillingSettingsProps = {
  view: "credits" | "costs";
};

function formatUsd(value: number | null) {
  return formatCurrency(value, "USD");
}

function formatCurrency(value: number | null, currency: string) {
  if (value === null) return "Não disponível";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { notation: value >= 1_000_000 ? "compact" : "standard" }).format(value);
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(
    new Date(year, month - 1, day),
  );
}

function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  highlight = false,
}: {
  title: string;
  value: string;
  description: string;
  icon: typeof Coins;
  highlight?: boolean;
}) {
  return (
    <Card className={cn("overflow-hidden", highlight && "border-[#e5a9bd] bg-[#fff8fa]")}>
      <CardContent className="p-5 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
            <p className="mt-2 truncate text-2xl font-bold tracking-tight text-foreground">{value}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          </div>
          <div className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground",
            highlight && "bg-[#f7dbe5] text-[#9d365b]",
          )}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OpenAiSetupNotice({ configured }: { configured: boolean }) {
  return (
    <Card className="border-amber-200 bg-amber-50/80">
      <CardContent className="flex gap-3 p-5 sm:p-5">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div className="space-y-1 text-sm text-amber-950">
          <p className="font-semibold">
            {configured ? "A OpenAI não respondeu à consulta de billing" : "Conecte o billing da OpenAI"}
          </p>
          <p className="leading-relaxed text-amber-900/80">
            {configured
              ? "Confira se a chave administrativa possui acesso à organização e tente atualizar novamente."
              : "Configure OPENAI_ADMIN_KEY somente no servidor. Para calcular o disponível, defina também um limite no projeto OpenAI ou OPENAI_MONTHLY_CREDIT_BUDGET_USD."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function GoogleCloudSetupNotice({ overview }: { overview: AppCostOverview }) {
  return (
    <Card className="border-amber-200 bg-amber-50/80">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div className="space-y-1 text-sm text-amber-950">
            <p className="font-semibold">
              {overview.setup.billingExportFound
                ? "O export de billing não pôde ser consultado"
                : "Ative o export do Cloud Billing para BigQuery"}
            </p>
            <p className="leading-relaxed text-amber-900/80">
              {overview.setup.billingExportFound
                ? "A tabela foi localizada, mas a credencial do APP precisa conseguir executar e ler a consulta no BigQuery."
                : "O Google/Firebase não oferece o custo consolidado do projeto em uma API direta. O export de billing é a fonte oficial para preencher este painel."}
            </p>
          </div>
        </div>
        <div className="grid gap-3 text-xs text-amber-950/80 sm:grid-cols-3">
          <div className="rounded-lg border border-amber-200 bg-white/50 p-3"><span className="font-bold text-amber-950">1.</span> Habilite somente o export padrão de custos.</div>
          <div className="rounded-lg border border-amber-200 bg-white/50 p-3"><span className="font-bold text-amber-950">2.</span> Informe a tabela em <code>GOOGLE_CLOUD_BILLING_EXPORT_TABLE</code>.</div>
          <div className="rounded-lg border border-amber-200 bg-white/50 p-3"><span className="font-bold text-amber-950">3.</span> Conceda acesso de leitura e execução no BigQuery.</div>
        </div>
        <Button asChild variant="outline" size="sm" className="border-amber-300 bg-white text-amber-950 hover:bg-amber-100">
          <a href={overview.setup.consoleUrl} target="_blank" rel="noreferrer">
            Abrir exportação do Cloud Billing
            <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

function CreditsView({ overview }: { overview: AiBillingOverview }) {
  const usedPercent = overview.credits.usedPercent ?? 0;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Disponível no mês"
          value={formatUsd(overview.credits.availableUsd)}
          description="Limite mensal menos o custo acumulado."
          icon={Coins}
          highlight
        />
        <MetricCard
          title="Limite mensal"
          value={formatUsd(overview.credits.limitUsd)}
          description={overview.credits.source === "project_spend_limit" ? "Limite do projeto OpenAI." : "Orçamento mensal configurado no APP."}
          icon={CircleDollarSign}
        />
        <MetricCard
          title="Consumido no mês"
          value={formatUsd(overview.credits.spentUsd)}
          description={overview.credits.usedPercent === null ? "Custo oficial acumulado." : `${overview.credits.usedPercent.toLocaleString("pt-BR")}% do limite mensal.`}
          icon={BarChart3}
        />
        <MetricCard
          title="Requisições GPT"
          value={formatNumber(overview.usage.requests)}
          description={`${formatNumber(overview.usage.inputTokens + overview.usage.outputTokens)} tokens no mês.`}
          icon={Sparkles}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Uso do limite mensal</CardTitle>
              <CardDescription className="mt-1">Acompanhamento do orçamento usado pelo copiloto e demais chamadas GPT.</CardDescription>
            </div>
            <Badge variant="secondary">{overview.credits.usedPercent === null ? "Sem limite" : `${usedPercent.toLocaleString("pt-BR")}% usado`}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress
            value={usedPercent}
            className="h-3 bg-[#f1e8e3]"
            indicatorClassName={usedPercent >= 90 ? "bg-red-500" : usedPercent >= 70 ? "bg-amber-500" : "bg-[#a6325b]"}
          />
          <div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>{overview.credits.note}</span>
            <a
              href="https://platform.openai.com/settings/organization/billing/overview"
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-[#993556] hover:underline"
            >
              Ver saldo pré-pago oficial
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uso por modelo</CardTitle>
          <CardDescription>Requisições e tokens processados no mês atual.</CardDescription>
        </CardHeader>
        <CardContent>
          {overview.usage.byModel.length ? (
            <div className="divide-y rounded-xl border">
              {overview.usage.byModel.map((entry) => (
                <div key={entry.model} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6">
                  <p className="truncate text-sm font-semibold">{entry.model}</p>
                  <p className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">{formatNumber(entry.requests)}</span> requisições</p>
                  <p className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">{formatNumber(entry.inputTokens + entry.outputTokens)}</span> tokens</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum uso por modelo foi retornado.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AppCostBreakdownList({
  title,
  description,
  values,
  currency,
}: {
  title: string;
  description: string;
  values: AppCostBreakdown[];
  currency: string;
}) {
  const maximum = Math.max(...values.map((entry) => Math.abs(entry.cost)), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {values.length ? (
          <div className="space-y-4">
            {values.slice(0, 10).map((entry) => (
              <div key={entry.key} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate font-medium text-foreground">{entry.label}</span>
                  <span className="shrink-0 font-semibold">{formatCurrency(entry.cost, currency)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-[#a6325b]"
                    style={{ width: maximum ? `${Math.max(2, (Math.abs(entry.cost) / maximum) * 100)}%` : "0%" }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Sem custos para detalhar.</p>
        )}
      </CardContent>
    </Card>
  );
}

function AppCostsView({ overview }: { overview: AppCostOverview }) {
  const last30Daily = useMemo(() => overview.costs.daily.slice(-30), [overview.costs.daily]);
  const maximum = Math.max(...last30Daily.map((entry) => Math.abs(entry.cost)), 0);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Custo líquido no mês" value={formatCurrency(overview.costs.currentMonth, overview.currency)} description={`Bruto de ${formatCurrency(overview.costs.grossCurrentMonth, overview.currency)}, após créditos.`} icon={CircleDollarSign} highlight />
        <MetricCard title="Mês anterior" value={formatCurrency(overview.costs.previousMonth, overview.currency)} description="Custo líquido consolidado do mês anterior." icon={BarChart3} />
        <MetricCard title="Últimos 30 dias" value={formatCurrency(overview.costs.last30Days, overview.currency)} description="Janela móvel até a última exportação." icon={ServerCog} />
        <MetricCard title="Créditos e descontos" value={formatCurrency(Math.abs(overview.costs.creditsCurrentMonth || 0), overview.currency)} description="Créditos abatidos do custo bruto neste mês." icon={Coins} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Custo diário</CardTitle>
              <CardDescription className="mt-1">Custo líquido diário do projeto Firebase no Google Cloud.</CardDescription>
            </div>
            <Badge variant="outline">{overview.currency}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {last30Daily.length ? (
            <div className="flex h-52 items-end gap-1 overflow-hidden rounded-xl border bg-muted/20 px-3 pb-8 pt-4">
              {last30Daily.map((entry, index) => (
                <div key={entry.date} className="group relative flex h-full min-w-0 flex-1 items-end" title={`${formatDate(entry.date)}: ${formatCurrency(entry.cost, overview.currency)}`}>
                  <div
                    className="w-full min-w-[3px] rounded-t bg-[#c66a89] transition-colors group-hover:bg-[#9d365b]"
                    style={{ height: maximum ? `${Math.max(2, (Math.abs(entry.cost) / maximum) * 100)}%` : "2%" }}
                  />
                  {(index === 0 || index === last30Daily.length - 1 || index % 7 === 0) ? (
                    <span className="absolute left-1/2 top-[calc(100%+0.35rem)] -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground">
                      {formatDate(entry.date)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum custo diário foi retornado.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <AppCostBreakdownList title="Por serviço" description="Firestore, App Hosting, Cloud Run, Storage e demais serviços vinculados." values={overview.costs.byService} currency={overview.currency} />
        <AppCostBreakdownList title="Por SKU" description="Itens específicos que formam o custo de cada serviço Google Cloud." values={overview.costs.bySku} currency={overview.currency} />
      </div>
    </div>
  );
}

export function AiBillingSettings({ view }: AiBillingSettingsProps) {
  const { firebaseUser } = useAuth();
  const [overview, setOverview] = useState<AiBillingOverview | AppCostOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/settings/ai-management?view=${view}`, {
        headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` },
        cache: "no-store",
      });
      const payload = await response.json() as (AiBillingOverview | AppCostOverview) & { error?: string };
      if (!response.ok) throw new Error(payload.error || `Não foi possível consultar o billing ${view === "credits" ? "da OpenAI" : "do Google Cloud"}.`);
      setOverview(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível consultar os custos.");
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, view]);

  useEffect(() => {
    if (firebaseUser) void load();
  }, [firebaseUser, load]);

  if (loading) {
    return (
      <div className="flex h-56 items-center justify-center rounded-2xl border bg-card">
        <Loader2 className="h-6 w-6 animate-spin text-[#a6325b]" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="flex flex-col items-start gap-4 p-5 sm:p-6">
          <div className="flex gap-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div><p className="font-semibold">Falha ao carregar o billing</p><p className="mt-1">{error}</p></div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Tentar novamente</Button>
        </CardContent>
      </Card>
    );
  }

  if (!overview) return null;

  const isAppCost = overview.provider === "google_cloud_billing";
  const scopeLabel = isAppCost
    ? `Projeto: ${overview.projectId}`
    : `Escopo: ${overview.scope.type === "project" ? "projeto OpenAI" : "organização OpenAI"}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {overview.connected ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
          <span>{overview.connected ? `${isAppCost ? "Google Cloud/Firebase" : "OpenAI"} conectado` : `${isAppCost ? "Google Cloud/Firebase" : "OpenAI"} não conectado`}</span>
          <span>• {scopeLabel}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />Atualizar
        </Button>
      </div>

      {!overview.connected
        ? isAppCost
          ? <GoogleCloudSetupNotice overview={overview} />
          : <OpenAiSetupNotice configured={overview.configured} />
        : isAppCost
          ? <AppCostsView overview={overview} />
          : <CreditsView overview={overview} />}

      {overview.warnings.filter(() => overview.connected || overview.configured).map((warning) => (
        <div key={warning} className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{warning}</span>
        </div>
      ))}
    </div>
  );
}
