"use client";

import { BarChart3, ExternalLink, Eye, Loader2, MousePointerClick, RefreshCw, Users } from "lucide-react";

import type {
  InstagramInsightContentSnapshot,
  InstagramInsightContentItem,
  InstagramInsightsDays,
  InstagramInsightsReport,
} from "./contracts";

type InsightsViewProps = {
  report: InstagramInsightsReport | null;
  days: InstagramInsightsDays;
  loading: boolean;
  error: string | null;
  onDaysChange: (days: InstagramInsightsDays) => void;
  onRefresh: () => void;
};

const numberFormatter = new Intl.NumberFormat("pt-BR");

function amount(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : numberFormatter.format(value);
}

function date(value: string) {
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00.000Z` : value);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Fortaleza",
  }).format(parsed);
}

function snapshotStage(item: InstagramInsightContentItem) {
  const stage = (item as Partial<InstagramInsightContentSnapshot>).stage;
  if (stage === "first48h") return "até 48h";
  if (stage === "day7") return "7 dias";
  if (stage === "day30") return "30 dias";
  return null;
}

function MetricCard({ label, value, helper }: { label: string; value: number | null | undefined; helper?: string }) {
  return <div className="rounded-2xl border border-[#EADFD3] bg-white p-4 shadow-sm">
    <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#7A5646]">{label}</p>
    <strong className="mt-2 block text-2xl font-black text-[#4A1A04]">{amount(value)}</strong>
    {helper ? <p className="mt-1 text-xs text-[#8A6756]">{helper}</p> : null}
  </div>;
}

function ContentList({ title, items }: { title: string; items: InstagramInsightContentItem[] }) {
  return <section className="rounded-2xl border border-[#EADFD3] bg-white p-4 shadow-sm md:p-5">
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-lg font-black text-[#4A1A04]">{title}</h2>
      <span className="rounded-full bg-[#F4ECE2] px-2.5 py-1 text-xs font-bold text-[#7A5646]">{items.length}</span>
    </div>
    {items.length ? <div className="space-y-3">{items.map((item) => <article key={item.id} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 rounded-xl border border-[#EFE5DB] p-3 md:grid-cols-[72px_minmax(0,1fr)_auto]">
      <div className="h-20 w-16 overflow-hidden rounded-lg bg-[#F4ECE2] md:h-20 md:w-[72px]">
        {item.previewUrl ? <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
        </> : <div className="grid h-full place-items-center"><Eye className="h-5 w-5 text-[#BDA898]" /></div>}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#FDE3EF] px-2 py-0.5 text-[10px] font-extrabold text-[#B80E61]">{item.format}</span>
          {snapshotStage(item) ? <span className="rounded-full bg-[#F4ECE2] px-2 py-0.5 text-[10px] font-extrabold text-[#7A5646]">{snapshotStage(item)}</span> : null}
          <span className="text-xs font-semibold text-[#8A6756]">{date(item.publishedAt)}</span>
        </div>
        <p className="mt-2 line-clamp-2 text-sm font-semibold text-[#4A1A04]">{item.caption || "Sem legenda"}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#7A5646]">
          <span>Alcance <b>{amount(item.reach)}</b></span>
          <span>Visualizações <b>{amount(item.views)}</b></span>
          <span>Interações <b>{amount(item.totalInteractions)}</b></span>
          <span>Curtidas <b>{amount(item.likes)}</b></span>
          <span>Comentários <b>{amount(item.comments)}</b></span>
          <span>Compart. <b>{amount(item.shares)}</b></span>
          <span>Salvos <b>{amount(item.saves)}</b></span>
          {item.format === "Story" ? <>
            <span>Respostas <b>{amount(item.replies)}</b></span>
            <span>Link do Story <b>{amount(item.storyLinkClicks)}</b></span>
            <span>Bio após Story <b>{amount(item.bioLinkClicks)}</b></span>
          </> : null}
        </div>
      </div>
      {item.permalink ? <a href={item.permalink} target="_blank" rel="noopener noreferrer" aria-label="Abrir publicação no Instagram" className="hidden h-9 w-9 place-items-center rounded-lg border border-[#EADFD3] text-[#7A5646] hover:bg-[#F4ECE2] md:grid"><ExternalLink className="h-4 w-4" /></a> : null}
    </article>)}</div> : <p className="rounded-xl bg-[#FAF5EF] p-4 text-sm text-[#7A5646]">Nenhum conteúdo disponível neste período.</p>}
  </section>;
}

export function InsightsView({ report, days, loading, error, onDaysChange, onRefresh }: InsightsViewProps) {
  const maxReach = Math.max(1, ...(report?.reachSeries.map((point) => point.value) ?? [1]));
  const followerHistory = report?.history.daily.flatMap((day) => day.followersCount === null ? [] : [day.followersCount]) ?? [];
  const followerChange = followerHistory.length >= 2
    ? followerHistory[followerHistory.length - 1]! - followerHistory[0]!
    : null;
  return <div className="mx-auto w-full max-w-[1280px] px-4 py-5 md:px-7 md:py-7">
    <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="flex items-center gap-2 text-[#D90F6F]"><BarChart3 className="h-5 w-5" /><span className="text-xs font-extrabold uppercase tracking-[0.1em]">Desempenho</span></div>
        <h1 className="mt-1 text-2xl font-black text-[#4A1A04] md:text-3xl">Relatórios do Instagram e da bio</h1>
        <p className="mt-1 text-sm text-[#7A5646]">Dados da conta profissional na Meta e conversões medidas em bio.coalashakes.com.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-[#EADFD3] bg-white p-1" aria-label="Período do relatório">
          {([7, 30, 90] as const).map((option) => <button key={option} type="button" onClick={() => onDaysChange(option)} className={`rounded-lg px-3 py-2 text-xs font-extrabold ${days === option ? "bg-[#4A1A04] text-white" : "text-[#7A5646] hover:bg-[#F4ECE2]"}`}>{option} dias</button>)}
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} className="grid h-10 w-10 place-items-center rounded-xl border border-[#EADFD3] bg-white text-[#4A1A04] disabled:opacity-50" aria-label="Atualizar relatório">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>
    </header>

    {error ? <div role="alert" className="mt-5 rounded-xl border border-[#E8B9B3] bg-[#FBE4E1] p-4 text-sm font-semibold text-[#A52E24]">{error}</div> : null}
    {loading && !report ? <div className="mt-10 flex items-center justify-center gap-2 rounded-2xl border border-[#EADFD3] bg-white p-12 text-[#7A5646]"><Loader2 className="h-5 w-5 animate-spin" />Consultando a Meta e os acessos da bio…</div> : null}

    {report ? <div className="mt-6 space-y-5">
      <section className="rounded-2xl border border-[#EADFD3] bg-[#4A1A04] p-4 text-white shadow-sm md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {report.profile.profilePictureUrl ? <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={report.profile.profilePictureUrl} alt="" className="h-12 w-12 rounded-full border-2 border-white/50 object-cover" />
            </> : <div className="grid h-12 w-12 place-items-center rounded-full bg-white/15"><Users className="h-5 w-5" /></div>}
            <div><strong className="block text-lg">@{report.profile.username}</strong><span className="text-xs text-white/70">Conta profissional conectada</span></div>
          </div>
          <div className="flex gap-6 text-sm"><span><b className="block text-lg">{amount(report.profile.followersCount)}</b> seguidores</span><span><b className="block text-lg">{amount(report.profile.mediaCount)}</b> publicações</span></div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-black text-[#4A1A04]">Resumo da Meta</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <MetricCard label="Visualizações" value={report.totals.views} />
          <MetricCard label="Alcance" value={report.totals.reach} />
          <MetricCard label="Contas engajadas" value={report.totals.accountsEngaged} />
          <MetricCard label="Interações" value={report.totals.totalInteractions} />
          <MetricCard label="Compartilhamentos" value={report.totals.shares} />
          <MetricCard label="Salvamentos" value={report.totals.saves} />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,.6fr)]">
        <div className="rounded-2xl border border-[#EADFD3] bg-white p-4 shadow-sm md:p-5">
          <h2 className="text-lg font-black text-[#4A1A04]">Alcance diário</h2>
          {report.reachSeries.length ? <div className="mt-5 flex h-44 items-end gap-1" role="img" aria-label="Gráfico de alcance diário">{report.reachSeries.map((point) => <div key={point.date} className="group relative flex h-full min-w-0 flex-1 items-end" title={`${date(point.date)}: ${amount(point.value)}`}><div className="w-full rounded-t bg-[#F462A7] transition hover:bg-[#D90F6F]" style={{ height: `${Math.max(3, point.value / maxReach * 100)}%` }} /></div>)}</div> : <p className="mt-4 rounded-xl bg-[#FAF5EF] p-4 text-sm text-[#7A5646]">A Meta não retornou a série diária para este período.</p>}
        </div>
        <div className="rounded-2xl border border-[#EADFD3] bg-white p-4 shadow-sm md:p-5">
          <div className="flex items-center gap-2"><MousePointerClick className="h-5 w-5 text-[#D90F6F]" /><h2 className="text-lg font-black text-[#4A1A04]">Funil da bio</h2></div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-[#FAF5EF] p-3"><strong className="block text-xl text-[#4A1A04]">{amount(report.bio.pageViews)}</strong><span className="text-[11px] text-[#7A5646]">visitas</span></div>
            <div className="rounded-xl bg-[#FAF5EF] p-3"><strong className="block text-xl text-[#4A1A04]">{amount(report.bio.linkClicks)}</strong><span className="text-[11px] text-[#7A5646]">cliques</span></div>
            <div className="rounded-xl bg-[#FAF5EF] p-3"><strong className="block text-xl text-[#4A1A04]">{report.bio.clickThroughRate === null ? "—" : `${(report.bio.clickThroughRate * 100).toFixed(1)}%`}</strong><span className="text-[11px] text-[#7A5646]">conversão</span></div>
          </div>
          <h3 className="mt-5 text-xs font-extrabold uppercase tracking-[0.08em] text-[#7A5646]">Links mais acionados</h3>
          {report.bio.topLinks.length ? <ol className="mt-2 space-y-2">{report.bio.topLinks.map((link, index) => <li key={link.id} className="flex items-center gap-2 text-sm"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#FDE3EF] text-[10px] font-black text-[#B80E61]">{index + 1}</span><span className="min-w-0 flex-1 truncate font-semibold text-[#4A1A04]">{link.label}</span><b>{amount(link.clicks)}</b></li>)}</ol> : <p className="mt-2 text-sm text-[#7A5646]">Os primeiros cliques aparecerão aqui.</p>}
        </div>
      </section>

      <ContentList title="Conteúdos recentes no período" items={report.content} />
      {report.activeStories.length ? <ContentList title="Stories ativos" items={report.activeStories} /> : null}
      {report.history.stories.length ? <ContentList title="Stories preservados no período" items={report.history.stories} /> : null}
      {report.history.contentSnapshots.length ? <ContentList title="Marcos históricos de Feed e Reels" items={report.history.contentSnapshots} /> : null}

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-black text-[#4A1A04]">Base histórica própria</h2>
          <p className="text-xs text-[#7A5646]">Ela começa a crescer após a ativação do coletor e não inventa dados anteriores.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard label="Dias preservados" value={report.history.daily.length} />
          <MetricCard label="Stories preservados" value={report.history.stories.length} />
          <MetricCard label="Marcos de conteúdo" value={report.history.contentSnapshots.length} />
          <MetricCard label="Variação de seguidores" value={followerChange} helper={followerChange === null ? "Disponível após dois dias capturados" : "Entre o primeiro e o último retrato"} />
        </div>
      </section>

      <aside className="rounded-2xl border border-[#EADFD3] bg-[#F4ECE2] p-4 text-xs leading-relaxed text-[#6B4938]">
        {report.notices.map((notice) => <p key={notice}>{notice}</p>)}
      </aside>
    </div> : null}
  </div>;
}
