"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ListSkeleton } from "@/components/cadastros/cadastros-ui";
import { StatTile } from "@/components/patterns/stat-tile";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useAuth } from "@/hooks/use-auth";
import { billingAlertPresentation, formatBillingBytes, formatBillingGeneratedAt } from "@/components/ai-management/billing-presentation";
import type { AiBillingOverview, AppCostBreakdown, AppCostOverview, BillingAlert } from "@/features/ai-management/types";
import { cn } from "@/lib/utils";
import type React from "react";

const monoValue = (value: string) => <span className="block truncate font-ds-mono text-[22px] leading-tight">{value}</span>;

function BillingAlertNotice({ alert, provider }: { alert: BillingAlert; provider: "openai" | "google" }) {
  const presentation = billingAlertPresentation(alert, provider);
  const tone = alert.level === "critical" ? "border-ds-danger bg-ds-danger-bg text-ds-danger" : alert.level === "warning" ? "border-ds-alert-border bg-ds-alert-bg text-ds-alert-ink" : "border-ds-border bg-ds-warm text-ds-ink";
  return (
    <div role={alert.level === "critical" || alert.level === "warning" ? "alert" : "status"} className={cn("rounded-ds-card border p-4 text-sm", tone)}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-extrabold">{presentation.title}</p>
        <StatusPill variant={presentation.pillVariant}>{presentation.pill}</StatusPill>
      </div>
      <p className="mt-1 text-xs leading-relaxed">{presentation.description}</p>
    </div>
  );
}

