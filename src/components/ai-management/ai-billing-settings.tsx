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
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatusPill } from "@/components/ui/status-pill";
import { billingAlertPresentation, formatBillingBytes, formatBillingGeneratedAt } from "@/components/ai-management/billing-presentation";
import { useAuth } from "@/hooks/use-auth";
import type { AiBillingOverview, AppCostBreakdown, AppCostOverview, BillingAlert } from "@/features/ai-management/types";
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

function BillingAlertNotice({ alert, provider }: { alert: BillingAlert; provider: "openai" | "google" }) {
  const presentation = billingAlertPresentation(alert, provider);
  const isCritical = alert.level === "critical";
  const isWarning = alert.level === "warning";
  const Icon = alert.level === "none" ? CheckCircle2 : AlertTriangle;
  return (
    <div
      role={isCritical || isWarning ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-ds-card border p-4 text-sm",
        isCritical ? "border-ds-danger bg-ds-danger-bg text-ds-danger" : isWarning ? "border-ds-alert-border bg-ds-alert-bg text-ds-alert-ink" : "border-ds-border bg-ds-surface-warm text-ds-ink",
      )}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-bold">{presentation.title}</p>
          <StatusPill variant={presentation.pillVariant}>{presentation.pill}</StatusPill>
        </div>
        <p className="text-xs leading-relaxed">{presentation.description}</p>
      </div>
    </div>
  );
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
    <Card className={cn("overflow-hidden", highlight && "border-ds-accent bg-ds-accent-soft")}>
      <CardContent className="p-5 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
            <p className="mt-2 truncate text-2xl font-bold tracking-tight text-foreground">{value}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          </div>
          <div className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground",
            highlight && "bg-ds-accent-soft text-ds-accent-ink",
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
              : "Configure OPENAI_ADMIN_KEY somente no servidor. Para ativar os alertas, defina também uma régua no projeto OpenAI ou OPENAI_MONTHLY_CREDIT_BUDGET_USD."}
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
                : "Aguardando a tabela do Cloud Billing"}
            </p>
            <p className="leading-relaxed text-amber-900/80">
              {overview.setup.billingExportFound
                ? "A tabela foi localizada, mas a credencial do APP precisa conseguir executar e ler a consulta no BigQuery."
                : "Se o export acabou de ser ativado, o Google pode levar algumas horas para criar e preencher a primeira tabela. O painel fará a detecção automaticamente."}
            </p>
          </div>
        </div>
        <div className="grid gap-3 text-xs text-amber-950/80 sm:grid-cols-3">
          <div className="rounded-lg border border-amber-200 bg-white/50 p-3"><span className="font-bold text-amber-950">1.</span> Confirme que o export padrão está ativo.</div>
          <div className="rounded-lg border border-amber-200 bg-white/50 p-3"><span className="font-bold text-amber-950">2.</span> Aguarde a tabela <code>gcp_billing_export_v1_*</code>.</div>
          <div className="rounded-lg border border-amber-200 bg-white/50 p-3"><span className="font-bold text-amber-950">3.</span> O painel detectará a tabela automaticamente.</div>
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
  const prepaidObservedAt = overview.credits.prepaidBalanceObservedAt
    ? formatBillingGeneratedAt(overview.credits.prepaidBalanceObservedAt)
    : null;
  return (
    <div className="space-y-5">
      <BillingAlertNotice alert={overview.alert} provider="openai" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Saldo pré-pago"
          value={formatUsd(overview.credits.prepaidBalanceUsd)}
          description={prepaidObservedAt
            ? `Saldo conferido no Billing oficial em ${prepaidObservedAt} (Belém). Atualização manual.`
            : "Saldo não disponível pela API; consulte o Billing oficial."}
          icon={Coins}
          highlight
        />
        <MetricCard
          title="Régua mensal interna"
          value={formatUsd(overview.credits.limitUsd)}
          description={overview.credits.source === "project_spend_limit" ? "Limite oficial do projeto usado como régua de alerta." : overview.credits.source === "organization_spend_limit" ? "Limite oficial da organização usado como régua de alerta." : overview.credits.source === "configured_monthly_budget" ? "Referência de alerta configurada no APP; não altera a cobrança." : "Nenhuma régua mensal encontrada."}
          icon={CircleDollarSign}
        />
        <MetricCard
          title="Gasto oficial no mês"
          value={formatUsd(overview.credits.spentUsd)}
          description="Custo retornado pela API da OpenAI; não é calculado a partir da régua."
          icon={BarChart3}
        />
        <MetricCard
          title="Uso da régua"
          value={overview.credits.usedPercent === null ? "Sem régua" : `${overview.credits.usedPercent.toLocaleString("pt-BR")}%`}
          description="Gasto oficial dividido pela régua interna. Serve somente aos alertas de 80% e 95%."
          icon={BarChart3}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Acompanhamento da régua interna</CardTitle>
              <CardDescription className="mt-1">Referência de controle do APP; não representa saldo, crédito ou cobrança disponível.</CardDescription>
            </div>
            <Badge variant="secondary">{overview.credits.usedPercent === null ? "Sem régua" : `${usedPercent.toLocaleString("pt-BR")}% da régua`}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {overview.credits.usedPercent !== null ? (
            <Progress
              value={Math.min(usedPercent, 100)}
              className="h-3 bg-ds-surface-muted"
              indicatorClassName={overview.alert.level === "critical" ? "bg-ds-danger" : overview.alert.level === "warning" ? "bg-ds-warn" : "bg-ds-accent"}
            />
          ) : null}
          <div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>{overview.credits.note}</span>
            <a
              href="https://platform.openai.com/settings/organization/billing/overview"
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-ds-accent-ink hover:text-ds-accent-ink-hover hover:underline"
            >
              Ver saldo pré-pago oficial
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Custo por ID de chave</CardTitle>
            <CardDescription>Custo oficial no mês, agrupado pelo ID de chave retornado pela OpenAI. IDs não revelam o segredo.</CardDescription>
          </CardHeader>
          <CardContent>
            {overview.costs.byApiKey.length ? (
              <div className="divide-y divide-ds-divider rounded-ds-card border border-ds-border">
                {overview.costs.byApiKey.map((entry) => (
                  <div key={entry.key} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                    <span className="min-w-0 break-all font-ds-mono text-xs text-ds-ink" title={entry.label}>{entry.label}</span>
                    <span className="shrink-0 font-semibold text-ds-ink">{formatUsd(entry.costUsd)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum custo por chave foi retornado.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Uso por ID de chave</CardTitle>
            <CardDescription>Requisições e tokens no mês. A ausência de um ID não significa ausência de custo.</CardDescription>
          </CardHeader>
          <CardContent>
            {overview.usage.byApiKey.length ? (
              <div className="divide-y divide-ds-divider rounded-ds-card border border-ds-border">
                {overview.usage.byApiKey.map((entry) => (
                  <div key={entry.key} className="grid gap-2 p-4 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <span className="min-w-0 break-all font-ds-mono text-xs text-ds-ink" title={entry.label}>{entry.label}</span>
                    <span className="text-xs text-ds-ink-muted sm:text-right">
                      <span className="font-semibold text-ds-ink">{formatNumber(entry.requests)}</span> requisições · <span className="font-semibold text-ds-ink">{formatNumber(entry.inputTokens + entry.outputTokens)}</span> tokens
                    </span>
                  </div>
                ))}
              </div>
            ) : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum uso por chave foi retornado.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uso por modelo</CardTitle>
          <CardDescription>{formatNumber(overview.usage.requests)} requisições e {formatNumber(overview.usage.inputTokens + overview.usage.outputTokens)} tokens processados no mês atual.</CardDescription>
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
                    className="h-full rounded-full bg-ds-accent"
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

function GoogleQueryEstimate({ overview }: { overview: AppCostOverview }) {
  const estimate = overview.queryEstimate;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Estimativa das consultas deste painel</CardTitle>
        <CardDescription>Projeção de bytes consultados no BigQuery. A franquia de consultas é compartilhada pela conta.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <BillingAlertNotice alert={overview.alert} provider="google" />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-ds-md border border-ds-border bg-ds-surface-warm p-3">
            <p className="text-xs text-ds-ink-muted">Por consulta</p>
            <p className="mt-1 font-semibold text-ds-ink">{formatBillingBytes(estimate.bytesPerQuery)}</p>
          </div>
          <div className="rounded-ds-md border border-ds-border bg-ds-surface-warm p-3">
            <p className="text-xs text-ds-ink-muted">Projeção mensal do painel</p>
            <p className="mt-1 font-semibold text-ds-ink">{formatBillingBytes(estimate.monthlyPanelBytesAtHourlyRefresh)}</p>
          </div>
          <div className="rounded-ds-md border border-ds-border bg-ds-surface-warm p-3">
            <p className="text-xs text-ds-ink-muted">Franquia mensal de consultas</p>
            <p className="mt-1 font-semibold text-ds-ink">{formatBillingBytes(estimate.monthlyFreeBytes)}</p>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-ds-ink-muted">{estimate.note} Teto por consulta deste painel: {formatBillingBytes(estimate.maximumBytesBilled)}.</p>
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

      <GoogleQueryEstimate overview={overview} />

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
                    className="w-full min-w-[3px] rounded-t bg-ds-accent transition-colors group-hover:bg-ds-accent-hover"
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
        <Loader2 className="h-6 w-6 animate-spin text-ds-accent-ink" />
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
  const generatedAtLabel = formatBillingGeneratedAt(overview.generatedAt);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {overview.connected ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
          <span>{overview.connected ? `${isAppCost ? "Google Cloud/Firebase" : "OpenAI"} conectado` : `${isAppCost ? "Google Cloud/Firebase" : "OpenAI"} não conectado`}</span>
          <span className="hidden sm:inline" aria-hidden="true">•</span>
          <span className="basis-full break-all sm:basis-auto">{scopeLabel}</span>
        </div>
        <div className="text-xs leading-relaxed text-muted-foreground sm:text-right">
          {generatedAtLabel
            ? <time dateTime={overview.generatedAt}>Atualizado em {generatedAtLabel} (Belém)</time>
            : <span>Horário da atualização indisponível</span>}
          <span className="block">Cache de até 1 h</span>
        </div>
      </div>

      {!overview.connected
        ? isAppCost
          ? <><GoogleCloudSetupNotice overview={overview} /><GoogleQueryEstimate overview={overview} /></>
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
