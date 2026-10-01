"use client";

import {
  Activity,
  BarChart3,
  CalendarDays,
  ExternalLink,
  Eye,
  HeartHandshake,
  Instagram,
  Lightbulb,
  Loader2,
  MousePointerClick,
  RefreshCw,
  Share2,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { cn } from "@/lib/utils";

import type {
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
  loading: boolean;
  error: string | null;
  onPeriodChange: (period: InstagramInsightsPeriod) => void;
  onRefresh: () => void;
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
};

function MetricCard({ label, value, icon: Icon, helper, explanation }: MetricCardProps) {
  return (
    <article className="rounded-2xl border border-[#eadfd3] bg-white p-4 shadow-[0_1px_2px_rgba(74,26,4,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#7a5646]">{label}</p>
          {explanation ? (
            <InfoTooltip title={`O que significa ${label.toLowerCase()}`}>
              <p>{explanation}</p>
            </InfoTooltip>
          ) : null}
        </div>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#fff0f6] text-[#d90f6f]">
          <Icon aria-hidden="true" className="h-4 w-4" />
        </span>
      </div>
      <strong className="mt-3 block text-[28px] font-bold leading-none tracking-tight text-[#4a1a04]">{amount(value)}</strong>
      {helper ? <p className="mt-2 text-xs leading-5 text-[#8a6756]">{helper}</p> : null}
    </article>
  );
}

function ContentList({ title, items }: { title: string; items: InstagramInsightContentItem[] }) {
  return (
    <section className="rounded-2xl border border-[#eadfd3] bg-white p-4 shadow-sm md:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight text-[#4a1a04]">{title}</h2>
            <InfoTooltip title="Como comparar os conteúdos">
              <p>Use alcance e visualizações para entender distribuição; interações, compartilhamentos e salvamentos indicam a resposta gerada.</p>
              <p>Quando houver um marco de 48 horas, 7 ou 30 dias, compare apenas conteúdos observados na mesma janela.</p>
            </InfoTooltip>
          </div>
          <p className="mt-1 text-xs text-[#8a6756]">Compare formatos e identifique os conteúdos que merecem repetição.</p>
        </div>
        <span className="rounded-full bg-[#f4ece2] px-2.5 py-1 text-xs font-bold text-[#7a5646]">{items.length}</span>
      </div>

      {items.length ? (
        <div className="divide-y divide-[#efe5db]">
          {items.map((item) => (
            <article key={item.id} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[72px_minmax(0,1fr)_auto]">
              <div className="h-20 w-16 overflow-hidden rounded-xl bg-[#f4ece2] lg:w-[72px]">
                {item.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center"><Eye aria-hidden="true" className="h-5 w-5 text-[#bda898]" /></div>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[#fde3ef] px-2 py-0.5 text-[10px] font-extrabold text-[#b80e61]">{item.format}</span>
                  {snapshotStage(item) ? <span className="rounded-full bg-[#f4ece2] px-2 py-0.5 text-[10px] font-extrabold text-[#7a5646]">{snapshotStage(item)}</span> : null}
                  <span className="text-xs font-semibold text-[#8a6756]">{date(item.publishedAt)}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-[#4a1a04]">{item.caption || "Sem legenda"}</p>
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#7a5646]">
                  <div className="flex gap-1"><dt>Alcance</dt><dd className="font-bold text-[#4a1a04]">{amount(item.reach)}</dd></div>
                  <div className="flex gap-1"><dt>Visualizações</dt><dd className="font-bold text-[#4a1a04]">{amount(item.views)}</dd></div>
                  <div className="flex gap-1"><dt>Interações</dt><dd className="font-bold text-[#4a1a04]">{amount(item.totalInteractions)}</dd></div>
                  <div className="flex gap-1"><dt>Curtidas</dt><dd className="font-bold text-[#4a1a04]">{amount(item.likes)}</dd></div>
                  <div className="flex gap-1"><dt>Comentários</dt><dd className="font-bold text-[#4a1a04]">{amount(item.comments)}</dd></div>
                  <div className="flex gap-1"><dt>Compart.</dt><dd className="font-bold text-[#4a1a04]">{amount(item.shares)}</dd></div>
                  <div className="flex gap-1"><dt>Salvos</dt><dd className="font-bold text-[#4a1a04]">{amount(item.saves)}</dd></div>
                  {item.format === "Story" ? (
                    <>
                      <div className="flex gap-1"><dt>Respostas</dt><dd className="font-bold text-[#4a1a04]">{amount(item.replies)}</dd></div>
                      <div className="flex gap-1"><dt>Link do Story</dt><dd className="font-bold text-[#4a1a04]">{amount(item.storyLinkClicks)}</dd></div>
                      <div className="flex gap-1"><dt>Bio após Story</dt><dd className="font-bold text-[#4a1a04]">{amount(item.bioLinkClicks)}</dd></div>
                    </>
                  ) : null}
                </dl>
              </div>
              {item.permalink ? (
                <a href={item.permalink} target="_blank" rel="noopener noreferrer" aria-label="Abrir publicação no Instagram" className="hidden h-9 w-9 place-items-center rounded-xl border border-[#eadfd3] text-[#7a5646] transition hover:bg-[#f4ece2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d90f6f] lg:grid">
                  <ExternalLink aria-hidden="true" className="h-4 w-4" />
                </a>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="rounded-xl bg-[#faf5ef] p-4 text-sm text-[#7a5646]">Nenhum conteúdo disponível neste período.</p>
      )}
    </section>
  );
}

export function InsightsView({ report, period, loading, error, onPeriodChange, onRefresh }: InsightsViewProps) {
  const coverage = report ? summarizeInstagramHistoryCoverage(report.history.daily, report.range.days) : null;
  const reading = report ? buildInstagramInsightReading(report) : null;
  const formatSummaries = report ? summarizeInstagramContentFormats(report.content) : [];
  const bioHasCoverage = Boolean(report?.bio.daily.length);
  const yearSelected = period === "year";
  const netFollowers = report?.totals.follows !== null && report?.totals.follows !== undefined
    && report.totals.unfollows !== null && report.totals.unfollows !== undefined
    ? report.totals.follows - report.totals.unfollows
    : null;

  return (
    <PageContainer variant="wide" className="px-4 py-5 md:px-6 md:py-7" aria-busy={loading}>
      <PageHeader
        title="Insights do Instagram"
        description="Entenda como as pessoas descobriram, responderam e avançaram a partir do conteúdo — com a origem e a cobertura de cada dado."
        actions={(
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            className="h-9 rounded-[11px] border-[#dedfe4] bg-white px-3 text-[13px] font-extrabold text-[#4a1a04]"
          >
            {loading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <RefreshCw aria-hidden="true" className="h-4 w-4" />}
            Atualizar
          </Button>
        )}
      />

      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-[#eadfd3] bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-[#6b4938]">
          <CalendarDays aria-hidden="true" className="h-4 w-4 text-[#d90f6f]" />
          <span className="font-semibold">{report ? periodLabel(report) : "Selecione o período"}</span>
        </div>
        <div role="group" aria-label="Período do relatório" className="grid grid-cols-4 rounded-xl bg-[#f6f1eb] p-1">
          {([7, 30, 90, "year"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={period === option}
              onClick={() => onPeriodChange(option)}
              className={cn(
                "rounded-lg px-3 py-2 text-xs font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d90f6f]",
                period === option ? "bg-[#4a1a04] text-white shadow-sm" : "text-[#7a5646] hover:bg-white",
              )}
            >
              {option === "year" ? "Este ano" : `${option} dias`}
            </button>
          ))}
        </div>
      </div>

      {error ? <div role="alert" className="mt-5 rounded-xl border border-[#e8b9b3] bg-[#fbe4e1] p-4 text-sm font-semibold text-[#a52e24]">{error}</div> : null}
      {loading && !report ? <div className="mt-8 flex items-center justify-center gap-2 rounded-2xl border border-[#eadfd3] bg-white p-12 text-[#7a5646]"><Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />Consultando a Meta e os acessos da bio…</div> : null}

      {report ? (
        <div className="mt-5 space-y-5">
          <section className="overflow-hidden rounded-2xl bg-[#4a1a04] text-white shadow-sm">
            <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                {report.profile.profilePictureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={report.profile.profilePictureUrl} alt="" className="h-12 w-12 rounded-full border-2 border-white/50 object-cover" />
                ) : (
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-white/15"><Instagram aria-hidden="true" className="h-5 w-5" /></div>
                )}
                <div>
                  <strong className="block text-lg font-bold">@{report.profile.username}</strong>
                  <span className="text-xs text-white/70">Conta profissional conectada</span>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                <div><dt className="text-xs text-white/65">Seguidores atuais</dt><dd className="mt-1 text-xl font-bold">{amount(report.profile.followersCount)}</dd></div>
                <div><dt className="text-xs text-white/65">Publicações</dt><dd className="mt-1 text-xl font-bold">{amount(report.profile.mediaCount)}</dd></div>
              </dl>
            </div>
            <div className="border-t border-white/10 bg-white/5 px-5 py-2.5 text-xs text-white/70">Dados atuais da conta e métricas consolidadas pela Meta para o período selecionado.</div>
          </section>

          <section aria-labelledby="period-reading-title" className="rounded-2xl border border-[#eadfd3] bg-white p-4 shadow-sm md:p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#fff0f6] text-[#d90f6f]">
                <Sparkles aria-hidden="true" className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-[#d90f6f]">Leitura do período</p>
                <h2 id="period-reading-title" className="mt-1 text-lg font-bold tracking-tight text-[#4a1a04]">Do alcance à ação</h2>
                <p className="mt-1 text-sm leading-6 text-[#7a5646]">Estes sinais conectam descoberta, resposta ao conteúdo e intenção de avançar pelo perfil.</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <article className="rounded-xl bg-[#faf5ef] p-4">
                <div className="flex items-center gap-2 text-[#9f1158]"><TrendingUp aria-hidden="true" className="h-4 w-4" /><span className="text-[11px] font-extrabold uppercase tracking-[0.08em]">Descoberta</span></div>
                <strong className="mt-3 block text-2xl text-[#4a1a04]">{amount(reading?.discovery.value)}</strong>
                <p className="mt-1 text-xs leading-5 text-[#7a5646]">Maior alcance diário{reading?.discovery.date ? `, em ${date(reading.discovery.date)}` : " ainda não identificado"}.</p>
              </article>
              <article className="rounded-xl bg-[#faf5ef] p-4">
                <div className="flex items-center gap-2 text-[#9f1158]"><HeartHandshake aria-hidden="true" className="h-4 w-4" /><span className="text-[11px] font-extrabold uppercase tracking-[0.08em]">Resposta</span></div>
                <strong className="mt-3 block text-2xl text-[#4a1a04]">{percentage(reading?.interactionsPerHundredViews)}</strong>
                <p className="mt-1 text-xs leading-5 text-[#7a5646]">Interações a cada 100 visualizações; é uma relação de leitura, não uma taxa oficial da Meta.</p>
              </article>
              <article className="rounded-xl bg-[#faf5ef] p-4">
                <div className="flex items-center gap-2 text-[#9f1158]"><MousePointerClick aria-hidden="true" className="h-4 w-4" /><span className="text-[11px] font-extrabold uppercase tracking-[0.08em]">Ação no perfil</span></div>
                <strong className="mt-3 block text-2xl text-[#4a1a04]">{percentage(reading?.profileClickRate)}</strong>
                <p className="mt-1 text-xs leading-5 text-[#7a5646]">Cliques no link em relação às visitas ao perfil registradas pela Meta.</p>
              </article>
            </div>

            <div className="mt-3 flex items-start gap-3 rounded-xl border border-[#f1d59c] bg-[#fff8e8] p-4">
              <Lightbulb aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#a66a08]" />
              <div>
                <strong className="text-sm text-[#5f3b05]">Próxima ação sugerida</strong>
                <p className="mt-1 text-sm leading-6 text-[#76500b]">{reading?.recommendation}</p>
              </div>
            </div>
          </section>

          <section aria-labelledby="instagram-performance-title">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-[#d90f6f]">Resultados</p>
                <h2 id="instagram-performance-title" className="mt-1 text-lg font-bold tracking-tight text-[#4a1a04]">Desempenho no Instagram</h2>
              </div>
              <p className="text-xs text-[#8a6756]">A Meta pode levar até 48 horas para consolidar os dados.</p>
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

          <section aria-labelledby="instagram-growth-title" className="rounded-2xl border border-[#eadfd3] bg-white p-4 shadow-sm md:p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-[#d90f6f]">Audiência</p>
                <h2 id="instagram-growth-title" className="mt-1 text-lg font-bold tracking-tight text-[#4a1a04]">Crescimento da comunidade</h2>
              </div>
              <p className="text-xs text-[#8a6756]">Ganhos, perdas e saldo são conceitos diferentes.</p>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl bg-[#faf5ef] p-4"><dt className="text-xs font-bold text-[#7a5646]">Seguidores atuais</dt><dd className="mt-2 text-2xl font-bold text-[#4a1a04]">{amount(report.profile.followersCount)}</dd><p className="mt-1 text-xs leading-5 text-[#8a6756]">Tamanho atual da comunidade, não o ganho do período.</p></div>
              <div className="rounded-xl bg-[#faf5ef] p-4"><dt className="flex items-center gap-1.5 text-xs font-bold text-[#7a5646]">Novos seguidores<InfoTooltip title="Como ler novos seguidores"><p>Contabiliza as pessoas que começaram a seguir a conta no período. O valor não desconta quem deixou de seguir.</p></InfoTooltip></dt><dd className="mt-2 text-2xl font-bold text-[#4a1a04]">{amount(report.totals.follows)}</dd></div>
              <div className="rounded-xl bg-[#faf5ef] p-4"><dt className="flex items-center gap-1.5 text-xs font-bold text-[#7a5646]">Deixaram de seguir<InfoTooltip title="Como ler as perdas"><p>Contabiliza as pessoas que deixaram de seguir a conta. A exportação anual fornecida não contém essa série e, nesse caso, o valor fica indisponível.</p></InfoTooltip></dt><dd className="mt-2 text-2xl font-bold text-[#4a1a04]">{amount(report.totals.unfollows)}</dd></div>
              <div className="rounded-xl bg-[#faf5ef] p-4"><dt className="flex items-center gap-1.5 text-xs font-bold text-[#7a5646]">Saldo do período<InfoTooltip title="Como o saldo é calculado"><p>Novos seguidores menos pessoas que deixaram de seguir. Só é exibido quando os dois valores estão disponíveis.</p></InfoTooltip></dt><dd className="mt-2 text-2xl font-bold text-[#4a1a04]">{amount(netFollowers)}</dd></div>
            </dl>
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,.55fr)]">
            <div className="rounded-2xl border border-[#eadfd3] bg-white p-4 shadow-sm md:p-5">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-[#4a1a04]">Alcance diário</h2>
                  <p className="mt-1 text-xs text-[#8a6756]">Pessoas alcançadas em cada dia; não some os pontos para obter alcance único.</p>
                </div>
                {reading?.discovery.value !== null && reading?.discovery.date ? <p className="rounded-lg bg-[#fff0f6] px-3 py-2 text-xs font-semibold text-[#9f1158]">Pico: {amount(reading.discovery.value)} em {date(reading.discovery.date)}</p> : null}
              </div>
              {report.reachSeries.length ? (
                <div className="mt-5 h-64 w-full" role="img" aria-label="Gráfico de alcance diário no período selecionado">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={report.reachSeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <defs>
                        <linearGradient id="instagramReachFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f462a7" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#f462a7" stopOpacity={0.03} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="#eee4db" strokeDasharray="3 3" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={30} tick={{ fill: "#8a6756", fontSize: 11 }} tickFormatter={(value: string) => date(value)} />
                      <YAxis axisLine={false} tickLine={false} width={52} tick={{ fill: "#8a6756", fontSize: 11 }} tickFormatter={(value: number) => compactNumberFormatter.format(value)} />
                      <Tooltip
                        cursor={{ stroke: "#d90f6f", strokeDasharray: "3 3" }}
                        contentStyle={{ border: "1px solid #eadfd3", borderRadius: 12, boxShadow: "0 8px 24px rgba(74,26,4,.10)" }}
                        labelFormatter={(value) => date(String(value), { year: true })}
                        formatter={(value) => [amount(typeof value === "number" ? value : Number(value)), "Alcance"]}
                      />
                      <Area type="monotone" dataKey="value" stroke="#d90f6f" strokeWidth={2.5} fill="url(#instagramReachFill)" activeDot={{ r: 4, fill: "#d90f6f", stroke: "#fff", strokeWidth: 2 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="mt-4 rounded-xl bg-[#faf5ef] p-4 text-sm text-[#7a5646]">A Meta não retornou a série diária para este período.</p>
              )}
            </div>

            <div className="rounded-2xl border border-[#eadfd3] bg-white p-4 shadow-sm md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <MousePointerClick aria-hidden="true" className="h-5 w-5 text-[#d90f6f]" />
                  <div>
                    <h2 className="text-lg font-bold tracking-tight text-[#4a1a04]">Conversão da bio</h2>
                    <p className="mt-1 text-xs text-[#8a6756]">Eventos medidos no site oficial.</p>
                  </div>
                </div>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide", bioHasCoverage ? "bg-[#e7f6ed] text-[#267348]" : "bg-[#fff1d8] text-[#925d05]")}>{bioHasCoverage ? `${report.bio.daily.length} dias` : "Sem cobertura"}</span>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-[#faf5ef] p-3"><strong className="block text-xl text-[#4a1a04]">{amount(publicBioMetric(report.bio, "pageViews"))}</strong><span className="text-[11px] text-[#7a5646]">visitas</span></div>
                <div className="rounded-xl bg-[#faf5ef] p-3"><strong className="block text-xl text-[#4a1a04]">{amount(publicBioMetric(report.bio, "linkClicks"))}</strong><span className="text-[11px] text-[#7a5646]">cliques</span></div>
                <div className="rounded-xl bg-[#faf5ef] p-3"><strong className="block text-xl text-[#4a1a04]">{report.bio.daily.length && report.bio.clickThroughRate !== null ? `${(report.bio.clickThroughRate * 100).toFixed(1)}%` : "—"}</strong><span className="text-[11px] text-[#7a5646]">conversão</span></div>
              </div>

              {!bioHasCoverage ? (
                <p className="mt-4 rounded-xl border border-[#f1d59c] bg-[#fff8e8] p-3 text-xs leading-5 text-[#76500b]">Ainda não há dias coletados para a bio neste período. Os campos ficam indisponíveis para não confundir ausência de medição com zero.</p>
              ) : (
                <>
                  <h3 className="mt-5 text-xs font-extrabold uppercase tracking-[0.08em] text-[#7a5646]">Links mais acionados</h3>
                  {report.bio.topLinks.length ? <ol className="mt-2 space-y-2">{report.bio.topLinks.map((link, index) => <li key={link.id} className="flex items-center gap-2 text-sm"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#fde3ef] text-[10px] font-extrabold text-[#b80e61]">{index + 1}</span><span className="min-w-0 flex-1 truncate font-semibold text-[#4a1a04]">{link.label}</span><b>{amount(link.clicks)}</b></li>)}</ol> : <p className="mt-2 text-sm text-[#7a5646]">Nenhum clique registrado neste período.</p>}
                </>
              )}
            </div>
          </section>

          <section aria-labelledby="content-analysis-title" className="grid gap-5 xl:grid-cols-[minmax(0,.8fr)_minmax(340px,.55fr)]">
            <div className="rounded-2xl border border-[#eadfd3] bg-white p-4 shadow-sm md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-[#d90f6f]">Diagnóstico de conteúdo</p>
                  <div className="mt-1 flex items-center gap-2">
                    <h2 id="content-analysis-title" className="text-lg font-bold tracking-tight text-[#4a1a04]">Resposta por formato</h2>
                    <InfoTooltip title="Como comparar formatos"><p>Os totais usam apenas os conteúdos recentes retornados pela API da Meta.</p><p>Publicações mais antigas tiveram mais tempo para acumular resultados; use os marcos de 48 horas, 7 e 30 dias para comparações equivalentes.</p></InfoTooltip>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[#8a6756]">Ajuda a separar frequência de publicação e resposta média observada.</p>
                </div>
                <span className="rounded-full bg-[#f4ece2] px-2.5 py-1 text-xs font-bold text-[#7a5646]">{report.content.length} posts</span>
              </div>

              {formatSummaries.length ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#8a6756]"><tr><th className="pb-2">Formato</th><th className="pb-2 text-right">Posts</th><th className="pb-2 text-right">Visualizações</th><th className="pb-2 text-right">Interações</th><th className="pb-2 text-right">Média/post</th></tr></thead>
                    <tbody className="divide-y divide-[#efe5db]">
                      {formatSummaries.map((format) => <tr key={format.format}><th className="py-3 font-bold text-[#4a1a04]">{format.format}</th><td className="py-3 text-right text-[#6b4938]">{format.contentCount}</td><td className="py-3 text-right font-semibold text-[#4a1a04]">{amount(format.views)}</td><td className="py-3 text-right font-semibold text-[#4a1a04]">{amount(format.interactions)}</td><td className="py-3 text-right font-semibold text-[#4a1a04]">{format.averageInteractions === null ? "—" : numberFormatter.format(format.averageInteractions)}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              ) : <p className="mt-4 rounded-xl bg-[#faf5ef] p-4 text-sm text-[#7a5646]">Ainda não há conteúdos comparáveis neste recorte.</p>}
            </div>

            <div className="rounded-2xl border border-[#eadfd3] bg-[#4a1a04] p-4 text-white shadow-sm md:p-5">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-[#f7a8cd]">Conteúdo em destaque</p>
              {reading?.topContent ? (
                <>
                  <div className="mt-3 flex items-start gap-3">
                    {reading.topContent.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={reading.topContent.previewUrl} alt="" className="h-20 w-16 rounded-xl object-cover" />
                    ) : <span className="grid h-20 w-16 shrink-0 place-items-center rounded-xl bg-white/10"><Eye aria-hidden="true" className="h-5 w-5 text-white/60" /></span>}
                    <div className="min-w-0"><span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold">{reading.topContent.format}</span><p className="mt-2 line-clamp-3 text-sm font-semibold leading-5">{reading.topContent.caption || "Sem legenda"}</p></div>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-white/10 p-3"><dt className="text-[10px] text-white/65">Visualizações</dt><dd className="mt-1 font-bold">{amount(reading.topContent.views)}</dd></div><div className="rounded-xl bg-white/10 p-3"><dt className="text-[10px] text-white/65">Alcance</dt><dd className="mt-1 font-bold">{amount(reading.topContent.reach)}</dd></div><div className="rounded-xl bg-white/10 p-3"><dt className="text-[10px] text-white/65">Interações</dt><dd className="mt-1 font-bold">{amount(reading.topContent.totalInteractions)}</dd></div></dl>
                  <p className="mt-3 text-xs leading-5 text-white/65">Destaque por interações entre os conteúdos recentes disponíveis; isso não prova sozinho qual tema causou o resultado.</p>
                </>
              ) : <p className="mt-3 text-sm leading-6 text-white/70">A Meta ainda não retornou interações suficientes para destacar um conteúdo.</p>}
            </div>
          </section>

          <section className="rounded-2xl border border-[#eadfd3] bg-[#faf7f3] p-4 md:p-5" aria-labelledby="coverage-title">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-[#d90f6f]">Qualidade dos dados</p>
                <h2 id="coverage-title" className="mt-1 text-lg font-bold tracking-tight text-[#4a1a04]">Cobertura histórica própria</h2>
                <p className="mt-1 text-sm leading-6 text-[#7a5646]">A Meta fornece o recorte atual. A base própria preserva a evolução desde a ativação do coletor e deve deixar qualquer lacuna explícita.</p>
              </div>
              <dl className="grid grid-cols-3 gap-2 sm:min-w-[420px]">
                <div className="rounded-xl bg-white p-3 text-center shadow-sm"><dt className="text-[10px] font-bold uppercase tracking-wide text-[#8a6756]">Dias guardados</dt><dd className="mt-1 text-xl font-bold text-[#4a1a04]">{coverage?.capturedDays ?? 0}</dd></div>
                <div className="rounded-xl bg-white p-3 text-center shadow-sm"><dt className="text-[10px] font-bold uppercase tracking-wide text-[#8a6756]">Stories</dt><dd className="mt-1 text-xl font-bold text-[#4a1a04]">{report.history.stories.length}</dd></div>
                <div className="rounded-xl bg-white p-3 text-center shadow-sm"><dt className="text-[10px] font-bold uppercase tracking-wide text-[#8a6756]">Marcos</dt><dd className="mt-1 text-xl font-bold text-[#4a1a04]">{report.history.contentSnapshots.length}</dd></div>
              </dl>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[#6b4938]">
              <span className={cn("rounded-full px-2.5 py-1 font-bold", coverage?.complete ? "bg-[#e7f6ed] text-[#267348]" : "bg-[#fff1d8] text-[#925d05]")}>{coverage?.complete ? "Período coberto" : "Cobertura parcial"}</span>
              {coverage?.firstDate && coverage.lastDate ? <span>Base disponível de {date(coverage.firstDate, { year: true })} a {date(coverage.lastDate, { year: true })}.</span> : <span>A base histórica ainda não possui dias preservados.</span>}
            </div>
          </section>

          <ContentList title={yearSelected ? "Conteúdos recentes disponíveis" : "Conteúdos no período"} items={report.content} />
          {report.activeStories.length ? <ContentList title="Stories ativos" items={report.activeStories} /> : null}
          {report.history.stories.length ? <ContentList title="Stories preservados" items={report.history.stories} /> : null}
          {report.history.contentSnapshots.length ? <ContentList title="Marcos históricos de Feed e Reels" items={report.history.contentSnapshots} /> : null}

          <aside className="rounded-2xl border border-[#eadfd3] bg-[#f4ece2] p-4 text-xs leading-5 text-[#6b4938]">
            <strong className="mb-1 block text-[#4a1a04]">Como interpretar</strong>
            {report.notices.map((notice) => <p key={notice}>{notice}</p>)}
          </aside>
        </div>
      ) : null}
    </PageContainer>
  );
}
