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
function Section({ id, title, description, aside, children }: { id?: string; title: string; description?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-ds-card-lg border border-ds-border bg-ds-surface p-5">
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

function formatLongDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(year, month - 1, day),
  );
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Não disponível";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
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
  const coverageIncomplete = overview.coverage.status === "empty" || overview.coverage.status === "backfilling";
  const currentCoverage = overview.coverage.status === "current";
  const monthlyChart = useMemo(() => {
    const latestDate = overview.coverage.lastUsageDate ?? last30Daily.at(-1)?.date;
    if (!latestDate) return [];
    const [year, month, lastDay] = latestDate.split("-").map(Number);
    if (!year || !month || !lastDay) return [];
    const monthPrefix = `${year}-${String(month).padStart(2, "0")}-`;
    const costsByDay = new Map(
      overview.costs.daily
        .filter((entry) => entry.date.startsWith(monthPrefix))
        .map((entry) => [Number(entry.date.slice(-2)), entry.cost]),
    );
    const daysInMonth = new Date(year, month, 0).getDate();
    const actualTotal = Array.from({ length: lastDay }, (_, index) => costsByDay.get(index + 1) ?? 0)
      .reduce((total, value) => total + value, 0);
    const dailyAverage = lastDay ? actualTotal / lastDay : 0;
    let cumulative = 0;
    return Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const projected = day > lastDay;
      if (!projected) cumulative += costsByDay.get(day) ?? 0;
      const value = projected
        ? currentCoverage ? actualTotal + dailyAverage * (day - lastDay) : null
        : cumulative;
      return {
        date: `${monthPrefix}${String(day).padStart(2, "0")}`,
        day,
        projected,
        value,
      };
    });
  }, [currentCoverage, last30Daily, overview.costs.daily, overview.coverage.lastUsageDate]);
  const chartMaximum = Math.max(...monthlyChart.map((entry) => Math.abs(entry.value ?? 0)), 0);
  const projectedMonth = useMemo(() => {
    if (!currentCoverage || overview.costs.currentMonth === null || !overview.coverage.lastUsageDate) return null;
    const [year, month, elapsedDays] = overview.coverage.lastUsageDate.split("-").map(Number);
    if (!year || !month || !elapsedDays) return null;
    const daysInMonth = new Date(year, month, 0).getDate();
    return (overview.costs.currentMonth / elapsedDays) * daysInMonth;
  }, [currentCoverage, overview.costs.currentMonth, overview.coverage.lastUsageDate]);
  const projectedChange = projectedMonth !== null && overview.costs.previousMonth
    ? ((projectedMonth - overview.costs.previousMonth) / Math.abs(overview.costs.previousMonth)) * 100
    : null;
  const coverageLabel = currentCoverage ? "Atualizado" : coverageIncomplete ? "Em preenchimento" : "Indisponível";
  const coverageVariant = currentCoverage ? "ok" : coverageIncomplete ? "warn" : "neutral";
  return (
    <div className="space-y-5">
      {coverageIncomplete ? (
        <Alert tone="warn" title="Export do projeto ainda em preenchimento">
          {overview.coverage.lastUsageDate
            ? <>O BigQuery contém dados somente até <strong>{formatDate(overview.coverage.lastUsageDate)}</strong>; o esperado é alcançar pelo menos <strong>{formatDate(overview.coverage.expectedThroughDate)}</strong>. Os totais ficam indisponíveis para não exibir um zero ou valor parcial como consolidado.</>
            : "A tabela existe, mas ainda não recebeu dias de uso deste projeto. Os totais serão liberados automaticamente quando o preenchimento avançar."}
          <span className="mt-1 block">Escopo mantido exclusivamente no projeto <strong>{overview.projectId}</strong>; outros projetos da conta de faturamento não são incluídos.</span>
        </Alert>
      ) : null}

      <nav aria-label="Seções do relatório de custos" className="flex gap-2 overflow-x-auto pb-1">
        {[
          ["#google-cost-summary", "Resumo do projeto"],
          ["#google-cost-daily", "Custo diário"],
          ["#google-cost-services", "Serviços"],
          ["#google-cost-skus", "SKUs"],
        ].map(([href, label], index) => (
          <Button key={href} asChild variant="ds-secondary" size="sm" className={cn("shrink-0", index === 0 && "border-ds-accent-ink bg-ds-accent-row text-ds-ink")}>
            <a href={href} aria-current={index === 0 ? "location" : undefined}>{label}</a>
          </Button>
        ))}
      </nav>

      <Section
        id="google-cost-summary"
        title="Resumo do projeto"
        description={`Custos do Google Cloud atribuídos exclusivamente a ${overview.projectId}.`}
        aside={<StatusPill variant={coverageVariant}>{coverageLabel}</StatusPill>}
      >
        <div className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-warm">
          <div className="grid gap-px bg-ds-border lg:grid-cols-[1.35fr_1fr_1fr]">
            <div className="bg-ds-surface p-5 sm:p-6">
              <p className="text-xs font-extrabold uppercase tracking-wide text-ds-ink-muted">Custo líquido neste mês</p>
              <p className="mt-2 font-ds-mono text-3xl font-bold tracking-tight text-ds-ink">{formatCurrency(overview.costs.currentMonth, overview.currency)}</p>
              <p className="mt-2 text-xs leading-relaxed text-ds-ink-muted">
                {overview.coverage.lastUsageDate
                  ? `Dados exportados até ${formatLongDate(overview.coverage.lastUsageDate)}.`
                  : "Nenhum dia de uso deste projeto foi exportado ainda."}
              </p>
            </div>
            <div className="bg-ds-surface p-5 sm:p-6">
              <p className="text-xs font-extrabold uppercase tracking-wide text-ds-ink-muted">Projeção para o mês</p>
              <p className="mt-2 font-ds-mono text-2xl font-bold text-ds-ink">{formatCurrency(projectedMonth, overview.currency)}</p>
              <p className="mt-2 text-xs text-ds-ink-muted">{projectedMonth === null ? "Disponível quando a exportação alcançar a data esperada." : `${formatPercent(projectedChange)} em relação ao mês anterior.`}</p>
            </div>
            <div className="bg-ds-surface p-5 sm:p-6">
              <p className="text-xs font-extrabold uppercase tracking-wide text-ds-ink-muted">Mês anterior</p>
              <p className="mt-2 font-ds-mono text-2xl font-bold text-ds-ink">{formatCurrency(overview.costs.previousMonth, overview.currency)}</p>
              <p className="mt-2 text-xs text-ds-ink-muted">Custo líquido consolidado pelo export.</p>
            </div>
          </div>
          <div className="grid gap-3 border-t border-ds-border p-4 sm:grid-cols-3">
            <div><p className="text-[11px] font-bold uppercase text-ds-ink-muted">Custo bruto</p><p className="mt-1 font-ds-mono text-sm font-bold">{formatCurrency(overview.costs.grossCurrentMonth, overview.currency)}</p></div>
            <div><p className="text-[11px] font-bold uppercase text-ds-ink-muted">Créditos e descontos</p><p className="mt-1 font-ds-mono text-sm font-bold">{formatCurrency(overview.costs.creditsCurrentMonth === null ? null : Math.abs(overview.costs.creditsCurrentMonth), overview.currency)}</p></div>
            <div><p className="text-[11px] font-bold uppercase text-ds-ink-muted">Últimos 30 dias</p><p className="mt-1 font-ds-mono text-sm font-bold">{formatCurrency(overview.costs.last30Days, overview.currency)}</p></div>
          </div>
        </div>

      </Section>

      <Section id="google-cost-daily" title="Custo acumulado no mês" description="Realizado e projeção pelo ritmo médio do projeto, sem incluir Getaloo ou outros projetos." aside={<StatusPill variant="neutral">{overview.currency}</StatusPill>}>
        {monthlyChart.some((entry) => entry.value !== null) ? (
          <>
            <div className="flex h-72 items-end gap-1 overflow-hidden rounded-ds-btn-lg border border-ds-border bg-ds-warm px-3 pb-8 pt-5" role="img" aria-label="Custo acumulado do projeto no mês">
              {monthlyChart.map((entry) => (
                <div key={entry.date} className="group relative flex h-full min-w-0 flex-1 items-end" title={`${formatDate(entry.date)}: ${formatCurrency(entry.value, overview.currency)}${entry.projected ? " (projeção)" : ""}`}>
                  {entry.value !== null ? (
                    <div
                      className={cn("w-full min-w-[3px] rounded-t transition-colors motion-reduce:transition-none", entry.projected ? "bg-ds-border-input group-hover:bg-ds-ink-muted" : "bg-ds-accent group-hover:bg-ds-accent-ink")}
                      style={{ height: chartMaximum ? `${Math.max(2, (Math.abs(entry.value) / chartMaximum) * 100)}%` : "2%" }}
                    />
                  ) : null}
                  {(entry.day === 1 || entry.day === monthlyChart.length || entry.day % 5 === 0) ? (
                    <span className="absolute left-1/2 top-[calc(100%+0.4rem)] -translate-x-1/2 whitespace-nowrap font-ds-mono text-[10px] text-ds-ink-muted">{entry.day}</span>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-ds-ink-muted">
              <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-sm bg-ds-accent" />Custo acumulado exportado</span>
              {currentCoverage ? <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-sm bg-ds-border-input" />Estimativa até o fim do mês</span> : null}
            </div>

            <div className="mt-5 overflow-x-auto rounded-ds-card border border-ds-border">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="bg-ds-warm text-[11px] uppercase tracking-wide text-ds-ink-muted">
                  <tr>
                    <th className="px-4 py-3 font-extrabold">Projeto</th>
                    <th className="px-4 py-3 font-extrabold">ID do projeto</th>
                    <th className="px-4 py-3 text-right font-extrabold">Custo bruto</th>
                    <th className="px-4 py-3 text-right font-extrabold">Créditos</th>
                    <th className="px-4 py-3 text-right font-extrabold">Custo líquido</th>
                    <th className="px-4 py-3 font-extrabold">Cobertura</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-ds-border bg-ds-surface">
                    <td className="px-4 py-4 font-bold text-ds-ink"><span aria-hidden className="mr-2 inline-block size-2 rounded-full bg-ds-accent-ink" />Coala ERP Estoque</td>
                    <td className="px-4 py-4 font-ds-mono text-ds-ink-muted">{overview.projectId}</td>
                    <td className="px-4 py-4 text-right font-ds-mono font-bold">{formatCurrency(overview.costs.grossCurrentMonth, overview.currency)}</td>
                    <td className="px-4 py-4 text-right font-ds-mono font-bold">{formatCurrency(overview.costs.creditsCurrentMonth === null ? null : Math.abs(overview.costs.creditsCurrentMonth), overview.currency)}</td>
                    <td className="px-4 py-4 text-right font-ds-mono font-bold">{formatCurrency(overview.costs.currentMonth, overview.currency)}</td>
                    <td className="px-4 py-4"><StatusPill variant={coverageVariant}>{coverageLabel}</StatusPill></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ds-ink-muted">Esta visão não soma outros projetos da conta de faturamento. O projeto Getaloo permanece fora deste painel.</p>
          </>
        ) : (
          <p className="rounded-ds-btn-lg border border-dashed border-ds-border-input p-8 text-center text-sm text-ds-ink-muted">Nenhum custo diário foi retornado.</p>
        )}
      </Section>

      <GoogleQueryEstimate overview={overview} />

      <div className="grid gap-5 xl:grid-cols-2">
        <div id="google-cost-services" className="scroll-mt-24"><AppCostBreakdownList title="Por serviço" description="Firestore, App Hosting, Cloud Run, Storage e demais serviços vinculados." values={overview.costs.byService} currency={overview.currency} /></div>
        <div id="google-cost-skus" className="scroll-mt-24"><AppCostBreakdownList title="Por SKU" description="Itens específicos que formam o custo de cada serviço Google Cloud." values={overview.costs.bySku} currency={overview.currency} /></div>
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
    ? `Somente o projeto: ${overview.projectId}`
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
