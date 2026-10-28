"use client";

import { useState } from "react";
import { AlertTriangle, Clock3, Coffee, MapPin, Pencil, TimerOff } from "lucide-react";

import { LiftRow } from "@/components/patterns/lift-row";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";

import { fiscalClock, INCIDENT_SEVERITY, pauseLengths, plannedBreakMinutesOf, type DayIncident, type DayMarking, type DayView } from "./day-model";
import { TACIT_APPROVAL_LABEL } from "@/features/dp/absences/requests/tacit-approval";

import { hm, MARKING_PURPOSES, MarkingSequence, type MarkingPurpose } from "./record-strip";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export const INCIDENTS: Record<DayIncident, { label: string; detail: string; icon: typeof AlertTriangle }> = {
  missing: { label: "Dia sem batidas", detail: "Nenhuma batida num dia de escala. Se houve motivo, justifique com uma ausência.", icon: TimerOff },
  odd: { label: "Número ímpar de batidas", detail: "O dia tem número ímpar de batidas: um período ficou sem fechamento.", icon: AlertTriangle },
  missing_break: { label: "Jornada sem intervalo classificado", detail: "A jornada foi finalizada sem um início e uma volta de intervalo. As batidas permanecem válidas e o dia segue para conferência.", icon: Coffee },
  late_exit: { label: "Saída após o previsto", detail: "Última batida depois do horário da escala além da tolerância da jornada.", icon: Clock3 },
  short_break: { label: "Intervalo menor que o previsto", detail: "Intervalo abaixo do previsto além da tolerância da jornada, ou pausa menor que o mínimo (aviso de conferência).", icon: Coffee },
  other_unit: { label: "Batida em outra unidade", detail: "Batida feita numa unidade diferente da escala. Não foi bloqueada; o DP confere a troca.", icon: MapPin },
  long_break: { label: "Intervalo maior que o previsto", detail: "Intervalo acima do previsto além da tolerância da jornada (aviso de conferência).", icon: Coffee },
};

export const durationLabel = (minutes: number, signed = false) => {
  const sign = minutes < 0 ? "−" : signed && minutes > 0 ? "+" : "";
  const absolute = Math.abs(minutes);
  return absolute < 60 ? `${sign}${absolute} min` : `${sign}${Math.floor(absolute / 60)}h${String(absolute % 60).padStart(2, "0")}`;
};

/** Memória específica da ocorrência; complementa a explicação geral sem alterar a prévia. */
export function incidentFact(day: DayView, incident: DayIncident, unitNames: Map<string, string> = new Map()) {
  const work = day.shift?.type === "work" ? day.shift : null;
  const plannedBreak = plannedBreakMinutesOf(work);
  if (incident === "late_exit" && work?.endTime && day.markings.length) {
    const actual = fiscalClock(day.markings.at(-1)!.markedAt);
    const difference = day.deviation?.edge === "end" ? day.deviation.minutes : null;
    return `Previsto ${work.endTime} · registrado ${actual}${difference && difference > 0 ? ` · ${durationLabel(difference)} depois` : ""}.`;
  }
  if ((incident === "short_break" || incident === "long_break") && plannedBreak > 0 && day.breakMinutes !== null) {
    const pauses = pauseLengths(day.markings);
    const shortest = pauses.length ? Math.min(...pauses) : null;
    if (incident === "short_break" && work?.breakMinPauseMinutes && shortest !== null && shortest < work.breakMinPauseMinutes) {
      return `Total previsto ${durationLabel(plannedBreak)} · realizado ${durationLabel(day.breakMinutes)} · menor pausa ${durationLabel(shortest)} (mínimo ${durationLabel(work.breakMinPauseMinutes)}).`;
    }
    const difference = Math.abs(day.breakMinutes - plannedBreak);
    return `Previsto ${durationLabel(plannedBreak)} · realizado ${durationLabel(day.breakMinutes)} · ${durationLabel(difference)} ${incident === "long_break" ? "acima" : "abaixo"}.`;
  }
  if (incident === "other_unit" && work) {
    const actual = [...new Set(day.markings.filter((marking) => marking.executionUnitId !== work.unitId)
      .map((marking) => unitNames.get(marking.executionUnitId) ?? "outra unidade"))];
    return `Escala: ${work.unitName ?? "unidade prevista"} · registro: ${actual.join(", ")}.`;
  }
  if (incident === "odd") return `${day.markings.length} batidas registradas · falta fechar um período.`;
  if (incident === "missing_break" && plannedBreak > 0) return `Intervalo previsto: ${durationLabel(plannedBreak)} · sem par completo classificado.`;
  if (incident === "missing") return "0 batidas registradas no dia escalado.";
  return null;
}

