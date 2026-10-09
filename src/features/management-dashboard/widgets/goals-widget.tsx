"use client";

import { cn } from "@/lib/utils";

import { widgetIcons } from "./icons";
import { DetailsLink, KpiTile, MeterBar, Pill, RingGauge, WidgetCard, WidgetEmpty, WidgetHead, type Tone } from "./kit";

export type GoalRow = { kioskId: string; name: string; current: number; target: number; progress: number };

export type GoalsWidgetProps = {
  revenue: number;
  targetTotal: number;
  projected: { value: number; detail: string };
  rows: GoalRow[];
  goalCount: number;
  loading: boolean;
  /** Fração do mês já decorrida (0 a 1): serve de ritmo esperado. */
  monthProgress: number;
  monthLabel: string;
  formatMoney: (value: number) => string;
  formatCompact: (value: number) => string;
  onDetails: () => void;
};

function paceTone(progress: number, expected: number): { tone: Tone; label: string } {
  if (progress >= expected + 0.05) return { tone: "ok", label: "À frente" };
  if (progress >= expected - 0.05) return { tone: "info", label: "No ritmo" };
  return { tone: "danger", label: "Atrás" };
}

export function GoalsWidget(props: GoalsWidgetProps) {
  const { revenue, targetTotal, projected, rows, goalCount, loading, monthProgress, monthLabel, formatMoney, formatCompact, onDetails } = props;
  const currentGoalsTotal = rows.reduce((sum, row) => sum + row.current, 0);
  const overall = targetTotal > 0 ? currentGoalsTotal / targetTotal : 0;
  const overallPace = paceTone(overall, monthProgress);
  const projectedShare = targetTotal > 0 ? projected.value / targetTotal : 0;

  return (
    <WidgetCard widgetId="goals-revenue">
      {(density) => (
        <>
          <WidgetHead icon={widgetIcons.goals} tone="accent" title={density === "compact" ? "Metas" : "Metas e faturamento"} subtitle={monthLabel} href="/dashboard/goals/tracking" density={density} />

          {rows.length === 0 ? (
            <WidgetEmpty>{loading ? "Carregando metas..." : "Nenhuma meta ativa para hoje."}</WidgetEmpty>
          ) : density === "compact" ? (
            <>
              <div className="flex items-center gap-4">
                <RingGauge value={overall} tone={overallPace.tone}>
                  <span className="text-xl font-black tabular-nums text-ds-ink">{Math.round(overall * 100)}%</span>
                  <span className="text-[10px] font-semibold text-ds-ink-faint">da meta</span>
                </RingGauge>
                <div className="min-w-0">
                  <p className="whitespace-nowrap text-xl font-black tracking-tight tabular-nums text-ds-ink">{formatCompact(revenue)}</p>
                  <p className="truncate text-xs font-medium text-ds-ink-muted">de {formatCompact(targetTotal)}</p>
                  <Pill tone={overallPace.tone} dot className="mt-2">{overallPace.label}</Pill>
                </div>
              </div>
              <ul className="space-y-1.5">
                {rows.slice(0, 3).map((row) => {
                  const pace = paceTone(row.progress, monthProgress);
                  return (
                    <li key={row.kioskId} className="flex items-center gap-2 text-xs">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", pace.tone === "ok" ? "bg-ds-ok" : pace.tone === "info" ? "bg-ds-info" : "bg-ds-danger")} />
                      <span className="min-w-0 flex-1 truncate font-semibold text-ds-ink">{row.name}</span>
                      <span className="font-black tabular-nums text-ds-ink">{Math.round(row.progress * 100)}%</span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <>
              <div className={cn("grid gap-3", density === "wide" ? "grid-cols-4" : "grid-cols-1")}>
                <div className={cn("flex flex-col justify-center", density === "wide" && "col-span-1")}>
                  <p className="text-xs font-bold uppercase tracking-wide text-ds-ink-muted">Faturamento do mês</p>
                  <p className="mt-1 whitespace-nowrap text-3xl font-black tracking-tight tabular-nums text-ds-ink">{formatMoney(revenue)}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Pill tone={overallPace.tone} dot>{overallPace.label}</Pill>
                    <span className="text-xs font-medium text-ds-ink-muted">{Math.round(overall * 100)}% da meta · {Math.round(monthProgress * 100)}% do mês</span>
                  </div>
                </div>
                {density === "wide" ? (
                  <>
                    <KpiTile label="Meta geral" value={formatCompact(targetTotal)} note={loading ? "carregando" : `${goalCount} meta(s)`} icon={widgetIcons.goals} />
                    <KpiTile label="Projeção do mês" value={formatCompact(projected.value)} note={targetTotal > 0 ? `${Math.round(projectedShare * 100)}% da meta` : projected.detail} tone={projectedShare >= 1 ? "ok" : "warn"} icon={widgetIcons.income} />
                    <KpiTile label="Faltam para a meta" value={formatCompact(Math.max(targetTotal - currentGoalsTotal, 0))} note={`${rows.length} unidade(s)`} tone="muted" icon={widgetIcons.limits} />
                  </>
                ) : null}
              </div>

              <ul className={cn("grid gap-2.5", density === "wide" ? "grid-cols-2" : "grid-cols-1")}>
                {rows.slice(0, density === "wide" ? 6 : 4).map((row) => {
                  const pace = paceTone(row.progress, monthProgress);
                  return (
                    <li key={row.kioskId} className="rounded-ds-card border border-ds-divider bg-ds-surface p-3">
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-ds-ink">{row.name}</span>
                        <span className="whitespace-nowrap text-sm font-black tabular-nums text-ds-ink">{formatMoney(row.current)}</span>
                        <Pill tone={pace.tone}>{Math.round(row.progress * 100)}%</Pill>
                      </div>
                      <MeterBar className="mt-2.5" value={row.progress} tone={pace.tone === "info" ? "info" : pace.tone} markers={[{ at: monthProgress, label: "Ritmo esperado hoje" }]} />
                      <div className="mt-1.5 flex justify-between text-[11px] font-medium text-ds-ink-faint">
                        <span>meta {formatMoney(row.target)}</span>
                        <span>faltam {formatMoney(Math.max(row.target - row.current, 0))}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {rows.length > 0 ? <DetailsLink onClick={onDetails}>Ver detalhes</DetailsLink> : null}
        </>
      )}
    </WidgetCard>
  );
}
