"use client";

import { useCallback, useState, type ReactNode } from "react";
import { CalendarDays, ChevronRight } from "lucide-react";
import { Segmented } from "@/components/patterns/segmented";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { daysBetween, formatStudyDate as dmy, type StudyEntry } from "./model";
import { isProjection, type Granularity, type PeriodRow } from "./periods";

export const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const thousands = (cents: number) => `${cents < 0 ? "−" : ""}R$ ${(Math.abs(cents) / 100_000).toFixed(1).replace(".", ",")} mil`;
export const axisThousands = (cents: number) => `${cents < 0 ? "−" : ""}${Math.round(Math.abs(cents) / 100_000)} mil`;
export const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
export { dmy };
const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTH = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const weekdayOf = (date: string) => WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];
export const monthName = (month: string) => MONTH[Number(month.slice(5, 7)) - 1];

/** Número da semana ISO, igual ao cabeçalho de semana de Despesas. */
export function isoWeek(date: string) {
  const target = new Date(`${date}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() - ((target.getUTCDay() + 6) % 7) + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

/** Props mínimas que o recharts entrega a um tooltip customizado. */
export type ChartTipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> };

/** Estado que volta ao valor inicial sozinho quando a chave muda (período, agrupamento, filtro), sem efeito. */
export function useKeyedState<T>(key: string, initial: () => T) {
  const [state, setState] = useState<{ key: string; value: T }>(() => ({ key, value: initial() }));
  const value = state.key === key ? state.value : initial();
  const set = useCallback((next: T | ((current: T) => T)) => {
    setState(previous => {
      const base = previous.key === key ? previous.value : initial();
      return { key, value: typeof next === "function" ? (next as (current: T) => T)(base) : next };
    });
    // `initial` só produz o valor de partida; a chave é quem define quando reiniciar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [value, set] as const;
}

/** Grupos abertos/recolhidos: dia abre expandido; semana e mês começam recolhidos. O conjunto guarda o que o usuário inverteu. */
export function useGroupToggle(resetKey: string, granularity: Granularity) {
  const [toggled, setToggled] = useKeyedState(resetKey, () => new Set<string>());
  const isOpen = (key: string) => (granularity === "day" ? !toggled.has(key) : toggled.has(key));
  const toggle = (key: string) => setToggled(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const open = (key: string) => setToggled(current => { const next = new Set(current); if (granularity === "day") next.delete(key); else next.add(key); return next; });
  return { isOpen, toggle, open };
}

/** Estado que o recharts entrega no clique de uma barra. */
export type ChartClickState = { activePayload?: ReadonlyArray<{ payload?: { key?: string } }> };
/** Leva a tabela até o grupo do período clicado no gráfico. */
export function scrollToGroup(key: string) {
  window.requestAnimationFrame(() => document.getElementById(`group-${key}`)?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start",
  }));
}

export const GRANULARITY_OPTIONS: Array<{ value: Granularity; label: string }> = [{ value: "day", label: "Dia" }, { value: "week", label: "Semana" }, { value: "month", label: "Mês" }];

export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint", className)}>{children}</p>;
}

export function Card({ title, description, aside, children, className }: { title?: string; description?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-ds-card border border-ds-border bg-ds-surface", className)}>
      {title ? (
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 pb-3 pt-[18px]">
          <div className="min-w-0">
            <h2 className="text-[15.5px] font-extrabold text-ds-ink">{title}</h2>
            {description ? <p className="mt-1 max-w-[70ch] text-[12.5px] text-ds-ink-muted">{description}</p> : null}
          </div>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function GranularityToggle({ value, onChange }: { value: Granularity; onChange: (value: Granularity) => void }) {
  return <Segmented<Granularity> aria-label="Agrupar por" value={value} onChange={onChange} options={GRANULARITY_OPTIONS} />;
}

/** Sem projeção (só o que existe) ou com projeção (média de 3 meses). O padrão é sem projeção. */
export function ProjectionBar({ projection, onChange }: { projection: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Segmented<"off" | "on"> aria-label="Projeção" value={projection ? "on" : "off"} onChange={value => onChange(value === "on")}
        options={[{ value: "off", label: "Sem projeção" }, { value: "on", label: "Com projeção" }]} />
      <span className="text-[13px] text-ds-ink-muted">
        {projection ? "Inclui vendas futuras e saídas recorrentes, pela média dos últimos 3 meses." : "Só o que existe hoje: vendas já feitas que faltam cair e contas já lançadas. Nenhuma média."}
      </span>
    </div>
  );
}

const TONE: Record<string, string> = { warn: "text-ds-alert-ink", danger: "text-ds-danger", ok: "text-ds-ok" };

/** Quadro do topo que funciona como filtro da lista abaixo. */
export function FilterTile({ kicker, title, value, line, tone, alert, active, onClick }: {
  kicker: string; title: string; value: string; line: string; tone?: "warn" | "danger" | "ok"; alert?: boolean; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "grid min-w-[148px] grid-rows-[auto_2.5em_auto_auto] content-start gap-0.5 overflow-hidden rounded-[18px] border px-[15px] py-[13px] text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink",
        alert ? "border-transparent bg-ds-danger-bg" : "border-ds-border bg-ds-surface hover:border-ds-ink-faint",
        active && (alert ? "ring-2 ring-ds-danger" : "border-ds-ink ring-1 ring-ds-ink"),
      )}
    >
      <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ds-ink-faint">{kicker}</span>
      <span className={cn("self-start text-[13px] font-extrabold leading-[1.25]", alert && "text-ds-danger")}>{title}</span>
      <span className={cn("font-ds-mono text-[18px] font-bold tracking-[-0.02em]", alert && "text-ds-danger")}>{value}</span>
      <span className={cn("text-[12px] text-ds-ink-muted", tone && TONE[tone] && cn(TONE[tone], "font-bold"))}>{line}</span>
    </button>
  );
}

export function TileRow({ children }: { children: ReactNode }) {
  return <div role="group" aria-label="Filtros" className="grid auto-cols-[minmax(148px,1fr)] grid-flow-col gap-2.5 overflow-x-auto pb-1.5">{children}</div>;
}

/** Cabeçalho de grupo, no formato do cabeçalho de semana de Despesas (dia, semana ou mês). */
export function GroupHeader({ row, granularity, today, open, onToggle, count, children, summaryColumns }: {
  row: Pick<PeriodRow, "start" | "end" | "weekStart" | "month">; granularity: Granularity; today: string; open: boolean; onToggle: () => void; count: number; children?: ReactNode; summaryColumns?: string;
}) {
  const kicker = granularity === "day" ? (row.start === today ? "Hoje" : weekdayOf(row.start)) : granularity === "month" ? "Mês" : `Semana ${isoWeek(row.weekStart ?? row.start)}`;
  const label = granularity === "day" ? dmy(row.start)
    : granularity === "month" ? `${monthName(row.month!)} de ${row.month!.slice(0, 4)}${row.start > `${row.month}-01` ? " · de hoje em diante" : ""}`
      : `${row.start.slice(5, 7) === row.end.slice(5, 7) ? row.start.slice(8, 10) : dm(row.start)} a ${dmy(row.end)}`;
  const heading = <>
    <ChevronRight aria-hidden="true" className={cn("h-4 w-4 shrink-0 text-ds-accent-ink transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")} />
    <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-ds-accent-ink" />
    <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-ink">{kicker}</span>
    <span className="text-[13px] font-bold text-ds-ink">{label}</span>
    <span className="text-xs text-ds-ink-faint">{count} {count === 1 ? "lançamento" : "lançamentos"}</span>
  </>;
  return (
    <button
      type="button"
      id={`group-${row.start}`}
      aria-expanded={open}
      aria-label={`${open ? "Recolher" : "Expandir"} ${kicker} · ${label}`}
      onClick={onToggle}
      className={cn("w-full items-center gap-x-3 border-b border-ds-divider bg-ds-accent-row px-[18px] py-2.5 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-accent-ink",
        summaryColumns ? cn("grid gap-y-2.5", summaryColumns) : "flex flex-wrap gap-y-1")}
    >
      {summaryColumns ? <>
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">{heading}</span>
        <span className="grid grid-cols-2 items-start gap-3 md:contents">{children}</span>
      </> : <>
        {heading}
        <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 font-ds-mono text-[12.5px] font-extrabold">{children}</span>
      </>}
    </button>
  );
}

export function LedgerHead({ columns, labels, visibility = "md:grid" }: { columns: string; visibility?: "md:grid" | "lg:grid"; labels: Array<{ text: string; right?: boolean }> }) {
  return (
    <div className={cn("hidden gap-3 border-b border-ds-divider bg-ds-muted px-[18px] py-2.5 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint", visibility, columns)} aria-hidden="true">
      {labels.map(label => <span key={label.text} className={cn(label.right && "text-right")}>{label.text}</span>)}
    </div>
  );
}

const SOURCE_LABEL: Record<StudyEntry["source"], string> = {
  deposit_boleto: "Depósito", deposit_counted: "Depósito", cash_open: "Espécie", stone: "Stone", sales_projected: "Vendas",
  expense: "Despesa", expense_forecast: "Provisão", expense_recurring: "Média 3 meses",
};
export const entryOrigin = (entry: StudyEntry) => entry.unit?.name ?? SOURCE_LABEL[entry.source];

export function entryStatus(entry: StudyEntry): { variant: StatusPillVariant; label: string; dashed?: boolean } {
  if (entry.direction === "out") {
    if (entry.certainty === "recurring") return { variant: "neutral", label: "Média 3 meses", dashed: true };
    if (entry.overdue) return { variant: "danger", label: "Vencida" };
    return entry.certainty === "provisioned" ? { variant: "neutral", label: "Provisionada" } : { variant: "info", label: "A pagar" };
  }
  if (isProjection(entry)) return { variant: "neutral", label: "Venda futura", dashed: true };
  return { variant: "ok", label: "Já vendido" };
}

export function EntryStatusPill({ entry }: { entry: StudyEntry }) {
  const status = entryStatus(entry);
  return <StatusPill variant={status.variant} className={cn(status.dashed && "border border-dashed border-ds-ink-faint bg-transparent")}>{status.label}</StatusPill>;
}

export function DueHint({ entry, today }: { entry: StudyEntry; today: string }) {
  if (entry.lateFrom) return <span className="block text-[11.5px] font-bold text-ds-danger">devia cair {dm(entry.lateFrom)}</span>;
  if (entry.direction !== "out" || isProjection(entry)) return null;
  const days = daysBetween(today, entry.date);
  return <span className={cn("block text-[11.5px]", days <= 3 ? "font-bold text-ds-alert-ink" : "text-ds-ink-faint")}>{days <= 0 ? "vence hoje" : `em ${days}d`}</span>;
}

export const signedBrl = (entry: StudyEntry) => `${entry.direction === "in" ? "+" : "−"}${brl(entry.amountCents)}`;
export const MoneyIn = ({ children }: { children: ReactNode }) => <span className="text-ds-ok">{children}</span>;
export const MoneyOut = ({ children }: { children: ReactNode }) => <span className="text-ds-danger">{children}</span>;