function weekday(date: string) {
  return WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}
export function dayLabel(date: string) {
  return `${weekday(date)}, ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}
function dayTone(day: DayView): "danger" | "warn" | null {
  if (day.incidents.some((incident) => INCIDENT_SEVERITY[incident] === "danger")) return "danger";
  return day.incidents.length ? "warn" : null;
}

export function absenceStatus(status: string, approvedByInaction = false): { label: string; variant: StatusPillVariant } {
  if (status === "approved" && approvedByInaction) return { label: TACIT_APPROVAL_LABEL, variant: "warn" };
  if (status === "approved") return { label: "Aprovada", variant: "neutral" };
  if (status === "in_review" || status === "submitted") return { label: "Em análise", variant: "info" };
  if (status === "adjustments_requested") return { label: "Ajuste pedido", variant: "warn" };
  return { label: status === "rejected" ? "Recusada" : status === "cancelled" ? "Cancelada" : "Rascunho", variant: "neutral" };
}

export function balanceOf(day: DayView, today: string): { label: string; variant: StatusPillVariant } | null {
  if (day.date === today && day.markings.length) return { label: "Em curso", variant: "info" };
  if (day.absence) return day.absence.status === "approved" ? { label: "Ausência aprovada", variant: "neutral" } : { label: "Ausência em análise", variant: "info" };
  if (day.balanceMinutes === null) return null;
  return { label: hm(day.balanceMinutes, true), variant: day.balanceMinutes < 0 ? "danger" : day.balanceMinutes > 0 ? "warn" : "neutral" };
}

export const DAY_GRID = "grid grid-cols-[56px_1fr_auto] items-center gap-x-4 gap-y-2 md:grid-cols-[56px_minmax(110px,0.8fr)_minmax(240px,2fr)_96px_110px_minmax(120px,1fr)]";

export function DayCard({ day, today, selected, reviewing = false, onOpen }: { day: DayView; today: string; selected: boolean; reviewing?: boolean; onOpen: () => void }) {
  const isToday = day.date === today;
  const work = day.shift?.type === "work" ? day.shift : null;
  if (!work && !day.markings.length && !day.absence) {
    return (
      <div className="flex items-center gap-3 rounded-ds-btn-lg border border-dashed border-ds-border px-4 py-1.5 text-xs text-ds-ink-faint">
        <span className="w-14 text-center font-bold">{weekday(day.date)} {day.date.slice(8, 10)}</span>
        <span>{day.shift ? "Folga" : "Sem escala"}</span>
      </div>
    );
  }
  const tone = isToday ? null : dayTone(day);
  const balance = balanceOf(day, today);
  const first = day.incidents[0];
  const openPeriod = isToday && day.markings.length % 2 === 1;
  return (
    <LiftRow table selected={selected} onClick={onOpen}
      className={cn(DAY_GRID, "rounded-ds-btn-lg border py-3 shadow-[0_1px_2px_rgba(0,0,0,.04)]",
        tone === "warn" ? "border-ds-caution-border bg-ds-caution-bg" : tone === "danger" ? "border-ds-trouble-border bg-ds-trouble-bg" : "border-ds-border bg-ds-surface")}>
      <span className={cn("flex h-12 w-14 flex-col items-center justify-center rounded-ds-md leading-none",
        isToday ? "bg-ds-info text-white" : tone === "warn" ? "bg-ds-caution-tile text-ds-caution-tile-ink" : tone === "danger" ? "bg-ds-danger-bg text-ds-danger" : "bg-ds-warm text-ds-ink")}>
        <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] opacity-75">{weekday(day.date)}</span>
        <span className="mt-1 text-xl font-extrabold tabular-nums">{day.date.slice(8, 10)}</span>
      </span>
      <span className="flex min-w-0 items-center justify-end gap-2 md:justify-start">
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", day.absence ? "bg-ds-neutral" : "bg-ds-info")} aria-hidden />
        <span className="min-w-0 truncate text-sm font-bold text-ds-ink">{day.absence ? day.absence.typeName : work?.shiftName ?? "Turno"}</span>
      </span>
      <span className="col-span-3 space-y-0.5 md:col-span-1">
        {day.absence && !day.markings.length
          ? <span className="text-sm text-ds-ink-muted">Sem batidas · {day.absence.status === "approved" ? "ausência aprovada" : "ausência em análise"}</span>
          : <MarkingSequence day={day} today={today} />}
        {work ? (
          <span className="block text-xs text-ds-ink-muted">
            Previsto {work.startTime}–{work.endTime}
            {day.deviation ? <span className="text-ds-caution"> · {day.deviation.edge === "end" ? "saída" : "entrada"} registrada {fiscalClock(day.markings[day.deviation.edge === "end" ? day.markings.length - 1 : 0].markedAt)}</span> : null}
          </span>
        ) : null}
      </span>
      <span className="text-sm tabular-nums text-ds-ink-2">
        {day.markings.length ? <><strong className="font-ds-mono text-ds-ink">{durationLabel(day.workedMinutes)}</strong><span className="block text-xs text-ds-ink-muted">{openPeriod ? "períodos fechados" : "trabalhadas"}</span></> : "—"}
        {day.breakMinutes !== null ? (
          <span className={cn("block text-xs", day.incidents.includes("short_break") ? "font-bold text-ds-danger" : day.incidents.includes("long_break") ? "font-bold text-ds-caution" : "text-ds-ink-muted")}>
            Intervalo {durationLabel(day.breakMinutes)}
          </span>
        ) : null}
        {day.nightMinutes ? <span className="block text-xs font-semibold text-ds-ink-muted">Noturno {durationLabel(day.nightMinutes)}</span> : null}
      </span>
      <span>{balance ? <StatusPill variant={balance.variant} className="tabular-nums" title="Diferença entre as horas trabalhadas e a jornada líquida prevista">{balance.label}</StatusPill> : null}</span>
      <span className="col-span-3 flex min-w-0 items-center gap-1.5 md:col-span-1">
        {day.incidents.map((incident) => {
          const { icon: Icon, label } = INCIDENTS[incident];
          return <Icon key={incident} className={cn("h-4 w-4 shrink-0", INCIDENT_SEVERITY[incident] === "danger" ? "text-ds-danger" : "text-ds-caution")} aria-label={label} />;
        })}
        {first ? <span className="truncate text-xs text-ds-ink-muted">{INCIDENTS[first].label}</span> : null}
        {reviewing ? <StatusPill variant="info">Ajuste em análise</StatusPill> : null}
      </span>
    </LiftRow>
  );
}

export type ReceiptActions = {
  busyReceipt: string | null;
  canShare: boolean;
  error: { id: string; message: string } | null;
  open: (marking: DayMarking) => void;
  share: (marking: DayMarking) => void;
  retry: (receiptId: string) => void;
};

export type ClassificationActions = {
  change: (receiptId: string, purpose: MarkingPurpose) => Promise<{ changeStatus: "applied" | "in_review" }>;
};

export function adjustmentStateOf(day: DayView, today: string, readOnly: boolean, markingMode: "official" | "pilot" | "disabled" | null) {
  if (readOnly || day.date > today) return "hidden" as const;
  if (day.allMarkings.some((marking) => marking.pilot) || (markingMode === "pilot" && day.date === today)) return "pilot" as const;
  return markingMode === "official" ? "available" as const : "hidden" as const;
}

export function MarkingClassificationEditor({ marking, actions }: { marking: DayMarking; actions: ClassificationActions }) {
  const current = (marking.classification?.purpose ?? "journey_start") as MarkingPurpose;
  const [editing, setEditing] = useState(false);
  const [purpose, setPurpose] = useState<MarkingPurpose>(current);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await actions.change(marking.receiptId, purpose);
      setMessage(result.changeStatus === "in_review" ? "Mês fechado: alteração enviada para revisão." : "Classificação atualizada.");
      setEditing(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível alterar a classificação.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Button type="button" variant="ds-ghost" size="sm" onClick={() => { setPurpose(current); setEditing((value) => !value); }}>
        <Pencil className="h-3.5 w-3.5" aria-hidden /> Alterar classificação
      </Button>
      {editing ? (
        <div className="space-y-2 rounded-ds-md border border-ds-border bg-ds-warm p-3">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs font-bold text-ds-ink">O que esta batida representa?</legend>
            {MARKING_PURPOSES.map(([id, label]) => (
              <label key={id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-ds-sm bg-ds-surface px-2.5 py-1.5 text-xs">
                <input type="radio" name={`classification-${marking.receiptId}`} value={id} checked={purpose === id} onChange={() => setPurpose(id)} />
                <span className="font-semibold text-ds-ink">{label}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ds-ghost" size="sm" disabled={busy} onClick={() => setEditing(false)}>Cancelar</Button>
            <Button type="button" variant="ds-secondary" size="sm" loading={busy} loadingLabel="Salvando…" onClick={() => void save()}>Salvar classificação</Button>
          </div>
        </div>
      ) : null}
      {message ? <p role="status" className="text-xs font-semibold text-ds-ink-muted">{message}</p> : null}
    </div>
  );
}
