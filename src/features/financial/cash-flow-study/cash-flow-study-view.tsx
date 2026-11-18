"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { HeroChip } from "@/components/patterns/hero-chip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { financialDateKey } from "@/features/financial/lib/financial-dates";
import { RangePicker, type PickerPreset } from "@/features/financial/components/cash-flow/range-picker";
import { cn } from "@/lib/utils";
import { type StudyResult } from "./model";
import {
  autoGranularity, futurePresetRange, isProjection, lowestBalance, startingBalance, visibleEntries, type FuturePreset, type Granularity, type StudyRange,
} from "./periods";
import { brl, dm, dmy, thousands } from "./study-ui";

export type CashFlowStudyPayload = StudyResult & { generatedAt: string };
export type CashFlowTab = "weeks" | "entries" | "health" | "movements";

export const CASH_FLOW_TABS: Array<{ value: CashFlowTab; label: string }> = [
  { value: "weeks", label: "Próximas semanas" },
  { value: "entries", label: "Entradas" },
  { value: "health", label: "Saúde do negócio" },
  { value: "movements", label: "Movimentações" },
];

// ---------- dados ----------
export function useCashFlowStudy(enabled: boolean) {
  const api = useAuthenticatedApi();
  const [data, setData] = useState<CashFlowStudyPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const version = useRef(0);
  const load = useCallback(async () => {
    if (!enabled) return;
    const current = ++version.current;
    setLoading(true);
    try {
      const result = await api<CashFlowStudyPayload>("/api/financial/cash-flow-study", { fallbackError: "Não foi possível calcular o fluxo de caixa." });
      if (current === version.current) { setData(result); setError(null); }
    } catch (cause) {
      if (current === version.current) setError(cause instanceof Error ? cause.message : "Não foi possível calcular o fluxo de caixa.");
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, [api, enabled]);
  useEffect(() => { void load(); return () => { version.current += 1; }; }, [load]);
  return { data, error, loading, reload: load };
}

// ---------- controles compartilhados (período, projeção, reserva) ----------
const FUTURE_PRESETS: Array<{ value: Exclude<FuturePreset, "custom">; label: string }> = [
  { value: "this_month", label: "Este mês" }, { value: "next_month", label: "Até o fim do próximo mês" }, { value: "three_months", label: "Próximos 3 meses" },
];

export function useStudyControls(data: CashFlowStudyPayload | null) {
  const today = data?.asOf ?? financialDateKey(new Date())!;
  const [preset, setPreset] = useState<FuturePreset>("next_month");
  const [custom, setCustom] = useState<StudyRange | null>(null);
  const [granularityChoice, setGranularityChoice] = useState<Granularity | null>(null);
  const [projection, setProjection] = useState(false);
  const [includeReserve, setIncludeReserve] = useState(false);
  const range = useMemo<StudyRange>(() => (preset === "custom" && custom ? custom : futurePresetRange(preset === "custom" ? "next_month" : preset, today)), [custom, preset, today]);
  const granularity = granularityChoice ?? autoGranularity(range);
  const applyRange = useCallback((value: { preset: string; from: string; to: string }) => {
    const known = FUTURE_PRESETS.find(option => option.value === value.preset);
    setPreset(known ? known.value : "custom");
    setCustom(known ? null : { from: value.from, to: value.to });
    setGranularityChoice(null);
  }, []);
  return { today, range, preset, granularity, setGranularity: setGranularityChoice, projection, setProjection, includeReserve, setIncludeReserve, applyRange };
}
export type StudyControls = ReturnType<typeof useStudyControls>;

// ---------- faixa de abas ----------
export function CashFlowTabStrip({ value, onChange }: { value: CashFlowTab; onChange: (tab: CashFlowTab) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (index: number) => {
    const target = (index + CASH_FLOW_TABS.length) % CASH_FLOW_TABS.length;
    onChange(CASH_FLOW_TABS[target].value);
    refs.current[target]?.focus();
  };
  return (
    <div role="tablist" aria-label="Seções do fluxo de caixa" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-ds-btn-lg bg-ds-seg p-1">
      {CASH_FLOW_TABS.map((tab, index) => (
        <button
          key={tab.value}
          ref={element => { refs.current[index] = element; }}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          tabIndex={value === tab.value ? 0 : -1}
          onClick={() => onChange(tab.value)}
          onKeyDown={event => {
            if (event.key === "ArrowRight") { event.preventDefault(); move(index + 1); }
            if (event.key === "ArrowLeft") { event.preventDefault(); move(index - 1); }
            if (event.key === "Home") { event.preventDefault(); move(0); }
            if (event.key === "End") { event.preventDefault(); move(CASH_FLOW_TABS.length - 1); }
          }}
          className={cn(
            "h-9 shrink-0 rounded-ds-md px-4 text-[13.5px] font-bold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink",
            value === tab.value ? "bg-ds-surface text-ds-ink shadow-sm" : "text-ds-ink-muted hover:text-ds-ink",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ---------- chips do painel escuro ----------
const chipBase = "inline-flex h-9 items-center gap-2 rounded-full bg-white/5 px-3.5 ring-1 ring-inset ring-white/10 transition-[background,box-shadow] duration-150 hover:bg-white/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-kicker motion-reduce:transition-none";

function AccountsChip({ data, controls }: { data: CashFlowStudyPayload; controls: StudyControls }) {
  const hasReserve = data.accounts.some(account => account.kind === "reserve");
  const total = startingBalance(data, controls.includeReserve);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={chipBase} aria-label="Ver saldo por conta">
          <span className="font-ds-mono text-[15px] font-bold leading-none text-ds-on-dark-2">{data.startBalanceCents === null && !controls.includeReserve ? "indisponível" : brl(total)}</span>
          <span className="text-[13px] font-bold text-ds-on-dark-2">Nas contas hoje{controls.includeReserve ? " · com a reserva" : ""}</span>
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 text-ds-accent-kicker" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl p-2 shadow-xl">
        <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Saldo por conta</p>
        {data.accounts.map(account => {
          const off = account.kind === "reserve" && !controls.includeReserve;
          return (
            <div key={account.id} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted/60">
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-bold">{account.name}</p>
                <p className="text-xs text-muted-foreground">
                  {account.kind === "reserve" ? "Reserva · fora do caixa por padrão" : account.at ? `Conta corrente · saldo pela API às ${new Date(account.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Conta corrente · saldo indisponível"}
                </p>
              </div>
              <span className={cn("font-mono text-[13.5px] font-bold", off && "text-muted-foreground line-through")}>{account.cents === null ? "—" : brl(account.cents)}</span>
            </div>
          );
        })}
        {hasReserve ? (
          <label className="mx-1 mt-1 flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2.5 text-[13px]">
            <span>Somar a reserva ao caixa<span className="block text-[11.5px] text-muted-foreground">Vale para saldo, gráfico e menor saldo</span></span>
            <Checkbox checked={controls.includeReserve} onCheckedChange={checked => controls.setIncludeReserve(checked === true)} />
          </label>
        ) : <p className="mx-1 mt-1 rounded-xl bg-muted/60 px-3 py-2.5 text-[12px] text-muted-foreground">Contas de investimento aparecem aqui, separadas do caixa, quando forem conectadas.</p>}
        <div className="flex justify-between px-3 pb-1 pt-2.5 text-[13px] text-muted-foreground"><span>Total considerado</span><b className="font-mono text-foreground">{brl(total)}</b></div>
      </PopoverContent>
    </Popover>
  );
}

export function StudyHeroChips({ data, controls }: { data: CashFlowStudyPayload | null; controls: StudyControls }) {
  if (!data) return <HeroChip value="…" label="Calculando o fluxo de caixa" />;
  const options = { range: controls.range, projection: controls.projection, includeReserve: controls.includeReserve };
  const low = lowestBalance(data, options);
  const sold = data.entries.filter(entry => entry.direction === "in" && !isProjection(entry)).reduce((sum, entry) => sum + entry.amountCents, 0);
  const inRange = visibleEntries(data.entries, controls.projection).filter(entry => entry.direction === "out" && entry.date >= controls.range.from && entry.date <= controls.range.to);
  const outCents = inRange.filter(entry => (controls.projection ? isProjection(entry) : !isProjection(entry))).reduce((sum, entry) => sum + entry.amountCents, 0);
  return (
    <>
      <AccountsChip data={data} controls={controls} />
      <HeroChip value={thousands(sold)} label="Já vendido, a receber" tone="info" />
      {low.lowest ? <HeroChip value={thousands(low.lowest.cents)} label={`Menor saldo até ${dm(controls.range.to)} · ${low.lowest.date === data.asOf ? "hoje" : dm(low.lowest.date)}`} tone={low.lowest.cents < (data.minimumCents ?? 0) ? "danger" : "neutral"} /> : null}
      <HeroChip value={thousands(outCents)} label={controls.projection ? "Saídas recorrentes pela média" : "Contas lançadas a pagar"} tone="warning" />
    </>
  );
}

export function periodTriggerLabel(controls: StudyControls) {
  if (controls.preset === "custom") return `${dm(controls.range.from)} a ${dmy(controls.range.to)}`;
  return `${FUTURE_PRESETS.find(option => option.value === controls.preset)?.label} · até ${dm(controls.range.to)}`;
}

export function StudyHeroControls({ data, controls, showPeriod, loading, onReload }: {
  data: CashFlowStudyPayload | null; controls: StudyControls; showPeriod: boolean; loading: boolean; onReload: () => void;
}) {
  const presets: PickerPreset[] = FUTURE_PRESETS.map(option => ({ value: option.value, label: option.label, range: futurePresetRange(option.value, controls.today) }));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {showPeriod && data ? (
        <RangePicker value={{ preset: controls.preset, ...controls.range }} presets={presets} minDate={controls.today} maxDate={data.horizonEnd} label={periodTriggerLabel(controls)} onApply={controls.applyRange} />
      ) : null}
      <Button variant="on-dark-secondary" size="md" onClick={onReload} disabled={loading}>{loading ? "Calculando…" : "Recalcular"}</Button>
      <span className="text-[12.5px] text-ds-on-dark-muted">
        {data?.minimumCents != null ? `Mínimo de caixa: ${thousands(data.minimumCents)} (2 semanas de saídas médias)` : "Mínimo de caixa indisponível"}
        {data ? ` · calculado às ${new Date(data.generatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}
      </span>
    </div>
  );
}

// ---------- avisos e carregamento ----------
export function StudyGaps({ data }: { data: CashFlowStudyPayload }) {
  if (!data.gaps.length) return null;
  return (
    <div role="note" className="rounded-ds-btn-lg border border-ds-alert-border bg-ds-alert-bg px-4 py-3 text-[13px] text-ds-alert-ink">
      <p className="font-bold">Limites deste cálculo</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">{data.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>
    </div>
  );
}

export function StudyLoading({ error, onRetry }: { error: string | null; onRetry: () => void }): ReactNode {
  if (error) return (
    <div role="alert" className="rounded-ds-card border border-ds-confirm-border bg-ds-confirm-bg px-5 py-4 text-sm text-ds-confirm-ink">
      {error} <Button variant="ds-link" className="ml-2 h-auto p-0" onClick={onRetry}>Tentar de novo</Button>
    </div>
  );
  return <div className="space-y-4"><Skeleton className="h-16 w-full rounded-ds-card" /><Skeleton className="h-72 w-full rounded-ds-card" /><Skeleton className="h-96 w-full rounded-ds-card" /></div>;
}
