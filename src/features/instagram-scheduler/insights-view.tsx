"use client";

import { useEffect, useRef } from "react";

import {
  Activity,
  BarChart3,
  CircleDollarSign,
  ExternalLink,
  Eye,
  HeartHandshake,
  Instagram,
  Lightbulb,
  Loader2,
  MousePointerClick,
  Megaphone,
  RefreshCw,
  Share2,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { cn } from "@/lib/utils";
import { PulseHero } from "./hero-panel";

import type {
  InstagramAdsReport,
  InstagramAudienceReport,
  InstagramInsightsContentPage,
  InstagramInsightsSection,
  InstagramInsightContentSnapshot,
  InstagramInsightContentItem,
  InstagramInsightsPeriod,
  InstagramInsightsReport,
} from "./contracts";
import {
  buildInstagramInsightReading,
  publicBioMetric,
  summarizeInstagramContentFormats,
  summarizeInstagramHistoryCoverage,
} from "./insights-view-model";

type InsightsViewProps = {
  report: InstagramInsightsReport | null;
  period: InstagramInsightsPeriod;
  section: InstagramInsightsSection;
  loading: boolean;
  error: string | null;
  audience: InstagramAudienceReport | null;
  audienceLoading: boolean;
  audienceError: string | null;
  ads: InstagramAdsReport | null;
  adsLoading: boolean;
  adsError: string | null;
  contentPage: InstagramInsightsContentPage | null;
  contentLoading: boolean;
  contentError: string | null;
  onPeriodChange: (period: InstagramInsightsPeriod) => void;
  onSectionChange: (section: InstagramInsightsSection) => void;
  onRefresh: () => void;
  onLoadAudience: () => void;
  onLoadAds: () => void;
  onLoadContent: (after: string | null) => void;
};

const numberFormatter = new Intl.NumberFormat("pt-BR");
const compactNumberFormatter = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function amount(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : numberFormatter.format(value);
}

function percentage(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)}%`;
}

function date(value: string, options?: { year?: boolean }) {
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00.000Z` : value);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    ...(options?.year ? { year: "numeric" as const } : {}),
    timeZone: "America/Fortaleza",
  }).format(parsed).replace(" de ", " ");
}

function periodLabel(report: InstagramInsightsReport) {
  return `${date(report.range.since, { year: true })} – ${date(report.range.until, { year: true })}`;
}

function currency(value: number | null, code: string | null) {
  if (value === null) return "—";
  if (!code) return amount(value);
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(value);
  } catch {
    return amount(value);
  }
}

function demographicShare(value: number, rows: Array<{ value: number }>) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return total > 0 ? (value / total) * 100 : null;
}

function audienceAgeLabel(value: string) {
  return value.replace(/-/g, "–");
}

function audienceGenderLabel(value: string) {
  const normalized = value.trim().toUpperCase();
  if (["F", "FEMALE", "WOMEN"].includes(normalized)) return "Mulheres";
  if (["M", "MALE", "MEN"].includes(normalized)) return "Homens";
  return "Outros / não informado";
}

function groupAudienceByAge(rows: InstagramAudienceReport["ageGender"]) {
  const grouped = new Map<string, Record<string, number>>();
  (rows ?? []).forEach((row) => {
    const age = row.dimensions.age ?? "Não informado";
    const gender = audienceGenderLabel(row.dimensions.gender ?? "");
    const current = grouped.get(age) ?? {};
    current[gender] = (current[gender] ?? 0) + row.value;
    grouped.set(age, current);
  });
  return [...grouped.entries()].sort(([left], [right]) => {
    const leftAge = Number(left.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);
    const rightAge = Number(right.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);
    return leftAge - rightAge || left.localeCompare(right);
  });
}

function snapshotStage(item: InstagramInsightContentItem) {
  const stage = (item as Partial<InstagramInsightContentSnapshot>).stage;
  if (stage === "first48h") return "até 48h";
  if (stage === "day7") return "7 dias";
  if (stage === "day30") return "30 dias";
  return null;
}

type MetricCardProps = {
  label: string;
  value: number | null | undefined;
  icon: typeof Eye;
  helper?: string;
  explanation?: string;
  formatValue?: (value: number | null) => string;
};

function MetricCard({ label, value, icon: Icon, helper, explanation, formatValue }: MetricCardProps) {
  return (
    <article className="rounded-ds-card-lg border border-ds-border bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ds-ink-muted">{label}</p>
          {explanation ? (
            <InfoTooltip title={`O que significa ${label.toLowerCase()}`}>
              <p>{explanation}</p>
            </InfoTooltip>
          ) : null}
        </div>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-ds-btn-lg bg-ds-accent-soft text-ds-accent-ink">
          <Icon aria-hidden="true" className="h-4 w-4" />
        </span>
      </div>
      <strong className="mt-3 block text-[28px] font-bold leading-none tracking-tight text-ds-ink">{formatValue ? formatValue(value ?? null) : amount(value)}</strong>
      {helper ? <p className="mt-2 text-xs leading-5 text-ds-ink-muted">{helper}</p> : null}
    </article>
  );
}

