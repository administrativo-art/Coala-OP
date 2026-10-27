"use client";

import { useState } from "react";
import { AlertTriangle, CalendarPlus, Clock3, Coffee, FileText, Info, MapPin, Pencil, RefreshCw, Share2, TimerOff } from "lucide-react";

import { LiftRow } from "@/components/patterns/lift-row";
import { PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";

import { fiscalClock, INCIDENT_SEVERITY, pauseLengths, plannedBreakMinutesOf, type DayAbsence, type DayIncident, type DayMarking, type DayView } from "./day-model";
import { TACIT_APPROVAL_LABEL } from "@/features/dp/absences/requests/tacit-approval";
import { ADJUSTMENT_KIND_LABELS, ADJUSTMENT_STATUS_LABELS, type AdjustmentView } from "@/features/dp/time-adjustments/types";

import { ReceiptPill } from "./marking-ui";
import { hm, MARKING_PURPOSES, MarkingSequence, suggestedLabel, purposeLabel, expectedPunchesOf, type MarkingPurpose } from "./record-strip";

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

const durationLabel = (minutes: number, signed = false) => {
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

function balanceOf(day: DayView, today: string): { label: string; variant: StatusPillVariant } | null {
  if (day.date === today && day.markings.length) return { label: "Em curso", variant: "info" };
  if (day.absence) return day.absence.status === "approved" ? { label: "Ausência aprovada", variant: "neutral" } : { label: "Ausência em análise", variant: "info" };
  if (day.balanceMinutes === null) return null;
  return { label: hm(day.balanceMinutes, true), variant: day.balanceMinutes < 0 ? "danger" : day.balanceMinutes > 0 ? "warn" : "neutral" };
}

export const DAY_GRID = "grid grid-cols-[56px_1fr_auto] items-center gap-x-4 gap-y-2 md:grid-cols-[56px_minmax(110px,0.8fr)_minmax(240px,2fr)_96px_110px_minmax(120px,1fr)]";

export function DayCard({ day, today, selected, onOpen }: { day: DayView; today: string; selected: boolean; onOpen: () => void }) {
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

function MarkingClassificationEditor({ marking, actions }: { marking: DayMarking; actions: ClassificationActions }) {
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

export function DayPanel({ day, today, unitNames, receipts, classifications, onClose, onRequestAbsence, adjustments, onRequestAdjustment, onOpenAdjustment, readOnly = false, markingMode = null }: {
  day: DayView | null; today: string; unitNames: Map<string, string>; receipts: ReceiptActions | null; onClose: () => void;
  classifications: ClassificationActions | null;
  onRequestAbsence: (date: string) => void;
  adjustments: AdjustmentView[]; onRequestAdjustment: (date: string) => void; onOpenAdjustment: (id: string) => void; readOnly?: boolean;
  markingMode?: "official" | "pilot" | "disabled" | null;
}) {
  if (!day) return null;
  const work = day.shift?.type === "work" ? day.shift : null;
  const expected = expectedPunchesOf(day);
  const balance = balanceOf(day, today);
  const plannedBreak = plannedBreakMinutesOf(work);
  const adjustmentState = adjustmentStateOf(day, today, readOnly, markingMode);
  const openPeriod = day.date === today && day.markings.length % 2 === 1;
  return (
    <SidePanel open onOpenChange={(open) => !open && onClose()} kicker={`${dayLabel(day.date)}/${day.date.slice(0, 4)}`}
      title={day.absence ? day.absence.typeName : work ? `${work.shiftName ?? "Turno"}` : day.shift ? "Folga" : "Sem escala"}
      subtitle={work ? `Previsto ${work.startTime}–${work.endTime}${plannedBreak ? ` · intervalo de ${durationLabel(plannedBreak)}` : ""}${work.unitName ? ` · ${work.unitName}` : ""}` : "Nenhum registro esperado"}
      highlights={<>
        <span>{day.markings.length}<span className="ml-1 text-xs font-bold text-ds-on-dark-2">batidas</span></span>
        <span>{durationLabel(day.workedMinutes)}<span className="ml-1 text-xs font-bold text-ds-on-dark-2">{openPeriod ? "períodos fechados" : "trabalhadas"}</span></span>
        {balance ? <span>{balance.label.replace(":", "h")}<span className="ml-1 text-xs font-bold text-ds-on-dark-2">dif. da jornada</span></span> : null}
      </>}>
      {work && day.markings.length ? (
        <PanelSection title="Memória da prévia">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-ds-ink-muted">
            <span>Jornada líquida prevista <strong className="block font-ds-mono text-sm text-ds-ink">{durationLabel(day.plannedWorkMinutes ?? 0)}</strong></span>
            <span>{openPeriod ? "Períodos fechados" : "Horas trabalhadas"} <strong className="block font-ds-mono text-sm text-ds-ink">{durationLabel(day.workedMinutes)}</strong></span>
            {day.breakMinutes !== null ? <span>Intervalo realizado <strong className="block font-ds-mono text-sm text-ds-ink">{durationLabel(day.breakMinutes)}</strong></span> : null}
            {balance ? <span>Diferença da jornada <strong className={cn("block font-ds-mono text-sm", day.balanceMinutes && day.balanceMinutes < 0 ? "text-ds-danger" : "text-ds-ink")}>{balance.label.replace(":", "h")}</strong></span> : null}
          </div>
          {openPeriod ? <p className="text-xs text-ds-ink-muted">O período atual ainda não entrou neste total; ele será fechado pela próxima batida.</p> : null}
          {day.nightMinutes ? <p className="rounded-ds-sm bg-ds-warm px-3 py-2 text-xs text-ds-ink-2">
            <strong className="text-ds-ink">Faixa noturna urbana (22h–5h): {durationLabel(day.nightMinutes)}.</strong>{" "}
            Tempo físico identificado; hora reduzida e adicional ainda precisam ser calculados e tratados na folha pelo DP.
          </p> : null}
        </PanelSection>
      ) : null}
      {day.incidents.length ? (
        <PanelSection title="A conferir" aside={day.incidents.length}>
          {day.incidents.map((incident) => {
            const { label, detail, icon: Icon } = INCIDENTS[incident];
            const fact = incidentFact(day, incident, unitNames);
            return (
              <div key={incident} className="flex gap-2.5">
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", INCIDENT_SEVERITY[incident] === "danger" ? "text-ds-danger" : "text-ds-caution")} aria-hidden />
                <div><p className="text-sm font-bold text-ds-ink">{label}</p>{fact ? <p className="text-xs font-semibold text-ds-ink-2">{fact}</p> : null}<p className="text-xs text-ds-ink-muted">{detail}</p></div>
              </div>
            );
          })}
          {day.incidents.includes("missing") && !readOnly ? (
            <Button type="button" variant="ds-secondary" size="sm" onClick={() => onRequestAbsence(day.date)}>
              <CalendarPlus className="h-4 w-4" aria-hidden /> Justificar com ausência
            </Button>
          ) : null}
        </PanelSection>
      ) : null}
      {day.absence ? (
        <PanelSection title="Ausência">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-ds-ink">{day.absence.typeName}</span>
            <StatusPill variant={absenceStatus(day.absence.status, day.absence.approvedByInaction).variant}>{absenceStatus(day.absence.status, day.absence.approvedByInaction).label}</StatusPill>
          </div>
          <p className="text-xs text-ds-ink-muted">
            {day.absence.startDate === day.absence.endDate ? `Dia ${day.absence.startDate.split("-").reverse().join("/")}` : `De ${day.absence.startDate.split("-").reverse().join("/")} a ${day.absence.endDate.split("-").reverse().join("/")}`}.
            {" "}O efeito no ponto é decidido no fechamento.
          </p>
        </PanelSection>
      ) : null}
      {adjustments.length ? (
        <PanelSection title="Pedidos de ajuste" aside={adjustments.length}>
          {adjustments.map((adjustment) => (
            <button key={adjustment.id} type="button" onClick={() => onOpenAdjustment(adjustment.id)}
              className="flex w-full items-center justify-between gap-2 rounded-ds-sm py-1 text-left text-sm hover:bg-ds-warm/60">
              <span><span className="block font-bold text-ds-ink">{ADJUSTMENT_KIND_LABELS[adjustment.kind].title}</span>
                <span className="block text-xs text-ds-ink-muted">ver relatório</span></span>
              <StatusPill variant={adjustment.status === "approved" ? "ok" : adjustment.status === "in_review" ? "info" : "neutral"}>
                {adjustment.scope === "pilot" && adjustment.status === "approved" ? "Simulação aprovada · sem efeito" : ADJUSTMENT_STATUS_LABELS[adjustment.status]}
              </StatusPill>
            </button>
          ))}
        </PanelSection>
      ) : null}
      <PanelSection title="Batidas" aside={day.markings.length ? `${day.markings.length} no dia` : undefined}>
        {day.allMarkings.length === 0 ? <p className="text-sm text-ds-ink-muted">Nenhuma batida neste dia.</p> : day.allMarkings.map((marking) => {
          const index = day.markings.indexOf(marking);
          const busy = receipts?.busyReceipt === marking.receiptId;
          if (marking.treatment === "discarded" || marking.treatment === "included") {
            return (
              <div key={marking.receiptId} className="flex items-start gap-3 border-b border-ds-divider pb-3 last:border-0 last:pb-0">
                <span className={cn("inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-extrabold",
                  marking.treatment === "included" ? "bg-ds-ok-bg text-ds-ok" : "bg-ds-danger-bg text-ds-danger")}>{marking.treatment === "included" ? `${index + 1}ª` : "—"}</span>
                <div className="space-y-1">
                  <p className={cn("text-sm text-ds-ink", marking.treatment === "discarded" && "line-through")}>
                    <strong className="font-ds-mono text-base">{fiscalClock(marking.markedAt)}</strong>
                    <span className="text-ds-ink-muted"> · {marking.treatment === "included" ? "incluída por ajuste aprovado" : `desconsiderada por ajuste · NSR ${marking.nsr}`}</span>
                  </p>
                  <p className="text-xs text-ds-ink-muted">{marking.treatment === "included" ? "Sem comprovante: não é batida do relógio." : "A batida original continua guardada no registro oficial."}</p>
                </div>
              </div>
            );
          }
          return (
            <div key={marking.receiptId} className="flex items-start gap-3 border-b border-ds-divider pb-3 last:border-0 last:pb-0">
              <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-ds-ink px-2 text-sm font-extrabold text-white" aria-label={`${index + 1}ª batida do dia`}>{index + 1}ª</span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-sm text-ds-ink">
                  <strong className="font-ds-mono text-base">{fiscalClock(marking.markedAt)}</strong>
                  <span className="text-ds-ink-muted"> · {marking.classification ? purposeLabel(marking.classification.purpose) : suggestedLabel(index, expected)}</span>
                </p>
                <p className="text-xs text-ds-ink-muted">{marking.pilot ? `Ensaio · sequência ${marking.nsr}` : `NSR ${marking.nsr}`} · {unitNames.get(marking.executionUnitId) ?? "Unidade do registro"}</p>
                {marking.pilot ? <p className="text-xs font-semibold text-ds-warn">Não entra no fechamento oficial.</p> : null}
                <div className="flex flex-wrap items-center gap-2">
                  <ReceiptPill status={marking.receiptStatus} />
                  {marking.receiptStatus === "available" && receipts ? (
                    <>
                      <Button type="button" variant="ds-secondary" size="sm" loading={busy} loadingLabel="Abrindo…" onClick={() => receipts.open(marking)}>
                        <FileText className="h-4 w-4" aria-hidden /> Baixar
                      </Button>
                      {receipts.canShare ? (
                        <Button type="button" variant="ds-ghost" size="sm" disabled={busy} onClick={() => receipts.share(marking)}>
                          <Share2 className="h-4 w-4" aria-hidden /> Compartilhar
                        </Button>
                      ) : null}
                    </>
                  ) : marking.receiptStatus !== "available" && receipts ? (
                    <Button type="button" variant="ds-secondary" size="sm" loading={busy} loadingLabel="Emitindo…" onClick={() => receipts.retry(marking.receiptId)}>
                      <RefreshCw className="h-4 w-4" aria-hidden /> Tentar emitir
                    </Button>
                  ) : null}
                </div>
                {classifications ? <MarkingClassificationEditor marking={marking} actions={classifications} /> : null}
                {receipts?.error?.id === marking.receiptId ? <p role="alert" className="text-xs font-semibold text-ds-danger">{receipts.error.message}</p> : null}
              </div>
            </div>
          );
        })}
        <p className="flex items-start gap-1.5 text-xs text-ds-ink-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> A classificação organiza a jornada e os avisos. Alterá-la não muda o horário nem o registro fiscal da batida.
        </p>
        {adjustmentState === "pilot" ? (
          <div className="space-y-2 rounded-ds-sm bg-ds-warn-bg px-3 py-2 text-xs text-ds-warn">
            <p>A solicitação será uma simulação analisável pelo DP, sem alterar ponto, banco, espelho, folha ou documentos fiscais.</p>
            <Button type="button" variant="ds-secondary" size="sm" onClick={() => onRequestAdjustment(day.date)}>Simular correção das batidas</Button>
          </div>
        ) : null}
        {adjustmentState === "available" ? (
          <div className="space-y-2">
            <p className="text-xs text-ds-ink-muted">Use quando faltar ou sobrar uma batida, ou quando um horário estiver incorreto. A batida original é preservada e o gestor ou DP decide o pedido.</p>
            <Button type="button" variant="ds-secondary" size="sm" onClick={() => onRequestAdjustment(day.date)}>Solicitar correção das batidas</Button>
          </div>
        ) : null}
      </PanelSection>
    </SidePanel>
  );
}

export function AbsencesAndAlerts({ days, absences, filter, onFilter, onRequestAbsence, readOnly = false }: {
  days: DayView[]; absences: DayAbsence[]; filter: string; onFilter: (filter: string) => void; onRequestAbsence: () => void; readOnly?: boolean;
}) {
  const alerts = (Object.keys(INCIDENTS) as DayIncident[]).map((key) => ({ key, count: days.filter((day) => day.incidents.includes(key)).length }));
  const selectedClass = "bg-ds-accent-row shadow-[inset_3px_0_0_var(--ds-accent-ink)]";
  return (
    <section className="space-y-4 rounded-ds-card border border-ds-border bg-ds-surface p-5">
      <div className="space-y-2">
        <h2 className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Ausências do mês</h2>
        {absences.length === 0 ? <p className="text-sm text-ds-ink-muted">Nenhuma ausência neste mês.</p> : absences.map((absence) => {
          const key = `absence:${absence.id}`;
          const status = absenceStatus(absence.status, absence.approvedByInaction);
          const count = days.filter((day) => day.absence?.id === absence.id).length;
          return (
            <button key={absence.id} type="button" aria-pressed={filter === key} onClick={() => onFilter(filter === key ? "all" : key)}
              className={cn("flex w-full items-start gap-2.5 rounded-ds-sm px-1.5 py-1.5 text-left text-sm hover:bg-ds-warm/60", filter === key && selectedClass)}>
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-ds-neutral" aria-hidden />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block font-semibold leading-snug text-ds-ink">{absence.typeName}</span>
                <span className="block whitespace-nowrap text-xs text-ds-ink-muted">
                  {absence.startDate.slice(8, 10)}/{absence.startDate.slice(5, 7)}{absence.endDate !== absence.startDate ? ` a ${absence.endDate.slice(8, 10)}/${absence.endDate.slice(5, 7)}` : ""} · {count} {count === 1 ? "dia" : "dias"} no mês
                </span>
                <StatusPill variant={status.variant}>{status.label}</StatusPill>
              </span>
            </button>
          );
        })}
        {!readOnly ? (
          <Button type="button" variant="ds-secondary" size="sm" className="mt-1 w-full" onClick={onRequestAbsence}>
            <CalendarPlus className="h-4 w-4" aria-hidden /> Solicitar ausência
          </Button>
        ) : null}
      </div>
      <div className="space-y-1.5 border-t border-ds-divider pt-4">
        <h2 className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">A conferir</h2>
        {alerts.map(({ key, count }) => {
          const { label, icon: Icon } = INCIDENTS[key];
          const value = `incident:${key}`;
          return (
            <button key={key} type="button" disabled={!count} aria-pressed={filter === value} onClick={() => onFilter(filter === value ? "all" : value)}
              className={cn("flex w-full items-center justify-between rounded-ds-sm px-1.5 py-1 text-left text-sm text-ds-ink-2 enabled:hover:bg-ds-warm/60 disabled:opacity-50", filter === value && selectedClass)}>
              <span className="flex items-center gap-2"><Icon className={cn("h-4 w-4", INCIDENT_SEVERITY[key] === "danger" ? "text-ds-danger" : "text-ds-caution")} aria-hidden /> {label}</span>
              <span className="flex items-center gap-1.5"><strong className="text-ds-ink">{count}</strong><span className="text-xs text-ds-ink-muted">{count === 1 ? "dia" : "dias"}</span></span>
            </button>
          );
        })}
        <p className="pt-2 text-xs text-ds-ink-muted">Clique num item ou ausência para filtrar a lista; clique de novo para limpar. São avisos para conferência; batida registrada não se altera.</p>
      </div>
    </section>
  );
}