/** Cartão de seção: título, apoio e conteúdo, no padrão do guia. */
function Section({ title, description, aside, children }: { title: string; description?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-ds-card-lg border border-ds-border bg-ds-surface p-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold">{title}</h2>
          {description ? <p className="mt-0.5 text-[13px] text-ds-ink-muted">{description}</p> : null}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Alert({ tone, title, children }: { tone: "warn" | "danger"; title?: string; children: React.ReactNode }) {
  return (
    <div role="alert" className={`rounded-ds-card border px-5 py-4 text-[13px] ${tone === "danger" ? "border-ds-confirm-border bg-ds-confirm-bg text-ds-confirm-ink" : "border-ds-alert-border bg-ds-alert-bg text-ds-alert-ink"}`}>
      {title ? <p className="font-extrabold">{title}</p> : null}
      <div className={title ? "mt-1 leading-relaxed" : "leading-relaxed"}>{children}</div>
    </div>
  );
}

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

function OpenAiSetupNotice({ configured }: { configured: boolean }) {
  return (
    <Alert tone="warn" title={configured ? "A OpenAI não respondeu à consulta de billing" : "Conecte o billing da OpenAI"}>
      {configured
        ? "Confira se a chave administrativa possui acesso à organização e tente atualizar novamente."
        : "Configure OPENAI_ADMIN_KEY somente no servidor. Para ativar os alertas, defina também uma régua no projeto OpenAI ou OPENAI_MONTHLY_CREDIT_BUDGET_USD."}
    </Alert>
  );
}

function GoogleCloudSetupNotice({ overview }: { overview: AppCostOverview }) {
  return (
    <Alert
      tone="warn"
      title={overview.setup.billingExportFound ? "O export de billing não pôde ser consultado" : "Aguardando a tabela do Cloud Billing"}
    >
      <p>
        {overview.setup.billingExportFound
          ? "A tabela foi localizada, mas a credencial do APP precisa conseguir executar e ler a consulta no BigQuery."
          : "Se o export acabou de ser ativado, o Google pode levar algumas horas para criar e preencher a primeira tabela. O painel fará a detecção automaticamente."}
      </p>
      <ol className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
        <li className="rounded-ds-btn border border-ds-alert-border bg-white/60 p-3"><strong>1.</strong> Confirme que o export padrão está ativo.</li>
        <li className="rounded-ds-btn border border-ds-alert-border bg-white/60 p-3"><strong>2.</strong> Aguarde a tabela <code className="font-ds-mono">gcp_billing_export_v1_*</code>.</li>
        <li className="rounded-ds-btn border border-ds-alert-border bg-white/60 p-3"><strong>3.</strong> O painel detectará a tabela automaticamente.</li>
      </ol>
      <Button asChild variant="ds-secondary" size="md" className="mt-4">
        <a href={overview.setup.consoleUrl} target="_blank" rel="noreferrer">Abrir exportação do Cloud Billing ↗</a>
      </Button>
    </Alert>
  );
}

function KeyList({ rows, empty, render }: { rows: Array<{ key: string }>; empty: string; render: (row: never) => React.ReactNode }) {
  return rows.length ? (
    <div className="divide-y divide-ds-divider overflow-hidden rounded-ds-btn-lg border border-ds-border bg-white">{rows.map((row) => <div key={row.key}>{render(row as never)}</div>)}</div>
  ) : (
    <p className="rounded-ds-btn-lg border border-dashed border-ds-border-input p-8 text-center text-sm text-ds-ink-muted">{empty}</p>
  );
}

function CreditsView({ overview }: { overview: AiBillingOverview }) {
  const usedPercent = overview.credits.usedPercent ?? 0;
  const barTone = overview.alert.level === "critical" ? "bg-ds-danger" : overview.alert.level === "warning" ? "bg-ds-warn" : "bg-ds-accent-ink";
  const prepaidObservedAt = overview.credits.prepaidBalanceObservedAt ? formatBillingGeneratedAt(overview.credits.prepaidBalanceObservedAt) : null;
  const limitHint =
    overview.credits.source === "project_spend_limit" ? "Limite oficial do projeto usado como régua de alerta."
    : overview.credits.source === "organization_spend_limit" ? "Limite oficial da organização usado como régua de alerta."
    : overview.credits.source === "configured_monthly_budget" ? "Referência de alerta configurada no APP; não altera a cobrança."
    : "Nenhuma régua mensal encontrada.";
  return (
    <div className="space-y-5">
      <BillingAlertNotice alert={overview.alert} provider="openai" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatTile className="ring-1 ring-ds-accent-ink" label="Saldo pré-pago" value={monoValue(formatUsd(overview.credits.prepaidBalanceUsd))} hint={prepaidObservedAt ? `Saldo conferido no Billing oficial em ${prepaidObservedAt} (Belém). Atualização manual.` : "Saldo não disponível pela API; consulte o Billing oficial."} />
        <StatTile label="Régua mensal interna" value={monoValue(formatUsd(overview.credits.limitUsd))} hint={limitHint} />
        <StatTile label="Gasto oficial no mês" value={monoValue(formatUsd(overview.credits.spentUsd))} hint="Custo retornado pela API da OpenAI; não é calculado a partir da régua." />
        <StatTile label="Uso da régua" value={monoValue(overview.credits.usedPercent === null ? "Sem régua" : `${overview.credits.usedPercent.toLocaleString("pt-BR")}%`)} hint="Gasto oficial dividido pela régua interna. Serve somente aos alertas de 80% e 95%." />
      </div>

      <Section
        title="Acompanhamento da régua interna"
        description="Referência de controle do APP; não representa saldo, crédito ou cobrança disponível."
        aside={<StatusPill variant={overview.credits.usedPercent === null ? "neutral" : overview.alert.level === "critical" ? "danger" : overview.alert.level === "warning" ? "warn" : "ok"}>{overview.credits.usedPercent === null ? "Sem régua" : `${usedPercent.toLocaleString("pt-BR")}% da régua`}</StatusPill>}
      >
        {overview.credits.usedPercent !== null ? (
          <div className="h-3 overflow-hidden rounded-full bg-ds-muted" role="progressbar" aria-label="Uso da régua interna" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(usedPercent, 100))}>
            <div className={cn("h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", barTone)} style={{ width: `${Math.min(Math.max(usedPercent, 0), 100)}%` }} />
          </div>
        ) : null}
        <div className="mt-4 flex flex-col gap-3 rounded-ds-btn-lg border border-ds-border bg-ds-warm p-4 text-xs leading-relaxed text-ds-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <span>{overview.credits.note}</span>
          <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer" className="shrink-0 font-extrabold text-ds-accent-ink underline underline-offset-2">Ver saldo pré-pago oficial ↗</a>
        </div>
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Custo por ID de chave" description="Custo oficial no mês, agrupado pelo ID de chave retornado pela OpenAI. IDs não revelam o segredo.">
          <KeyList
            rows={overview.costs.byApiKey}
            empty="Nenhum custo por chave foi retornado."
            render={(entry: (typeof overview.costs.byApiKey)[number]) => (
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="min-w-0 break-all font-ds-mono text-xs" title={entry.label}>{entry.label}</span>
                <span className="shrink-0 font-ds-mono font-bold">{formatUsd(entry.costUsd)}</span>
              </div>
            )}
          />
        </Section>
        <Section title="Uso por ID de chave" description="Requisições e tokens no mês. A ausência de um ID não significa ausência de custo.">
          <KeyList
            rows={overview.usage.byApiKey}
            empty="Nenhum uso por chave foi retornado."
            render={(entry: (typeof overview.usage.byApiKey)[number]) => (
              <div className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <span className="min-w-0 break-all font-ds-mono text-xs" title={entry.label}>{entry.label}</span>
                <span className="text-xs text-ds-ink-muted sm:text-right"><span className="font-ds-mono font-bold text-ds-ink">{formatNumber(entry.requests)}</span> requisições · <span className="font-ds-mono font-bold text-ds-ink">{formatNumber(entry.inputTokens + entry.outputTokens)}</span> tokens</span>
              </div>
            )}
          />
        </Section>
      </div>

      <Section title="Uso por modelo" description={`${formatNumber(overview.usage.requests)} requisições e ${formatNumber(overview.usage.inputTokens + overview.usage.outputTokens)} tokens processados no mês atual.`}>
        {overview.usage.byModel.length ? (
          <div className="divide-y divide-ds-divider overflow-hidden rounded-ds-btn-lg border border-ds-border bg-white">
            {overview.usage.byModel.map((entry) => (
              <div key={entry.model} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6">
                <p className="truncate font-ds-mono text-[13px] font-bold">{entry.model}</p>
                <p className="text-xs text-ds-ink-muted"><span className="font-ds-mono font-bold text-ds-ink">{formatNumber(entry.requests)}</span> requisições</p>
                <p className="text-xs text-ds-ink-muted"><span className="font-ds-mono font-bold text-ds-ink">{formatNumber(entry.inputTokens + entry.outputTokens)}</span> tokens</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-ds-btn-lg border border-dashed border-ds-border-input p-8 text-center text-sm text-ds-ink-muted">Nenhum uso por modelo foi retornado.</p>
        )}
      </Section>
    </div>
  );
}

function AppCostBreakdownList({ title, description, values, currency }: { title: string; description: string; values: AppCostBreakdown[]; currency: string }) {
  const maximum = Math.max(...values.map((entry) => Math.abs(entry.cost)), 0);
  return (
    <Section title={title} description={description}>
      {values.length ? (
        <div className="space-y-3.5">
          {values.slice(0, 10).map((entry) => (
            <div key={entry.key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate font-semibold">{entry.label}</span>
                <span className="shrink-0 font-ds-mono font-bold">{formatCurrency(entry.cost, currency)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-ds-muted">
                <div className="h-full rounded-full bg-ds-accent-ink" style={{ width: maximum ? `${Math.max(2, (Math.abs(entry.cost) / maximum) * 100)}%` : "0%" }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-ds-btn-lg border border-dashed border-ds-border-input p-8 text-center text-sm text-ds-ink-muted">Sem custos para detalhar.</p>
      )}
    </Section>
  );
}

function GoogleQueryEstimate({ overview }: { overview: AppCostOverview }) {
  const estimate = overview.queryEstimate;
  return (
    <Section title="Estimativa das consultas deste painel" description="Projeção de bytes consultados no BigQuery. A franquia de consultas é compartilhada pela conta.">
      <div className="space-y-4">
        <BillingAlertNotice alert={overview.alert} provider="google" />
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Por consulta" value={monoValue(formatBillingBytes(estimate.bytesPerQuery))} />
          <StatTile label="Projeção mensal do painel" value={monoValue(formatBillingBytes(estimate.monthlyPanelBytesAtHourlyRefresh))} />
          <StatTile label="Franquia mensal de consultas" value={monoValue(formatBillingBytes(estimate.monthlyFreeBytes))} />
        </div>
        <p className="text-xs leading-relaxed text-ds-ink-muted">{estimate.note} Teto por consulta deste painel: {formatBillingBytes(estimate.maximumBytesBilled)}.</p>
      </div>
    </Section>
  );
}

function AppCostsView({ overview }: { overview: AppCostOverview }) {
  const last30Daily = useMemo(() => overview.costs.daily.slice(-30), [overview.costs.daily]);
  const maximum = Math.max(...last30Daily.map((entry) => Math.abs(entry.cost)), 0);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatTile className="ring-1 ring-ds-accent-ink" label="Custo líquido no mês" value={monoValue(formatCurrency(overview.costs.currentMonth, overview.currency))} hint={`Bruto de ${formatCurrency(overview.costs.grossCurrentMonth, overview.currency)}, após créditos.`} />
        <StatTile label="Mês anterior" value={monoValue(formatCurrency(overview.costs.previousMonth, overview.currency))} hint="Custo líquido consolidado do mês anterior." />
        <StatTile label="Últimos 30 dias" value={monoValue(formatCurrency(overview.costs.last30Days, overview.currency))} hint="Janela móvel até a última exportação." />
        <StatTile label="Créditos e descontos" value={monoValue(formatCurrency(Math.abs(overview.costs.creditsCurrentMonth || 0), overview.currency))} hint="Créditos abatidos do custo bruto neste mês." />
      </div>

      <GoogleQueryEstimate overview={overview} />

      <Section title="Custo diário" description="Custo líquido diário do projeto Firebase no Google Cloud." aside={<StatusPill variant="neutral">{overview.currency}</StatusPill>}>
        {last30Daily.length ? (
          <div className="flex h-52 items-end gap-1 overflow-hidden rounded-ds-btn-lg border border-ds-border bg-ds-warm px-3 pb-8 pt-4" role="img" aria-label="Custo líquido diário dos últimos 30 dias">
            {last30Daily.map((entry, index) => (
              <div key={entry.date} className="group relative flex h-full min-w-0 flex-1 items-end" title={`${formatDate(entry.date)}: ${formatCurrency(entry.cost, overview.currency)}`}>
                <div
                  className="w-full min-w-[3px] rounded-t bg-ds-accent transition-colors group-hover:bg-ds-accent-ink motion-reduce:transition-none"
                  style={{ height: maximum ? `${Math.max(2, (Math.abs(entry.cost) / maximum) * 100)}%` : "2%" }}
                />
                {(index === 0 || index === last30Daily.length - 1 || index % 7 === 0) ? (
                  <span className="absolute left-1/2 top-[calc(100%+0.35rem)] -translate-x-1/2 whitespace-nowrap font-ds-mono text-[10px] text-ds-ink-muted">{formatDate(entry.date)}</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-ds-btn-lg border border-dashed border-ds-border-input p-8 text-center text-sm text-ds-ink-muted">Nenhum custo diário foi retornado.</p>
        )}
      </Section>

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
      <div className="rounded-ds-card-lg border border-ds-border bg-ds-warm" role="status" aria-label="Consultando o billing">
        <ListSkeleton rows={4} />
      </div>
    );
  }

  if (error) {
    return (
      <Alert tone="danger" title="Falha ao carregar o billing">
        <p>{error}</p>
        <Button type="button" variant="ds-secondary" size="md" className="mt-3" onClick={() => void load()}>Tentar novamente</Button>
      </Alert>
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 text-xs text-ds-ink-muted">
          <StatusPill variant={overview.connected ? "ok" : "warn"}>
            {overview.connected ? `${isAppCost ? "Google Cloud/Firebase" : "OpenAI"} conectado` : `${isAppCost ? "Google Cloud/Firebase" : "OpenAI"} não conectado`}
          </StatusPill>
          <span>{scopeLabel}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-right text-xs leading-relaxed text-ds-ink-muted">
            {generatedAtLabel ? <time dateTime={overview.generatedAt}>Atualizado em {generatedAtLabel} (Belém)</time> : <span>Horário da atualização indisponível</span>}
            <span className="block">Cache de até 1 h</span>
          </span>
          <Button type="button" variant="ds-secondary" size="md" onClick={() => void load()} disabled={loading}>Atualizar</Button>
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
        <Alert key={warning} tone="warn">{warning}</Alert>
      ))}
    </div>
  );
}