function ContentList({ title, items }: { title: string; items: InstagramInsightContentItem[] }) {
  return (
    <section className="rounded-ds-card-lg border border-ds-border bg-white p-4 md:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight text-ds-ink">{title}</h2>
            <InfoTooltip title="Como comparar os conteúdos">
              <p>Use alcance e visualizações para entender distribuição; interações, compartilhamentos e salvamentos indicam a resposta gerada.</p>
              <p>Quando houver um marco de 48 horas, 7 ou 30 dias, compare apenas conteúdos observados na mesma janela.</p>
            </InfoTooltip>
          </div>
          <p className="mt-1 text-xs text-ds-ink-muted">Compare formatos e identifique os conteúdos que merecem repetição.</p>
        </div>
        <span className="rounded-full bg-ds-muted px-2.5 py-1 text-xs font-bold text-ds-ink-muted">{items.length}</span>
      </div>

      {items.length ? (
        <div className="divide-y divide-ds-divider">
          {items.map((item) => (
            <article key={item.id} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[72px_minmax(0,1fr)_auto]">
              <div className="h-20 w-16 overflow-hidden rounded-ds-btn-lg bg-ds-muted lg:w-[72px]">
                {item.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center"><Eye aria-hidden="true" className="h-5 w-5 text-ds-ink-faint" /></div>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-ds-accent-soft px-2 py-0.5 text-[10px] font-extrabold text-ds-accent-ink">{item.format}</span>
                  {snapshotStage(item) ? <span className="rounded-full bg-ds-muted px-2 py-0.5 text-[10px] font-extrabold text-ds-ink-muted">{snapshotStage(item)}</span> : null}
                  <span className="text-xs font-semibold text-ds-ink-muted">{date(item.publishedAt)}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-ds-ink">{item.caption || "Sem legenda"}</p>
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ds-ink-muted">
                  <div className="flex gap-1"><dt>Alcance</dt><dd className="font-bold text-ds-ink">{amount(item.reach)}</dd></div>
                  <div className="flex gap-1"><dt>Visualizações</dt><dd className="font-bold text-ds-ink">{amount(item.views)}</dd></div>
                  <div className="flex gap-1"><dt>Interações</dt><dd className="font-bold text-ds-ink">{amount(item.totalInteractions)}</dd></div>
                  <div className="flex gap-1"><dt>Curtidas</dt><dd className="font-bold text-ds-ink">{amount(item.likes)}</dd></div>
                  <div className="flex gap-1"><dt>Comentários</dt><dd className="font-bold text-ds-ink">{amount(item.comments)}</dd></div>
                  <div className="flex gap-1"><dt>Compart.</dt><dd className="font-bold text-ds-ink">{amount(item.shares)}</dd></div>
                  <div className="flex gap-1"><dt>Salvos</dt><dd className="font-bold text-ds-ink">{amount(item.saves)}</dd></div>
                  {item.format === "Story" ? (
                    <>
                      <div className="flex gap-1"><dt>Respostas</dt><dd className="font-bold text-ds-ink">{amount(item.replies)}</dd></div>
                      <div className="flex gap-1"><dt>Link do Story</dt><dd className="font-bold text-ds-ink">{amount(item.storyLinkClicks)}</dd></div>
                      <div className="flex gap-1"><dt>Bio após Story</dt><dd className="font-bold text-ds-ink">{amount(item.bioLinkClicks)}</dd></div>
                    </>
                  ) : null}
                </dl>
              </div>
              {item.permalink ? (
                <a href={item.permalink} target="_blank" rel="noopener noreferrer" aria-label="Abrir publicação no Instagram" className="hidden h-9 w-9 place-items-center rounded-ds-btn-lg border border-ds-border text-ds-ink-muted transition hover:bg-ds-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink lg:grid">
                  <ExternalLink aria-hidden="true" className="h-4 w-4" />
                </a>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="rounded-ds-btn-lg bg-ds-warm p-4 text-sm text-ds-ink-muted">Nenhum conteúdo disponível neste período.</p>
      )}
    </section>
  );
}

export function InsightsView({
  report,
  period,
  section,
  loading,
  error,
  audience,
  audienceLoading,
  audienceError,
  ads,
  adsLoading,
  adsError,
  contentPage,
  contentLoading,
  contentError,
  onPeriodChange,
  onSectionChange,
  onRefresh,
  onLoadAudience,
  onLoadAds,
  onLoadContent,
}: InsightsViewProps) {
  const audienceRequested = useRef(false);
  const adsRequestedPeriod = useRef<InstagramInsightsPeriod | null>(null);
  const contentRequestedPeriod = useRef<InstagramInsightsPeriod | null>(null);
  useEffect(() => {
    if (section === "audience" && !audience && !audienceRequested.current) {
      audienceRequested.current = true;
      onLoadAudience();
    }
    if (section === "ads" && ads?.period !== period && adsRequestedPeriod.current !== period) {
      adsRequestedPeriod.current = period;
      onLoadAds();
    }
    if (section === "content" && contentPage?.period !== period && contentRequestedPeriod.current !== period) {
      contentRequestedPeriod.current = period;
      onLoadContent(null);
    }
  }, [ads?.period, audience, contentPage?.period, onLoadAds, onLoadAudience, onLoadContent, period, section]);

  const coverage = report ? summarizeInstagramHistoryCoverage(report.history.daily, report.range.days) : null;
  const reading = report ? buildInstagramInsightReading(report) : null;
  const formatSummaries = report ? summarizeInstagramContentFormats(report.content) : [];
  const bioHasCoverage = Boolean(report?.bio.daily.length);
  const yearSelected = period === "year";
  const contentPageCurrent = contentPage?.period === period;
  const audienceAgeRows = groupAudienceByAge(audience?.ageGender ?? null);
  const netFollowers = report?.totals.follows !== null && report?.totals.follows !== undefined
    && report.totals.unfollows !== null && report.totals.unfollows !== undefined
    ? report.totals.follows - report.totals.unfollows
    : null;
  const viewTypeTotal = report?.viewsByFollowType.followers !== null && report?.viewsByFollowType.followers !== undefined
    && report.viewsByFollowType.nonFollowers !== null
    ? report.viewsByFollowType.followers + report.viewsByFollowType.nonFollowers
    : null;
  const followerViewShare = viewTypeTotal !== null && viewTypeTotal > 0 && report?.viewsByFollowType.followers !== null && report?.viewsByFollowType.followers !== undefined
    ? (report.viewsByFollowType.followers / viewTypeTotal) * 100
    : null;

  const sections = [
    ["overview", "Visão geral"],
    ["results", "Resultados"],
    ["audience", "Público"],
    ["content", "Conteúdo"],
    ["ads", "Anúncios"],
  ] as const;
  const sectionHint: Record<InstagramInsightsSection, string> = {
    overview: "Resumo para localizar rapidamente os principais sinais do período.",
    results: "Volume, distribuição e ações medidas pela Meta ou pelo site da bio.",
    audience: "Quem compõe a audiência, com dados apenas agregados e sujeitos às faixas mínimas da Meta.",
    content: "Desempenho das publicações e lista paginada dentro do período selecionado.",
    ads: "Entrega paga consultada na conta de anúncios vinculada; esta área não altera campanhas.",
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-5 bg-ds-warm px-4 py-5 font-ds text-ds-ink md:px-7" aria-busy={loading} aria-labelledby="instagram-insights-title">
      <PulseHero
        kicker="Programação do Instagram"
        title="Relatórios e anúncios"
        titleId="instagram-insights-title"
        subtitle={report ? periodLabel(report) : "Selecione o período"}
        compactInfo={`${sections.find(([value]) => value === section)?.[1] ?? ""}${report ? ` · ${periodLabel(report)}` : ""}`}
        compactActions={<Button type="button" variant="on-dark-secondary" size="md" onClick={onRefresh} disabled={loading}>{loading ? "Atualizando…" : "Atualizar"}</Button>}
        actions={(
          <>
            <div role="group" aria-label="Período do relatório" className="flex gap-0.5 rounded-ds-btn bg-white/[0.07] p-1">
              {([7, 30, 90, "year"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={period === option}
                  onClick={() => onPeriodChange(option)}
                  className={cn(
                    "h-[34px] whitespace-nowrap rounded-ds-md px-3.5 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker",
                    period === option ? "bg-ds-on-dark text-ds-dark" : "text-ds-on-dark-sub hover:text-white",
                  )}
                >
                  {option === "year" ? "Este ano" : `${option} dias`}
                </button>
              ))}
            </div>
            <Button type="button" variant="on-dark-secondary" size="xl" onClick={onRefresh} disabled={loading}>
              {loading ? "Atualizando…" : "Atualizar"}
            </Button>
          </>
        )}
        footer={(
          <>
            <p className="text-[13px] text-ds-on-dark-sub">Entenda como as pessoas descobriram, responderam e avançaram a partir do conteúdo, com a origem e a cobertura de cada dado.</p>
            <div role="tablist" aria-label="Seções de Insights" className="-mb-5 flex gap-1 overflow-x-auto border-b border-white/10">
              {sections.map(([value, label]) => (
                <button
                  key={value}
                  id={`instagram-insights-tab-${value}`}
                  type="button"
                  role="tab"
                  aria-selected={section === value}
                  aria-controls="instagram-insights-panel"
                  onClick={() => onSectionChange(value)}
                  className={cn(
                    "shrink-0 border-b-4 px-4 pb-3 pt-1.5 text-[15px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker",
                    section === value ? "border-ds-accent text-white" : "border-transparent text-ds-indicator-zero hover:text-ds-on-dark-2",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      />
      <p className="-mt-2 text-xs leading-5 text-ds-ink-muted">{sectionHint[section]}</p>

      {error ? <div role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg p-4 text-sm font-semibold text-ds-confirm-ink">{error}</div> : null}
      {loading && !report ? <div role="status" className="flex items-center justify-center gap-2 rounded-ds-card-lg border border-ds-border bg-ds-surface p-12 text-ds-ink-muted">Consultando a Meta e os acessos da bio…</div> : null}

      {report ? (
        <div className="space-y-5">
          <section className="flex flex-col gap-4 rounded-ds-card-lg border border-ds-border bg-ds-surface p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              {report.profile.profilePictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={report.profile.profilePictureUrl} alt="" className="h-12 w-12 rounded-full border border-ds-border object-cover" />
              ) : (
                <div className="grid h-12 w-12 place-items-center rounded-full bg-ds-accent-soft text-ds-accent-ink"><Instagram aria-hidden="true" className="h-5 w-5" /></div>
              )}
              <div>
                <strong className="block text-lg font-extrabold">@{report.profile.username}</strong>
                <span className="text-xs text-ds-ink-muted">Conta profissional conectada · dados consolidados pela Meta para o período</span>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <div><dt className="text-xs text-ds-ink-muted">Seguidores atuais</dt><dd className="mt-1 font-ds-mono text-xl font-bold">{amount(report.profile.followersCount)}</dd></div>
              <div><dt className="text-xs text-ds-ink-muted">Publicações</dt><dd className="mt-1 font-ds-mono text-xl font-bold">{amount(report.profile.mediaCount)}</dd></div>
            </dl>
          </section>

          <div id="instagram-insights-panel" role="tabpanel" aria-labelledby={`instagram-insights-tab-${section}`} tabIndex={0} className="space-y-5 outline-none">

          {section === "overview" ? (
          <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Resumo do período">
            <MetricCard label="Visualizações" value={report.totals.views} icon={Eye} helper="Exposições, não pessoas únicas." explanation="Uma mesma pessoa pode gerar várias visualizações. Para contas únicas, consulte alcance." />
            <MetricCard label="Alcance" value={report.totals.reach} icon={Users} helper="Contas distintas alcançadas." explanation="Contas que receberam algum conteúdo no período. Em 90 dias, a soma das janelas pode repetir pessoas." />
            <MetricCard label="Interações" value={report.totals.totalInteractions} icon={Activity} helper="Respostas ao conteúdo." explanation="Total de ações como curtidas, comentários, compartilhamentos e salvamentos informadas pela Meta." />
            <MetricCard label="Seguidores atuais" value={report.profile.followersCount} icon={Users} helper="Tamanho atual da comunidade." explanation="Contagem do perfil no momento da consulta; não é o crescimento do período." />
          </section>

          <section aria-labelledby="period-reading-title" className="rounded-ds-card-lg border border-ds-border bg-white p-4 md:p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ds-btn-lg bg-ds-accent-soft text-ds-accent-ink">
                <Sparkles aria-hidden="true" className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-ds-accent-ink">Leitura do período</p>
                <h2 id="period-reading-title" className="mt-1 text-lg font-bold tracking-tight text-ds-ink">Do alcance à ação</h2>
                <p className="mt-1 text-sm leading-6 text-ds-ink-muted">Estes sinais conectam descoberta, resposta ao conteúdo e intenção de avançar pelo perfil.</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <article className="rounded-ds-btn-lg bg-ds-warm p-4">
                <div className="flex items-center gap-2 text-ds-accent-ink"><TrendingUp aria-hidden="true" className="h-4 w-4" /><span className="text-[11px] font-extrabold uppercase tracking-[0.08em]">Descoberta</span></div>
                <strong className="mt-3 block text-2xl text-ds-ink">{amount(reading?.discovery.value)}</strong>
                <p className="mt-1 text-xs leading-5 text-ds-ink-muted">Maior alcance diário{reading?.discovery.date ? `, em ${date(reading.discovery.date)}` : " ainda não identificado"}.</p>
              </article>
              <article className="rounded-ds-btn-lg bg-ds-warm p-4">
                <div className="flex items-center gap-2 text-ds-accent-ink"><HeartHandshake aria-hidden="true" className="h-4 w-4" /><span className="text-[11px] font-extrabold uppercase tracking-[0.08em]">Resposta</span></div>
                <strong className="mt-3 block text-2xl text-ds-ink">{percentage(reading?.interactionsPerHundredViews)}</strong>
                <p className="mt-1 text-xs leading-5 text-ds-ink-muted">Interações a cada 100 visualizações; é uma relação de leitura, não uma taxa oficial da Meta.</p>
              </article>
              <article className="rounded-ds-btn-lg bg-ds-warm p-4">
                <div className="flex items-center gap-2 text-ds-accent-ink"><MousePointerClick aria-hidden="true" className="h-4 w-4" /><span className="text-[11px] font-extrabold uppercase tracking-[0.08em]">Ação no perfil</span></div>
                <strong className="mt-3 block text-2xl text-ds-ink">{percentage(reading?.profileClickRate)}</strong>
                <p className="mt-1 text-xs leading-5 text-ds-ink-muted">Cliques no link em relação às visitas ao perfil registradas pela Meta.</p>
              </article>
            </div>

            <div className="mt-3 flex items-start gap-3 rounded-ds-btn-lg border border-ds-alert-border bg-ds-alert-bg p-4">
              <Lightbulb aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-ds-warn" />
              <div>
                <strong className="text-sm text-ds-alert-ink">Próxima ação sugerida</strong>
                <p className="mt-1 text-sm leading-6 text-ds-alert-ink">{reading?.recommendation}</p>
              </div>
            </div>
          </section>
          </>
          ) : null}

          {section === "results" ? <>
          <section aria-labelledby="instagram-performance-title">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-ds-accent-ink">Resultados</p>
                <h2 id="instagram-performance-title" className="mt-1 text-lg font-bold tracking-tight text-ds-ink">Desempenho no Instagram</h2>
              </div>
              <p className="text-xs text-ds-ink-muted">A Meta pode levar até 48 horas para consolidar os dados.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {yearSelected ? (
                <>
                  <MetricCard label="Visualizações" value={report.totals.views} icon={Eye} helper="Exposição total do conteúdo." explanation="Conta cada exibição registrada pela Meta. A mesma pessoa pode gerar mais de uma visualização." />
                  <MetricCard label="Alcance único" value={report.totals.reach} icon={Users} helper="Indisponível no recorte anual." explanation="Representa contas distintas alcançadas. Os CSVs trazem alcance por dia, mas somá-lo repetiria pessoas vistas em dias diferentes; por isso o total anual não é estimado." />
                  <MetricCard label="Interações" value={report.totals.totalInteractions} icon={Activity} helper="Resposta gerada pelo conteúdo." explanation="Reúne curtidas ou reações, comentários, compartilhamentos, salvamentos e outras interações informadas pela Meta. Interações removidas deixam de compor o total." />
                  <MetricCard label="Visitas ao perfil" value={report.businessSuiteTotals.profileVisits} icon={Instagram} helper="Interesse em conhecer a conta." explanation="Quantidade de vezes que o perfil do Instagram foi visitado no período selecionado." />
                  <MetricCard label="Cliques no link" value={report.businessSuiteTotals.profileLinkClicks} icon={MousePointerClick} helper="Avanço para fora do Instagram." explanation="Cliques registrados pela Meta no link disponível no perfil do Instagram." />
                  <MetricCard label="Novos seguidores" value={report.businessSuiteTotals.followers} icon={Users} helper="Crescimento conquistado no período." explanation="Novos seguidores registrados em cada dia pela exportação da Meta. Não representa o saldo líquido depois de deixar de seguir." />
                </>
              ) : (
                <>
                  <MetricCard label="Visualizações" value={report.totals.views} icon={Eye} helper="Exposição total do conteúdo." explanation="Conta cada exibição registrada pela Meta. A mesma pessoa pode gerar mais de uma visualização." />
                  <MetricCard label="Alcance" value={report.totals.reach} icon={Users} helper={period === 90 ? "Soma de três janelas; pode repetir pessoas." : "Pessoas distintas que receberam o conteúdo."} explanation={period === 90 ? "A Meta limita o tamanho de cada consulta. O total de 90 dias reúne três janelas e uma conta vista em mais de uma delas pode ser contada novamente." : "Quantidade de contas distintas que viram algum conteúdo ao menos uma vez no período."} />
                  <MetricCard label="Contas engajadas" value={report.totals.accountsEngaged} icon={HeartHandshake} helper="Pessoas que responderam ao conteúdo." explanation="Contas distintas que curtiram, comentaram, compartilharam, salvaram ou realizaram outra interação registrada pela Meta." />
                  <MetricCard label="Interações" value={report.totals.totalInteractions} icon={Activity} helper="Volume total de respostas geradas." explanation="Reúne curtidas ou reações, comentários, compartilhamentos, salvamentos e outras interações informadas pela Meta. Interações removidas deixam de compor o total." />
                  <MetricCard label="Compartilhamentos" value={report.totals.shares} icon={Share2} helper="Distribuição feita pelo próprio público." explanation="Quantidade de vezes que as pessoas compartilharam o conteúdo por recursos contabilizados pela Meta." />
                  <MetricCard label="Salvamentos" value={report.totals.saves} icon={BarChart3} helper="Intenção de consultar o conteúdo depois." explanation="Quantidade de vezes que as pessoas salvaram as publicações durante o período." />
                </>
              )}
            </div>
          </section>

          </> : null}

          {section === "audience" ? <>
          <section aria-labelledby="instagram-growth-title" className="rounded-ds-card-lg border border-ds-border bg-white p-4 md:p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-ds-accent-ink">Audiência</p>
                <h2 id="instagram-growth-title" className="mt-1 text-lg font-bold tracking-tight text-ds-ink">Crescimento da comunidade</h2>
              </div>
              <p className="text-xs text-ds-ink-muted">Ganhos, perdas e saldo são conceitos diferentes.</p>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-ds-btn-lg bg-ds-warm p-4"><dt className="text-xs font-bold text-ds-ink-muted">Seguidores atuais</dt><dd className="mt-2 text-2xl font-bold text-ds-ink">{amount(report.profile.followersCount)}</dd><p className="mt-1 text-xs leading-5 text-ds-ink-muted">Tamanho atual da comunidade, não o ganho do período.</p></div>
              <div className="rounded-ds-btn-lg bg-ds-warm p-4"><dt className="flex items-center gap-1.5 text-xs font-bold text-ds-ink-muted">Novos seguidores<InfoTooltip title="Como ler novos seguidores"><p>Contabiliza as pessoas que começaram a seguir a conta no período. O valor não desconta quem deixou de seguir.</p></InfoTooltip></dt><dd className="mt-2 text-2xl font-bold text-ds-ink">{amount(report.totals.follows)}</dd></div>
              <div className="rounded-ds-btn-lg bg-ds-warm p-4"><dt className="flex items-center gap-1.5 text-xs font-bold text-ds-ink-muted">Deixaram de seguir<InfoTooltip title="Como ler as perdas"><p>Contabiliza as pessoas que deixaram de seguir a conta. A exportação anual fornecida não contém essa série e, nesse caso, o valor fica indisponível.</p></InfoTooltip></dt><dd className="mt-2 text-2xl font-bold text-ds-ink">{amount(report.totals.unfollows)}</dd></div>
              <div className="rounded-ds-btn-lg bg-ds-warm p-4"><dt className="flex items-center gap-1.5 text-xs font-bold text-ds-ink-muted">Saldo do período<InfoTooltip title="Como o saldo é calculado"><p>Novos seguidores menos pessoas que deixaram de seguir. Só é exibido quando os dois valores estão disponíveis.</p></InfoTooltip></dt><dd className="mt-2 text-2xl font-bold text-ds-ink">{amount(netFollowers)}</dd></div>
            </dl>
          </section>

          <section aria-labelledby="audience-demographics-title" className="space-y-4">
            <div className="rounded-ds-card-lg border border-ds-border bg-white p-4 md:p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ds-btn-lg bg-ds-accent-soft text-ds-accent-ink"><Users aria-hidden="true" className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 id="audience-demographics-title" className="text-lg font-bold tracking-tight text-ds-ink">Quem acompanha a conta</h2>
                    <InfoTooltip title="Origem e limites do público"><p>São distribuições agregadas que a API oficial da Meta disponibiliza para a conta. Não identificam pessoas e podem ser omitidas quando a audiência é pequena ou uma categoria não atinge o limite mínimo.</p></InfoTooltip>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-ds-ink-muted">Faixas e localidades dos seguidores informados pela Meta. A consulta usa a janela móvel de 30 dias, independente do período escolhido acima.</p>
                </div>
                <Button type="button" variant="ds-secondary" size="md" onClick={onLoadAudience} disabled={audienceLoading} className="shrink-0">
                  {audienceLoading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <RefreshCw aria-hidden="true" className="h-4 w-4" />}
                  Atualizar
                </Button>
              </div>
              {audienceError ? <div role="alert" className="mt-4 rounded-ds-btn-lg border border-ds-confirm-border bg-ds-confirm-bg p-3 text-sm text-ds-confirm-ink">{audienceError}</div> : null}
              {audienceLoading && !audience ? <div className="mt-4 flex items-center gap-2 rounded-ds-btn-lg bg-ds-warm p-4 text-sm text-ds-ink-muted"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Consultando distribuições agregadas…</div> : null}
              {!audienceLoading && !audience && !audienceError ? <p className="mt-4 rounded-ds-btn-lg bg-ds-warm p-4 text-sm text-ds-ink-muted">Os dados de público serão consultados ao abrir esta seção.</p> : null}
            </div>

            {audience ? (
              <>
                <section className="rounded-ds-card-lg border border-ds-border bg-white p-4 md:p-5" aria-labelledby="audience-age-gender-title">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 id="audience-age-gender-title" className="font-bold text-ds-ink">Faixa etária e gênero</h3>
                      <p className="mt-1 text-xs text-ds-ink-muted">Participação dentro das categorias que a Meta retornou.</p>
                    </div>
                    <InfoTooltip title="Como ler esta distribuição"><p>As barras mostram a proporção calculada a partir dos valores agregados recebidos para as categorias exibidas. A Meta pode omitir parte da audiência, então esse percentual não precisa fechar com o número atual de seguidores.</p></InfoTooltip>
                  </div>
                  {audience.ageGender === null ? (
                    <p className="mt-4 rounded-ds-btn-lg bg-ds-warm p-4 text-sm leading-6 text-ds-ink-muted">A Meta não disponibilizou esta quebra para a conta neste momento.</p>
                  ) : audience.ageGender.length === 0 ? (
                    <p className="mt-4 rounded-ds-btn-lg bg-ds-warm p-4 text-sm leading-6 text-ds-ink-muted">A Meta não retornou categorias etárias ou de gênero para esta janela.</p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {audienceAgeRows.map(([age, values]) => {
                        const women = values.Mulheres ?? 0;
                        const men = values.Homens ?? 0;
                        const other = values["Outros / não informado"] ?? 0;
                        const womenShare = demographicShare(women, audience.ageGender ?? []);
                        const menShare = demographicShare(men, audience.ageGender ?? []);
                        const otherShare = demographicShare(other, audience.ageGender ?? []);
                        return (
                          <div key={age} className="grid gap-2 sm:grid-cols-[72px_minmax(0,1fr)_190px] sm:items-center">
                            <strong className="text-sm text-ds-ink">{audienceAgeLabel(age)}</strong>
                            <div className="flex h-3 overflow-hidden rounded-full bg-ds-muted" role="img" aria-label={`${audienceAgeLabel(age)}: mulheres ${percentage(womenShare)}, homens ${percentage(menShare)}, outros ${percentage(otherShare)}`}>
                              <span className="bg-ds-accent" style={{ width: `${womenShare ?? 0}%` }} />
                              <span className="bg-ds-info" style={{ width: `${menShare ?? 0}%` }} />
                              <span className="bg-ds-ink-faint" style={{ width: `${otherShare ?? 0}%` }} />
                            </div>
                            <p className="text-xs text-ds-ink-muted">Mulheres {percentage(womenShare)} · Homens {percentage(menShare)}{otherShare ? ` · Outros ${percentage(otherShare)}` : ""}</p>
                          </div>
                        );
                      })}
                      <div className="flex flex-wrap gap-4 pt-2 text-xs text-ds-ink-muted"><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-ds-accent" />Mulheres</span><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-ds-info" />Homens</span><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-ds-ink-faint" />Outros / não informado</span></div>
                    </div>
                  )}
                </section>

                <div className="grid gap-4 lg:grid-cols-2">
                  {([
                    ["cities", "Principais cidades", "city"],
                    ["countries", "Principais países", "country"],
                  ] as const).map(([key, title, dimension]) => {
                    const rows = audience[key];
                    const ranked = rows?.slice().sort((left, right) => right.value - left.value).slice(0, 8) ?? [];
                    return (
                      <section key={key} className="rounded-ds-card-lg border border-ds-border bg-white p-4 md:p-5" aria-labelledby={`audience-${key}-title`}>
                        <h3 id={`audience-${key}-title`} className="font-bold text-ds-ink">{title}</h3>
                        {rows === null ? (
                          <p className="mt-3 rounded-ds-btn-lg bg-ds-warm p-4 text-sm leading-6 text-ds-ink-muted">A Meta não disponibilizou esta quebra para a conta neste momento.</p>
                        ) : rows.length === 0 ? (
                          <p className="mt-3 rounded-ds-btn-lg bg-ds-warm p-4 text-sm leading-6 text-ds-ink-muted">Nenhuma localidade foi retornada para esta janela.</p>
                        ) : (
                          <ol className="mt-4 space-y-3">
                            {ranked.map((row) => {
                              const share = demographicShare(row.value, rows);
                              const label = row.dimensions[dimension] ?? "Não informado";
                              return <li key={label} className="grid grid-cols-[minmax(0,1fr)_54px] items-center gap-x-3 gap-y-1 text-sm"><span className="truncate font-semibold text-ds-ink">{label}</span><b className="text-right text-ds-ink-muted">{percentage(share)}</b><span className="col-span-2 h-2 overflow-hidden rounded-full bg-ds-muted"><i className="block h-full rounded-full bg-ds-info" style={{ width: `${share ?? 0}%` }} /></span></li>;
                            })}
                          </ol>
                        )}
                      </section>
                    );
                  })}
                </div>
              </>
            ) : null}
          </section>
          </> : null}

          {section === "results" ? <>
          <section className="rounded-ds-card-lg border border-ds-border bg-white p-4 md:p-5" aria-labelledby="views-follow-type-title">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="views-follow-type-title" className="text-lg font-bold tracking-tight text-ds-ink">Quem gerou as visualizações</h2>
              <InfoTooltip title="Visualizações por tipo de público"><p>Esta quebra compara visualizações atribuídas a seguidores e a não seguidores. Não é a divisão entre orgânico e anúncios; a Meta não devolveu essa origem nesta métrica.</p></InfoTooltip>
            </div>
            <p className="mt-1 text-xs leading-5 text-ds-ink-muted">O que ajuda a entender se o conteúdo circulou para além da comunidade atual.</p>
            {report.viewsByFollowType.followers === null && report.viewsByFollowType.nonFollowers === null ? (
              <p className="mt-4 rounded-ds-btn-lg bg-ds-warm p-4 text-sm leading-6 text-ds-ink-muted">{yearSelected ? "A série histórica importada não inclui esta divisão. Selecione um recorte recente para consultar o detalhamento da API." : "A Meta não retornou esta divisão para o período consultado."}</p>
            ) : (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <article className="rounded-ds-btn-lg bg-ds-warm p-4"><p className="text-xs font-bold text-ds-ink-muted">Seguidores</p><strong className="mt-1 block text-2xl text-ds-ink">{amount(report.viewsByFollowType.followers)}</strong></article>
                  <article className="rounded-ds-btn-lg bg-ds-warm p-4"><p className="text-xs font-bold text-ds-ink-muted">Não seguidores</p><strong className="mt-1 block text-2xl text-ds-ink">{amount(report.viewsByFollowType.nonFollowers)}</strong></article>
                </div>
                {followerViewShare !== null ? <div className="mt-4"><div className="flex h-3 overflow-hidden rounded-full bg-ds-muted" role="img" aria-label={`Seguidores ${percentage(followerViewShare)} e não seguidores ${percentage(100 - followerViewShare)}`}><span className="bg-ds-accent-ink" style={{ width: `${followerViewShare}%` }} /><span className="bg-ds-info" style={{ width: `${100 - followerViewShare}%` }} /></div><p className="mt-2 text-xs text-ds-ink-muted">Seguidores {percentage(followerViewShare)} · Não seguidores {percentage(100 - followerViewShare)} das visualizações classificadas.</p></div> : null}
              </>
            )}
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,.55fr)]">
            <div className="rounded-ds-card-lg border border-ds-border bg-white p-4 md:p-5">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-ds-ink">Alcance diário</h2>
                  <p className="mt-1 text-xs text-ds-ink-muted">Pessoas alcançadas em cada dia; não some os pontos para obter alcance único.</p>
                </div>
                {reading?.discovery.value !== null && reading?.discovery.date ? <p className="rounded-lg bg-ds-accent-soft px-3 py-2 text-xs font-semibold text-ds-accent-ink">Pico: {amount(reading.discovery.value)} em {date(reading.discovery.date)}</p> : null}
              </div>
              {report.reachSeries.length ? (
                <div className="mt-5 h-64 w-full" role="img" aria-label="Gráfico de alcance diário no período selecionado">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={report.reachSeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <defs>
                        <linearGradient id="instagramReachFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--ds-accent)" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="var(--ds-accent)" stopOpacity={0.03} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="var(--ds-divider)" strokeDasharray="3 3" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={30} tick={{ fill: "var(--ds-ink-muted)", fontSize: 11 }} tickFormatter={(value: string) => date(value)} />
                      <YAxis axisLine={false} tickLine={false} width={52} tick={{ fill: "var(--ds-ink-muted)", fontSize: 11 }} tickFormatter={(value: number) => compactNumberFormatter.format(value)} />
                      <Tooltip
                        cursor={{ stroke: "var(--ds-accent-ink)", strokeDasharray: "3 3" }}
                        contentStyle={{ border: "1px solid var(--ds-border)", borderRadius: 12, boxShadow: "var(--ds-shadow-menu)" }}
                        labelFormatter={(value) => date(String(value), { year: true })}
                        formatter={(value) => [amount(typeof value === "number" ? value : Number(value)), "Alcance"]}
                      />
                      <Area type="monotone" dataKey="value" stroke="var(--ds-accent-ink)" strokeWidth={2.5} fill="url(#instagramReachFill)" activeDot={{ r: 4, fill: "var(--ds-accent-ink)", stroke: "var(--ds-surface)", strokeWidth: 2 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="mt-4 rounded-ds-btn-lg bg-ds-warm p-4 text-sm text-ds-ink-muted">A Meta não retornou a série diária para este período.</p>
              )}
            </div>

            <div className="rounded-ds-card-lg border border-ds-border bg-white p-4 md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <MousePointerClick aria-hidden="true" className="h-5 w-5 text-ds-accent-ink" />
                  <div>
                    <h2 className="text-lg font-bold tracking-tight text-ds-ink">Conversão da bio</h2>
                    <p className="mt-1 text-xs text-ds-ink-muted">Eventos medidos no site oficial.</p>
                  </div>
                </div>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide", bioHasCoverage ? "bg-ds-ok-bg text-ds-ok" : "bg-ds-warn-bg text-ds-warn")}>{bioHasCoverage ? `${report.bio.daily.length} dias` : "Sem cobertura"}</span>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-ds-btn-lg bg-ds-warm p-3"><strong className="block text-xl text-ds-ink">{amount(publicBioMetric(report.bio, "pageViews"))}</strong><span className="text-[11px] text-ds-ink-muted">visitas</span></div>
                <div className="rounded-ds-btn-lg bg-ds-warm p-3"><strong className="block text-xl text-ds-ink">{amount(publicBioMetric(report.bio, "linkClicks"))}</strong><span className="text-[11px] text-ds-ink-muted">cliques</span></div>
                <div className="rounded-ds-btn-lg bg-ds-warm p-3"><strong className="block text-xl text-ds-ink">{report.bio.daily.length && report.bio.clickThroughRate !== null ? `${(report.bio.clickThroughRate * 100).toFixed(1)}%` : "—"}</strong><span className="text-[11px] text-ds-ink-muted">conversão</span></div>
              </div>

              {!bioHasCoverage ? (
                <p className="mt-4 rounded-ds-btn-lg border border-ds-alert-border bg-ds-alert-bg p-3 text-xs leading-5 text-ds-alert-ink">Ainda não há dias coletados para a bio neste período. Os campos ficam indisponíveis para não confundir ausência de medição com zero.</p>
              ) : (
                <>
                  <h3 className="mt-5 text-xs font-extrabold uppercase tracking-[0.08em] text-ds-ink-muted">Links mais acionados</h3>
                  {report.bio.topLinks.length ? <ol className="mt-2 space-y-2">{report.bio.topLinks.map((link, index) => <li key={link.id} className="flex items-center gap-2 text-sm"><span className="grid h-6 w-6 place-items-center rounded-full bg-ds-accent-soft text-[10px] font-extrabold text-ds-accent-ink">{index + 1}</span><span className="min-w-0 flex-1 truncate font-semibold text-ds-ink">{link.label}</span><b>{amount(link.clicks)}</b></li>)}</ol> : <p className="mt-2 text-sm text-ds-ink-muted">Nenhum clique registrado neste período.</p>}
                </>
              )}
            </div>
          </section>

          </> : null}

          {section === "content" ? <>
          <section aria-labelledby="content-analysis-title" className="grid gap-5 xl:grid-cols-[minmax(0,.8fr)_minmax(340px,.55fr)]">
            <div className="rounded-ds-card-lg border border-ds-border bg-white p-4 md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-ds-accent-ink">Diagnóstico de conteúdo</p>
                  <div className="mt-1 flex items-center gap-2">
                    <h2 id="content-analysis-title" className="text-lg font-bold tracking-tight text-ds-ink">Resposta por formato — amostra recente</h2>
                    <InfoTooltip title="Como comparar formatos"><p>Este resumo usa até 18 conteúdos recentes retornados para a visão geral, não o arquivo completo. Publicações mais antigas tiveram mais tempo para acumular resultados; use os marcos de 48 horas, 7 e 30 dias para comparações equivalentes.</p></InfoTooltip>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-ds-ink-muted">Ajuda a separar frequência de publicação e resposta média observada na amostra carregada.</p>
                </div>
                <span className="rounded-full bg-ds-muted px-2.5 py-1 text-xs font-bold text-ds-ink-muted">{report.content.length} posts</span>
              </div>

              {formatSummaries.length ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-ds-ink-muted"><tr><th className="pb-2">Formato</th><th className="pb-2 text-right">Posts</th><th className="pb-2 text-right">Visualizações</th><th className="pb-2 text-right">Interações</th><th className="pb-2 text-right">Média/post</th></tr></thead>
                    <tbody className="divide-y divide-ds-divider">
                      {formatSummaries.map((format) => <tr key={format.format}><th className="py-3 font-bold text-ds-ink">{format.format}</th><td className="py-3 text-right text-ds-ink-muted">{format.contentCount}</td><td className="py-3 text-right font-semibold text-ds-ink">{amount(format.views)}</td><td className="py-3 text-right font-semibold text-ds-ink">{amount(format.interactions)}</td><td className="py-3 text-right font-semibold text-ds-ink">{format.averageInteractions === null ? "—" : numberFormatter.format(format.averageInteractions)}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              ) : <p className="mt-4 rounded-ds-btn-lg bg-ds-warm p-4 text-sm text-ds-ink-muted">Ainda não há conteúdos comparáveis neste recorte.</p>}
            </div>

            <div className="rounded-ds-card-lg border border-ds-border bg-ds-dark p-4 text-white md:p-5">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-ds-accent-kicker">Conteúdo em destaque</p>
              {reading?.topContent ? (
                <>
                  <div className="mt-3 flex items-start gap-3">
                    {reading.topContent.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={reading.topContent.previewUrl} alt="" className="h-20 w-16 rounded-ds-btn-lg object-cover" />
                    ) : <span className="grid h-20 w-16 shrink-0 place-items-center rounded-ds-btn-lg bg-white/10"><Eye aria-hidden="true" className="h-5 w-5 text-white/60" /></span>}
                    <div className="min-w-0"><span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold">{reading.topContent.format}</span><p className="mt-2 line-clamp-3 text-sm font-semibold leading-5">{reading.topContent.caption || "Sem legenda"}</p></div>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-ds-btn-lg bg-white/10 p-3"><dt className="text-[10px] text-white/65">Visualizações</dt><dd className="mt-1 font-bold">{amount(reading.topContent.views)}</dd></div><div className="rounded-ds-btn-lg bg-white/10 p-3"><dt className="text-[10px] text-white/65">Alcance</dt><dd className="mt-1 font-bold">{amount(reading.topContent.reach)}</dd></div><div className="rounded-ds-btn-lg bg-white/10 p-3"><dt className="text-[10px] text-white/65">Interações</dt><dd className="mt-1 font-bold">{amount(reading.topContent.totalInteractions)}</dd></div></dl>
                  <p className="mt-3 text-xs leading-5 text-white/65">Destaque por interações entre os 18 conteúdos recentes da amostra; isso não prova sozinho qual tema causou o resultado.</p>
                </>
              ) : <p className="mt-3 text-sm leading-6 text-white/70">A Meta ainda não retornou interações suficientes para destacar um conteúdo.</p>}
            </div>
          </section>

          <section className="space-y-3" aria-labelledby="all-content-title">
            <div>
              <h2 id="all-content-title" className="text-lg font-bold tracking-tight text-ds-ink">Todas as publicações</h2>
              <p className="mt-1 text-sm leading-6 text-ds-ink-muted">Feed, carrosséis e Reels publicados no período. A lista consulta 25 itens por vez e não depende da amostra do resumo.</p>
            </div>
            {contentError ? <div role="alert" className="rounded-ds-btn-lg border border-ds-confirm-border bg-ds-confirm-bg p-3 text-sm text-ds-confirm-ink">{contentError}<button type="button" onClick={() => onLoadContent(contentPageCurrent ? null : contentPage?.nextAfter ?? null)} className="ml-2 font-bold underline">Tentar novamente</button></div> : null}
            {contentLoading && !contentPageCurrent ? <div className="flex items-center gap-2 rounded-ds-card-lg border border-ds-border bg-white p-8 text-sm text-ds-ink-muted"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Carregando publicações…</div> : null}
            {contentPageCurrent ? <ContentList title={`Publicações carregadas (${contentPage.items.length})`} items={contentPage.items} /> : null}
            {contentPageCurrent && contentPage.hasMore ? <div className="flex justify-center"><Button type="button" variant="ds-secondary" onClick={() => onLoadContent(contentPage.nextAfter)} disabled={contentLoading}>{contentLoading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}Carregar mais 25 publicações</Button></div> : null}
            {contentPageCurrent && !contentPage.hasMore && !contentLoading ? <p className="text-center text-xs text-ds-ink-muted">Fim das publicações disponíveis para este período.</p> : null}
          </section>

          {report.activeStories.length ? <ContentList title="Stories ativos" items={report.activeStories} /> : null}
          {report.history.stories.length ? <ContentList title="Stories preservados" items={report.history.stories} /> : null}
          {report.history.contentSnapshots.length ? <ContentList title="Marcos históricos de Feed e Reels" items={report.history.contentSnapshots} /> : null}
          </> : null}

          {section === "results" ? <>
          <section className="rounded-ds-card-lg border border-ds-border bg-ds-warm p-4 md:p-5" aria-labelledby="coverage-title">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-ds-accent-ink">Qualidade dos dados</p>
                <h2 id="coverage-title" className="mt-1 text-lg font-bold tracking-tight text-ds-ink">Cobertura histórica própria</h2>
                <p className="mt-1 text-sm leading-6 text-ds-ink-muted">A Meta fornece o recorte atual. A base própria preserva a evolução desde a ativação do coletor e deve deixar qualquer lacuna explícita.</p>
              </div>
              <dl className="grid grid-cols-3 gap-2 sm:min-w-[420px]">
                <div className="rounded-ds-btn-lg bg-white p-3 text-center"><dt className="text-[10px] font-bold uppercase tracking-wide text-ds-ink-muted">Dias guardados</dt><dd className="mt-1 text-xl font-bold text-ds-ink">{coverage?.capturedDays ?? 0}</dd></div>
                <div className="rounded-ds-btn-lg bg-white p-3 text-center"><dt className="text-[10px] font-bold uppercase tracking-wide text-ds-ink-muted">Stories</dt><dd className="mt-1 text-xl font-bold text-ds-ink">{report.history.stories.length}</dd></div>
                <div className="rounded-ds-btn-lg bg-white p-3 text-center"><dt className="text-[10px] font-bold uppercase tracking-wide text-ds-ink-muted">Marcos</dt><dd className="mt-1 text-xl font-bold text-ds-ink">{report.history.contentSnapshots.length}</dd></div>
              </dl>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ds-ink-muted">
              <span className={cn("rounded-full px-2.5 py-1 font-bold", coverage?.complete ? "bg-ds-ok-bg text-ds-ok" : "bg-ds-warn-bg text-ds-warn")}>{coverage?.complete ? "Período coberto" : "Cobertura parcial"}</span>
              {coverage?.firstDate && coverage.lastDate ? <span>Base disponível de {date(coverage.firstDate, { year: true })} a {date(coverage.lastDate, { year: true })}.</span> : <span>A base histórica ainda não possui dias preservados.</span>}
            </div>
          </section>

          <aside className="rounded-ds-card-lg border border-ds-border bg-ds-muted p-4 text-xs leading-5 text-ds-ink-muted">
            <strong className="mb-1 block text-ds-ink">Como interpretar</strong>
            {report.notices.map((notice) => <p key={notice}>{notice}</p>)}
          </aside>
          </> : null}

          {section === "ads" ? (
            <section className="space-y-4" aria-labelledby="instagram-ads-title">
              <div className="rounded-ds-card-lg border border-ds-border bg-white p-4 md:p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ds-btn-lg bg-ds-accent-soft text-ds-accent-ink"><Megaphone aria-hidden="true" className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><h2 id="instagram-ads-title" className="text-lg font-bold tracking-tight text-ds-ink">Anúncios</h2><InfoTooltip title="Sobre os dados de anúncios"><p>Os números vêm da conta de anúncios autorizada e usam o mesmo período selecionado. Esta tela é somente leitura; não cria nem altera campanhas.</p></InfoTooltip></div>
                    <p className="mt-1 text-sm leading-6 text-ds-ink-muted">Impressões são exibições de anúncios; alcance é a estimativa de contas únicas; cliques e gasto descrevem a entrega paga. Estes dados são separados das visualizações orgânicas do Instagram.</p>
                    {ads?.period === period ? <p className="mt-2 text-xs text-ds-ink-muted">{ads.accountName ? `Conta: ${ads.accountName} · ` : ""}{date(`${ads.since}T12:00:00.000Z`, { year: true })} – {date(`${ads.until}T12:00:00.000Z`, { year: true })}</p> : null}
                  </div>
                  <Button type="button" variant="ds-secondary" size="md" onClick={onLoadAds} disabled={adsLoading} className="shrink-0">{adsLoading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <RefreshCw aria-hidden="true" className="h-4 w-4" />}Atualizar</Button>
                </div>
                {adsError ? <div role="alert" className="mt-4 rounded-ds-btn-lg border border-ds-confirm-border bg-ds-confirm-bg p-3 text-sm text-ds-confirm-ink">{adsError}</div> : null}
                {adsLoading && ads?.period !== period ? <div className="mt-4 flex items-center gap-2 rounded-ds-btn-lg bg-ds-warm p-4 text-sm text-ds-ink-muted"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Consultando a conta de anúncios…</div> : null}
                {!adsLoading && ads?.period !== period && !adsError ? <p className="mt-4 rounded-ds-btn-lg bg-ds-warm p-4 text-sm text-ds-ink-muted">Os dados serão consultados ao abrir esta seção.</p> : null}
                {ads?.period === period && ads.status === "empty" ? <p className="mt-4 rounded-ds-btn-lg border border-ds-alert-border bg-ds-alert-bg p-4 text-sm leading-6 text-ds-alert-ink">A Meta não retornou linhas de entrega paga neste período. Mantemos os indicadores indisponíveis em vez de afirmar que o valor foi zero.</p> : null}
                {ads?.period === period && ads.status === "no_account" ? <p className="mt-4 rounded-ds-btn-lg bg-ds-warm p-4 text-sm leading-6 text-ds-ink-muted">Nenhuma conta de anúncios ativa foi encontrada para esta conexão.</p> : null}
                {ads?.period === period && ads.status === "multiple_accounts" ? <p className="mt-4 rounded-ds-btn-lg bg-ds-warm p-4 text-sm leading-6 text-ds-ink-muted">Há mais contas de anúncios do que esta consulta pode confirmar. Para evitar misturar resultados, nenhuma conta foi escolhida automaticamente.</p> : null}
                {ads?.period === period && ads.status === "unavailable" ? <p className="mt-4 rounded-ds-btn-lg bg-ds-warm p-4 text-sm leading-6 text-ds-ink-muted">A Meta não disponibilizou o relatório da conta autorizada. Confira se ela está conectada e se a permissão de leitura de anúncios continua ativa.</p> : null}
                {ads?.period === period && ads.status === "available" ? (
                  <>
                    <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                      <MetricCard label="Gasto" value={ads.totals?.spend ?? null} icon={CircleDollarSign} helper={ads.currency ?? "Moeda da conta"} formatValue={(value) => currency(value, ads.currency)} explanation="Valor reportado pela conta de anúncios no período. Não inclui vendas atribuídas fora do relatório da Meta." />
                      <MetricCard label="Impressões" value={ads.totals?.impressions ?? null} icon={Eye} helper="Exibições pagas." explanation="Número de vezes que os anúncios foram exibidos; uma pessoa pode gerar várias impressões." />
                      <MetricCard label="Alcance pago" value={ads.totals?.reach ?? null} icon={Users} helper="Contas únicas estimadas." explanation="Contas que receberam anúncios. É uma métrica separada do alcance orgânico do Instagram." />
                      <MetricCard label="Cliques" value={ads.totals?.clicks ?? null} icon={MousePointerClick} helper="Cliques reportados." explanation="Cliques contabilizados pela Meta na entrega de anúncios." />
                      <MetricCard label="CTR" value={ads.totals?.ctr ?? null} icon={TrendingUp} helper="Taxa de cliques reportada." formatValue={percentage} explanation="Percentual de cliques em relação às impressões conforme o cálculo da Meta." />
                    </div>
                    <div className="mt-5 overflow-x-auto">
                      <div className="mb-2 flex items-center justify-between gap-3"><h3 className="font-bold text-ds-ink">Campanhas no período</h3>{ads.hasMoreCampaigns ? <span className="text-xs text-ds-ink-muted">Lista limitada a 25 campanhas</span> : null}</div>
                      {ads.campaigns.length ? <table className="w-full min-w-[640px] text-left text-sm"><thead className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-ds-ink-muted"><tr><th className="pb-2">Campanha</th><th className="pb-2">Objetivo</th><th className="pb-2 text-right">Impressões</th><th className="pb-2 text-right">Cliques</th><th className="pb-2 text-right">Gasto</th></tr></thead><tbody className="divide-y divide-ds-divider">{ads.campaigns.map((campaign, index) => <tr key={`${campaign.name}-${index}`}><th className="max-w-[300px] truncate py-3 font-semibold text-ds-ink">{campaign.name}</th><td className="py-3 text-ds-ink-muted">{campaign.objective ?? "—"}</td><td className="py-3 text-right text-ds-ink">{amount(campaign.impressions)}</td><td className="py-3 text-right text-ds-ink">{amount(campaign.clicks)}</td><td className="py-3 text-right font-semibold text-ds-ink">{currency(campaign.spend, ads.currency)}</td></tr>)}</tbody></table> : <p className="rounded-ds-btn-lg bg-ds-warm p-4 text-sm text-ds-ink-muted">Há métricas de conta, mas nenhuma linha de campanha retornada para esse período.</p>}
                    </div>
                  </>
                ) : null}
              </div>
            </section>
          ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
