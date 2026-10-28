"use client";

import { Fragment } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Clock3, FileText, Info, Moon, RefreshCw, Share2 } from "lucide-react";

import { PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { ADJUSTMENT_KIND_LABELS, ADJUSTMENT_STATUS_LABELS, type AdjustmentView } from "@/features/dp/time-adjustments/types";
import type { BankIssue, BankStatementLine } from "@/features/dp/time-bank/core";
import { REASON_LABELS } from "@/features/dp/time-bank/time-bank-card";
import { cn } from "@/lib/utils";

import { absenceStatus, adjustmentStateOf, balanceOf, durationLabel, incidentFact, INCIDENTS, MarkingClassificationEditor,
  type ClassificationActions, type ReceiptActions } from "./day-list";
import { fiscalClock, INCIDENT_SEVERITY, minutesOf, plannedBreakMinutesOf, toleranceOf, type DayMarking, type DayView } from "./day-model";
import { ReceiptPill } from "./marking-ui";
import { expectedPunchesOf, MARKING_PURPOSES, nextMarkingOf, PurposeDot, purposeLabel, suggestedLabel, type MarkingPurpose } from "./record-strip";
import { ADJUSTMENT_STATUS_VARIANT } from "./time-recording-views";

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Apuração do dia pela política do colaborador, vinda do extrato do banco (`computeBankDay`). */
export type DayBank = {
  policy: { id: string; version: number; name: string; enabled: boolean } | null;
  lines: BankStatementLine[];
  reviewIssues: string[];
  /** Mês ainda aberto: a apuração é prévia; fechado, é a do fechamento. */
  preview: boolean;
};

const ISSUE_LABELS: Partial<Record<BankIssue, string>> = {
  MISSING_DAY: "Dia escalado sem batida e sem ausência lançada",
  ODD_MARKINGS: "Número ímpar de batidas",
  NIGHT_SHIFT: "Jornada com hora noturna",
  NO_JOURNEY: "Sem jornada vinculada à escala",
  NO_POLICY: "Sem política de horas vinculada",
  TIME_BANK_DISABLED: "Banco de horas desligado na política",
  HOLIDAY_SCHEDULED: "Turno escalado em feriado",
  WORK_ON_ABSENCE: "Batida em dia de ausência",
  ABSENCE_REVIEW: "Ausência a revisar",
};

const NATURE: Record<BankStatementLine["line"]["nature"], { title: (line: BankStatementLine["line"]) => string; sign: 1 | -1 | 0; tone: string; mark: string }> = {
  bank_credit: { title: (line) => `Banco de horas · crédito${line.factor && line.factor !== 1 ? ` ×${String(line.factor).replace(".", ",")}` : ""}`, sign: 1, tone: "bg-ds-ok-bg text-ds-ok", mark: "+" },
  bank_debit: { title: () => "Banco de horas · débito", sign: -1, tone: "bg-ds-danger-bg text-ds-danger", mark: "−" },
  payroll_overtime: { title: (line) => `Folha · hora extra${line.ratePercent ? ` ${line.ratePercent}%` : ""}`, sign: 1, tone: "bg-ds-info-bg text-ds-info", mark: "$" },
  payroll_discount: { title: () => "Folha · desconto", sign: -1, tone: "bg-ds-danger-bg text-ds-danger", mark: "$" },
  review: { title: () => "Em conferência pelo DP", sign: 0, tone: "bg-ds-caution-bg text-ds-caution", mark: "?" },
};

/** Barra do dia: previsto tracejado, trabalho cheio, intervalo fino e a faixa noturna (22h–5h). Hoje marca "agora". */
function DayBar({ day, today }: { day: DayView; today: string }) {
  const work = day.shift?.type === "work" ? day.shift : null;
  const times = day.markings.map((marking) => minutesOf(fiscalClock(marking.markedAt)));
  const plannedStart = work?.startTime ? minutesOf(work.startTime) : null;
  const plannedEnd = work?.endTime ? minutesOf(work.endTime) : null;
  const overnight = plannedStart !== null && plannedEnd !== null && plannedEnd < plannedStart;
  if (overnight || (!times.length && plannedStart === null)) return null;
  const nowMinutes = day.date === today ? (() => { const now = new Date(); return now.getHours() * 60 + now.getMinutes(); })() : null;
  const edges = [...times, plannedStart, plannedEnd, nowMinutes].filter((value): value is number => value !== null);
  const from = Math.max(0, Math.floor((Math.min(...edges) - 60) / 60) * 60);
  const to = Math.min(1440, Math.ceil((Math.max(...edges) + 60) / 60) * 60);
  const x = (minutes: number) => `${((Math.min(Math.max(minutes, from), to) - from) / (to - from)) * 100}%`;
  const w = (start: number, end: number) => `${((Math.min(end, to) - Math.max(start, from)) / (to - from)) * 100}%`;
  const ticks = [plannedStart, plannedEnd, 22 * 60 >= from && 22 * 60 <= to ? 22 * 60 : null]
    .filter((value, index, list): value is number => value !== null && list.indexOf(value) === index);
  return (
    <div className="w-full" aria-hidden>
      <div className="relative h-11">
        <div className="absolute inset-x-0 top-3 h-3.5 rounded-full bg-white/[0.06]" />
        {from < 300 ? <div className="absolute top-[26px] h-0.5 rounded-full bg-ds-info/50" style={{ left: x(from), width: w(from, 300) }} /> : null}
        {to > 1320 ? <div className="absolute top-[26px] h-0.5 rounded-full bg-ds-info/50" style={{ left: x(1320), width: w(1320, to) }} /> : null}
        {plannedStart !== null && plannedEnd !== null ? (
          <div className="absolute top-3 h-3.5 rounded-full border border-dashed border-white/35" style={{ left: x(plannedStart), width: w(plannedStart, plannedEnd) }} />
        ) : null}
        {times.map((start, index) => {
          if (index % 2) return null;
          const end = times[index + 1] ?? (nowMinutes !== null ? nowMinutes : null);
          const next = times[index + 2];
          return (
            <Fragment key={index}>
              {end !== null && end > start ? (
                <div className={cn("absolute top-3.5 h-2.5 rounded-full bg-white", times[index + 1] === undefined && "opacity-50")}
                  style={{ left: x(start), width: w(start, end) }} />
              ) : null}
              {times[index + 1] !== undefined && next !== undefined ? (
                <div className="absolute top-[17px] h-1 rounded-full bg-ds-caution-tile" style={{ left: x(times[index + 1]), width: w(times[index + 1], next) }} />
              ) : null}
            </Fragment>
          );
        })}
        {nowMinutes !== null ? <div className="absolute top-1.5 h-6 w-0.5 rounded-full bg-ds-accent-kicker" style={{ left: x(nowMinutes) }} /> : null}
        {ticks.map((tick) => (
          <span key={tick} className="absolute top-7 -translate-x-1/2 font-ds-mono text-[10px] text-ds-on-dark-muted" style={{ left: x(tick) }}>
            {`${String(Math.floor(tick / 60)).padStart(2, "0")}:${String(tick % 60).padStart(2, "0")}`}
          </span>
        ))}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] font-semibold text-ds-on-dark-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-3.5 rounded-full border border-dashed border-white/50" />Previsto</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-3.5 rounded-full bg-white" />Trabalho</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-1 w-3.5 rounded-full bg-ds-caution-tile" />Intervalo</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded-full bg-ds-info/60" />Faixa noturna</span>
        {nowMinutes !== null ? <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-0.5 rounded-full bg-ds-accent-kicker" />Agora</span> : null}
      </p>
    </div>
  );
}

/** Uma batida na linha do tempo, com comprovante e classificação. */
function TimelineMarking({ marking, index, expected, unitNames, receipts, classifications }: {
  marking: DayMarking; index: number; expected: number | null; unitNames: Map<string, string>;
  receipts: ReceiptActions | null; classifications: ClassificationActions | null;
}) {
  const purpose = marking.classification?.purpose ?? null;
  const busy = receipts?.busyReceipt === marking.receiptId;
  if (marking.treatment === "discarded" || marking.treatment === "included") {
    const included = marking.treatment === "included";
    return (
      <div className="grid grid-cols-[52px_18px_minmax(0,1fr)] items-start gap-x-2.5">
        <span className={cn("pt-0.5 text-right font-ds-mono text-[15px] font-extrabold tabular-nums", included ? "text-ds-ink" : "text-ds-ink-faint line-through")}>{fiscalClock(marking.markedAt)}</span>
        <span className={cn("mt-1.5 h-3 w-3 justify-self-center rounded-full border-2", included ? "border-ds-ok bg-ds-ok-bg" : "border-ds-ink-faint bg-ds-surface")} aria-hidden />
        <div className="space-y-0.5">
          <p className="text-sm font-bold text-ds-ink">{included ? "Incluída por ajuste aprovado" : "Desconsiderada por ajuste"}</p>
          <p className="text-xs text-ds-ink-muted">{included ? "Sem comprovante: não é batida do relógio." : `NSR ${marking.nsr} · a batida original continua guardada no registro oficial.`}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[52px_18px_minmax(0,1fr)] items-start gap-x-2.5">
      <span className="pt-0.5 text-right font-ds-mono text-[15px] font-extrabold tabular-nums text-ds-ink">{fiscalClock(marking.markedAt)}</span>
      <span className="mt-1.5 flex justify-center text-ds-ink-faint"><PurposeDot purpose={purpose} className="h-3 w-3 ring-2 ring-ds-warm" /></span>
      <div className="min-w-0 space-y-1.5">
        <div>
          <p className="text-sm font-bold text-ds-ink">{purpose ? purposeLabel(purpose) : `${suggestedLabel(index, expected)} · classificação pendente`}</p>
          <p className="text-xs text-ds-ink-muted">{index + 1}ª · {marking.pilot ? `ensaio · sequência ${marking.nsr}` : `NSR ${marking.nsr}`} · {unitNames.get(marking.executionUnitId) ?? "unidade do registro"}</p>
          {marking.pilot ? <p className="text-xs font-semibold text-ds-warn">Não entra no fechamento oficial.</p> : null}
        </div>
        {receipts ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <ReceiptPill status={marking.receiptStatus} />
            {marking.receiptStatus === "available" ? (
              <>
                <Button type="button" variant="ds-secondary" size="sm" loading={busy} loadingLabel="Abrindo…" onClick={() => receipts.open(marking)}>
                  <FileText className="h-4 w-4" aria-hidden /> Comprovante
                </Button>
                {receipts.canShare ? (
                  <Button type="button" variant="ds-ghost" size="sm" disabled={busy} onClick={() => receipts.share(marking)} aria-label="Compartilhar comprovante">
                    <Share2 className="h-4 w-4" aria-hidden />
                  </Button>
                ) : null}
              </>
            ) : (
              <Button type="button" variant="ds-secondary" size="sm" loading={busy} loadingLabel="Emitindo…" onClick={() => receipts.retry(marking.receiptId)}>
                <RefreshCw className="h-4 w-4" aria-hidden /> Tentar emitir
              </Button>
            )}
          </div>
        ) : null}
        {classifications ? <MarkingClassificationEditor marking={marking} actions={classifications} /> : null}
        {receipts?.error?.id === marking.receiptId ? <p role="alert" className="text-xs font-semibold text-ds-danger">{receipts.error.message}</p> : null}
      </div>
    </div>
  );
}

/** Trecho entre duas batidas: duração do trabalho ou do intervalo, pela posição (1ª→2ª trabalho, 2ª→3ª intervalo…). */
function TimelineGap({ kind, minutes, open }: { kind: "work" | "break"; minutes: number | null; open?: boolean }) {
  return (
    <div className="grid min-h-6 grid-cols-[52px_18px_minmax(0,1fr)] items-stretch gap-x-2.5">
      <span />
      <span aria-hidden className={cn("w-0.5 justify-self-center",
        minutes === null && !open ? "bg-ds-border" : kind === "work" ? (open ? "bg-[repeating-linear-gradient(var(--ds-ink)_0_4px,transparent_4px_7px)]" : "bg-ds-ink")
          : "bg-[repeating-linear-gradient(var(--ds-info)_0_4px,transparent_4px_7px)]")} />
      <span className="self-center text-[11.5px] text-ds-ink-muted">
        {minutes !== null ? <>{kind === "work" ? (open ? "Trabalhando há" : "Trabalho") : "Intervalo"} <strong className="font-ds-mono text-ds-ink-2">{durationLabel(minutes)}</strong></> : null}
      </span>
    </div>
  );
}

/**
 * Detalhe do dia (painel lateral): topo com resultado e barra do dia, pendências com a ação que resolve, batidas em linha do
 * tempo e a política de horas aplicada pela apuração (banco, folha, conferência, noturno). Nada aqui altera batida: ajustes
 * passam pelo pedido ao DP e a classificação muda só a leitura da jornada.
 */
export function DayDetailPanel({ day, days, today, unitNames, receipts, classifications, onClose, onNavigate, onRequestAbsence, adjustments,
  onRequestAdjustment, onOpenAdjustment, readOnly = false, markingMode = null, bank, onRecord }: {
  day: DayView | null; days: DayView[]; today: string; unitNames: Map<string, string>; receipts: ReceiptActions | null;
  classifications: ClassificationActions | null; onClose: () => void; onNavigate: (date: string) => void;
  onRequestAbsence: (date: string) => void; adjustments: AdjustmentView[]; onRequestAdjustment: (date: string) => void;
  onOpenAdjustment: (id: string) => void; readOnly?: boolean; markingMode?: "official" | "pilot" | "disabled" | null;
  bank: DayBank | "unavailable" | null; onRecord?: () => void;
}) {
  if (!day) return null;
  const work = day.shift?.type === "work" ? day.shift : null;
  const expected = expectedPunchesOf(day);
  const balance = balanceOf(day, today);
  const plannedBreak = plannedBreakMinutesOf(work);
  const adjustmentState = adjustmentStateOf(day, today, readOnly, markingMode);
  const isToday = day.date === today;
  const openPeriod = isToday && day.markings.length % 2 === 1;
  const past = day.date < today;
  const navigable = days.filter((item) => item.date <= today);
  const position = navigable.findIndex((item) => item.date === day.date);
  const previous = position > 0 ? navigable[position - 1] : null;
  const following = position >= 0 && position < navigable.length - 1 ? navigable[position + 1] : null;
  const weekday = WEEKDAYS[new Date(`${day.date}T12:00:00Z`).getUTCDay()];
  const pending = adjustments.filter((item) => item.status === "in_review");
  const status: { label: string; variant: StatusPillVariant } = isToday ? { label: "Em andamento", variant: "info" }
    : day.absence ? absenceStatus(day.absence.status, day.absence.approvedByInaction)
      : pending.length ? { label: "Ajuste em análise", variant: "info" }
        : day.incidents.length ? { label: "A conferir", variant: day.incidents.some((item) => INCIDENT_SEVERITY[item] === "danger") ? "danger" : "warn" }
          : work ? { label: "Sem pendências", variant: "ok" } : { label: day.shift ? "Folga" : "Sem escala", variant: "neutral" };
  const nowMinutes = (() => { const now = new Date(); return now.getHours() * 60 + now.getMinutes(); })();
  const effective = day.markings;
  const slots = work && !day.absence ? Math.max(expected ?? effective.length, effective.length) : effective.length;
  const next = nextMarkingOf(day);

  // Prévia do resultado e tolerância: a mesma regra da apuração (tolerância única da jornada).
  const difference = past && work && !day.absence && effective.length && effective.length % 2 === 0 && day.plannedWorkMinutes !== null
    ? day.workedMinutes - day.plannedWorkMinutes : null;
  const toleranceApplied = difference !== null && difference !== 0 && Math.abs(difference) <= toleranceOf(work);

  return (
    <SidePanel open onOpenChange={(open) => !open && onClose()}
      kicker={(
        <span className="flex items-center gap-2 pr-8">
          <button type="button" disabled={!previous} onClick={() => previous && onNavigate(previous.date)} aria-label="Dia anterior"
            className="rounded-ds-sm border border-white/15 p-1 text-ds-on-dark-2 hover:bg-white/10 disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button>
          <span className="flex-1 text-center">{weekday}, {day.date.split("-").reverse().join("/")}</span>
          <button type="button" disabled={!following} onClick={() => following && onNavigate(following.date)} aria-label="Próximo dia"
            className="rounded-ds-sm border border-white/15 p-1 text-ds-on-dark-2 hover:bg-white/10 disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button>
        </span>
      )}
      title={<span className="flex flex-wrap items-center gap-2">{day.absence ? day.absence.typeName : work ? `${work.shiftName ?? "Turno"} · ${work.startTime}–${work.endTime}` : day.shift ? "Folga" : "Sem escala"}
        <StatusPill variant={status.variant}>{status.label}</StatusPill></span>}
      subtitle={work ? `${work.unitName ?? "Unidade da escala"}${plannedBreak ? ` · intervalo de ${durationLabel(plannedBreak)}` : ""}${expected ? ` · ${expected} batidas` : ""}` : "Nenhuma batida esperada"}
      highlights={work || effective.length ? (
        <div className="w-full space-y-3">
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-ds-md bg-white/[0.08]">
            {[["Trabalhado", effective.length ? durationLabel(day.workedMinutes) : "—", openPeriod ? "períodos fechados" : null],
              ["Intervalo", day.breakMinutes !== null ? durationLabel(day.breakMinutes) : "—", plannedBreak ? `de ${durationLabel(plannedBreak)}` : null],
              ["Resultado", isToday ? "em curso" : day.absence ? "—" : balance?.label ?? "—", toleranceApplied ? "na tolerância" : null]].map(([label, value, hint]) => (
              <div key={label} className="bg-ds-dark px-3 py-2">
                <span className="block text-[10.5px] font-bold text-ds-on-dark-muted">{label}</span>
                <span className="block font-ds-mono text-[17px] font-extrabold text-white">{value}</span>
                {hint ? <span className="block text-[10.5px] font-semibold text-ds-on-dark-muted">{hint}</span> : null}
              </div>
            ))}
          </div>
          <DayBar day={day} today={today} />
        </div>
      ) : undefined}>

      {day.incidents.length || pending.length || day.absence ? (
        <div className="space-y-2">
          {day.incidents.map((incident) => {
            const { label, detail, icon: Icon } = INCIDENTS[incident];
            const fact = incidentFact(day, incident, unitNames);
            const danger = INCIDENT_SEVERITY[incident] === "danger";
            return (
              <div key={incident} className={cn("flex gap-2.5 rounded-ds-md border px-3 py-2.5", danger ? "border-ds-trouble-border bg-ds-trouble-bg" : "border-ds-caution-border bg-ds-caution-bg")}>
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", danger ? "text-ds-danger" : "text-ds-caution")} aria-hidden />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-bold text-ds-ink">{label}</p>
                  {fact ? <p className="text-xs font-semibold text-ds-ink-2">{fact}</p> : null}
                  <p className="text-xs text-ds-ink-muted">{detail}</p>
                  {incident === "missing" && !readOnly ? (
                    <Button type="button" variant="ds-secondary" size="sm" onClick={() => onRequestAbsence(day.date)}>
                      <CalendarPlus className="h-4 w-4" aria-hidden /> Justificar com ausência
                    </Button>
                  ) : (incident === "odd" || incident === "missing_break") && adjustmentState === "available" ? (
                    <Button type="button" variant="ds-secondary" size="sm" onClick={() => onRequestAdjustment(day.date)}>Pedir correção das batidas</Button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {adjustments.map((adjustment) => (
            <button key={adjustment.id} type="button" onClick={() => onOpenAdjustment(adjustment.id)}
              className="flex w-full items-center justify-between gap-2 rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2.5 text-left hover:border-ds-ink-faint">
              <span className="min-w-0">
                <span className="block text-sm font-bold text-ds-ink">{ADJUSTMENT_KIND_LABELS[adjustment.kind].title}</span>
                <span className="block truncate text-xs text-ds-ink-muted">“{adjustment.reason}” · ver relatório</span>
              </span>
              <StatusPill variant={ADJUSTMENT_STATUS_VARIANT[adjustment.status]}>
                {adjustment.scope === "pilot" && adjustment.status === "approved" ? "Simulação aprovada · sem efeito" : ADJUSTMENT_STATUS_LABELS[adjustment.status]}
              </StatusPill>
            </button>
          ))}
          {day.absence ? (
            <div className="rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2.5">
              <p className="flex items-center justify-between gap-2 text-sm font-bold text-ds-ink">{day.absence.typeName}
                <StatusPill variant={absenceStatus(day.absence.status, day.absence.approvedByInaction).variant}>{absenceStatus(day.absence.status, day.absence.approvedByInaction).label}</StatusPill></p>
              <p className="text-xs text-ds-ink-muted">
                {day.absence.startDate === day.absence.endDate ? `Dia ${day.absence.startDate.split("-").reverse().join("/")}` : `De ${day.absence.startDate.split("-").reverse().join("/")} a ${day.absence.endDate.split("-").reverse().join("/")}`}.
                {" "}O efeito no ponto é decidido no fechamento.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <PanelSection title="Batidas" aside={slots ? `${effective.length} de ${slots}` : undefined}>
        {day.allMarkings.length === 0 && !slots ? <p className="text-sm text-ds-ink-muted">Nenhuma batida neste dia.</p> : (
          <div>
            {day.allMarkings.filter((marking) => marking.treatment === "discarded").map((marking) => (
              <Fragment key={marking.receiptId}>
                <TimelineMarking marking={marking} index={0} expected={expected} unitNames={unitNames} receipts={null} classifications={null} />
                <TimelineGap kind="work" minutes={null} />
              </Fragment>
            ))}
            {Array.from({ length: slots }, (_, index) => {
              const marking = effective[index];
              const following = effective[index + 1];
              const kind = index % 2 === 0 ? "work" as const : "break" as const;
              const gap = marking && following ? minutesOf(fiscalClock(following.markedAt)) - minutesOf(fiscalClock(marking.markedAt))
                : marking && !following && isToday && kind === "work" ? nowMinutes - minutesOf(fiscalClock(marking.markedAt)) : null;
              const plannedPurpose = MARKING_PURPOSES[Math.min(index, 3)]?.[0] as MarkingPurpose | undefined;
              return (
                <Fragment key={marking?.receiptId ?? `slot-${index}`}>
                  {marking ? (
                    <TimelineMarking marking={marking} index={index} expected={expected} unitNames={unitNames} receipts={receipts} classifications={classifications} />
                  ) : (
                    <div className="grid grid-cols-[52px_18px_minmax(0,1fr)] items-center gap-x-2.5">
                      <span className={cn("text-right font-ds-mono text-[15px] font-extrabold", past ? "text-ds-danger" : "text-ds-ink-faint")}>··:··</span>
                      <span aria-hidden className={cn("h-3 w-3 justify-self-center rounded-full border-2 border-dashed", past ? "border-ds-danger" : "border-ds-ink-faint")} />
                      <p className={cn("text-sm", past ? "font-bold text-ds-danger" : "text-ds-ink-muted")}>
                        {isToday && index === effective.length ? `Próxima${next.reliable ? ` · ${purposeLabel(next.purpose).toLowerCase()}` : ""}`
                          : `${plannedPurpose ? purposeLabel(plannedPurpose) : "Batida"}${past ? " sem batida" : " · prevista"}`}
                      </p>
                    </div>
                  )}
                  {index < slots - 1 ? <TimelineGap kind={kind} minutes={gap} open={Boolean(marking && !following && isToday)} /> : null}
                </Fragment>
              );
            })}
          </div>
        )}
        <p className="flex items-start gap-1.5 text-xs text-ds-ink-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> A classificação organiza a jornada e os avisos. Alterá-la não muda o horário nem o registro fiscal da batida.
        </p>
      </PanelSection>

      {work || effective.length ? <PolicySection day={day} today={today} bank={bank} difference={difference} toleranceApplied={toleranceApplied} /> : null}

      {adjustmentState === "pilot" ? (
        <div className="space-y-2 rounded-ds-sm bg-ds-warn-bg px-3 py-2 text-xs text-ds-warn">
          <p>A solicitação será uma simulação analisável pelo DP, sem alterar ponto, banco, espelho, folha ou documentos fiscais.</p>
          <Button type="button" variant="ds-secondary" size="sm" onClick={() => onRequestAdjustment(day.date)}>Simular correção das batidas</Button>
        </div>
      ) : null}
      {adjustmentState === "available" || onRecord ? (
        <div className="sticky bottom-0 -mx-6 -mb-5 mt-auto flex flex-wrap gap-2 border-t border-ds-border bg-ds-warm px-6 py-3">
          {onRecord ? (
            <Button type="button" variant="primary-page" className="flex-1" onClick={onRecord}><Clock3 className="h-4 w-4" aria-hidden /> Registrar {next.position}</Button>
          ) : null}
          {adjustmentState === "available" ? (
            <Button type="button" variant="ds-secondary" className="flex-1" onClick={() => onRequestAdjustment(day.date)}>Solicitar correção das batidas</Button>
          ) : null}
        </div>
      ) : null}
    </SidePanel>
  );
}

/** Política de horas do dia: faixa, tolerância e para onde vai cada minuto, pelas linhas da apuração. */
function PolicySection({ day, today, bank, difference, toleranceApplied }: {
  day: DayView; today: string; bank: DayBank | "unavailable" | null; difference: number | null; toleranceApplied: boolean;
}) {
  const work = day.shift?.type === "work" ? day.shift : null;
  const tolerance = toleranceOf(work);
  if (bank === "unavailable") {
    return <PanelSection title="Política de horas"><p className="text-sm text-ds-ink-muted">Não foi possível ler a apuração agora. As batidas acima continuam valendo.</p></PanelSection>;
  }
  if (!bank) return <PanelSection title="Política de horas"><p className="text-sm text-ds-ink-muted">Carregando a apuração do dia…</p></PanelSection>;
  if (!bank.policy) {
    return <PanelSection title="Política de horas"><p className="text-sm text-ds-ink-muted">Sem política de horas vinculada. O DP precisa vincular uma para apurar banco e hora extra.</p></PanelSection>;
  }
  const rows = bank.lines.map((item) => item.line);
  const issues = bank.reviewIssues.filter((issue) => issue !== "NIGHT_SHIFT");
  return (
    <PanelSection title="Política de horas" aside={`${bank.policy.name} · v${bank.policy.version}`}>
      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-ds-pill bg-ds-accent-soft px-2.5 py-0.5 text-[11.5px] font-bold text-ds-accent-ink">
          {day.date === today ? "Hoje" : work ? "Dia de escala" : day.shift ? "Folga" : "Fora da escala"}
        </span>
        <span className="rounded-ds-pill border border-ds-border bg-ds-surface px-2.5 py-0.5 text-[11.5px] font-bold text-ds-ink-2">
          {bank.policy.enabled ? "Banco de horas ligado" : "Banco de horas desligado"}
        </span>
        {tolerance ? <span className="rounded-ds-pill border border-ds-border bg-ds-surface px-2.5 py-0.5 text-[11.5px] font-bold text-ds-ink-2">Tolerância da jornada {tolerance} min</span> : null}
      </div>
      {work && day.markings.length && !day.absence ? (
        <div className="space-y-1 rounded-ds-md bg-ds-surface px-3.5 py-2.5 text-[13px]">
          <p className="flex justify-between gap-3"><span className="text-ds-ink-2">Trabalhado{day.date === today ? " (períodos fechados)" : ""}</span><strong className="font-ds-mono">{durationLabel(day.workedMinutes)}</strong></p>
          <p className="flex justify-between gap-3"><span className="text-ds-ink-2">Jornada líquida prevista</span><strong className="font-ds-mono">− {durationLabel(day.plannedWorkMinutes ?? 0)}</strong></p>
          {toleranceApplied ? <p className="text-xs font-semibold text-ds-ok">Diferença de {durationLabel(Math.abs(difference!))} dentro da tolerância: conta como no horário.</p> : null}
          <p className="flex justify-between gap-3 border-t border-ds-divider pt-1.5 font-extrabold"><span>Resultado</span>
            <span className={cn("font-ds-mono", difference && !toleranceApplied ? (difference > 0 ? "text-ds-ok" : "text-ds-danger") : "text-ds-ink")}>
              {difference === null ? "—" : toleranceApplied ? "0h00" : durationLabel(difference, true)}</span></p>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-ds-ink-faint">Para onde vai</p>
        {day.date === today ? (
          <DestinationRow mark="…" tone="bg-ds-neutral-bg text-ds-ink-muted" title="Ainda em curso" detail="O destino é definido pela apuração depois da última batida." value="—" />
        ) : rows.length ? rows.map((line, index) => {
          const nature = NATURE[line.nature];
          return <DestinationRow key={index} mark={nature.mark} tone={nature.tone} title={nature.title(line)} preview={bank.preview}
            detail={`${REASON_LABELS[line.reason]}${bank.preview ? " · pode mudar com ajustes, ausências e a conferência do DP" : ""}`}
            value={`${nature.sign < 0 ? "−" : nature.sign > 0 ? "+" : ""}${durationLabel(line.minutes)}`} />;
        }) : issues.length ? (
          <DestinationRow mark="?" tone="bg-ds-caution-bg text-ds-caution" title="Nada lançado enquanto o dia estiver em conferência"
            detail={issues.map((issue) => ISSUE_LABELS[issue as BankIssue] ?? issue).join(" · ")} value="—" />
        ) : (
          <DestinationRow mark="=" tone="bg-ds-neutral-bg text-ds-ink-muted" title="Nada a lançar" detail={day.absence ? "Ausência sem efeito no banco ou na folha." : "Trabalhado igual ao previsto, ou dentro da tolerância."} value="0h00" />
        )}
        {day.nightMinutes ? (
          <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-ds-sm bg-ds-modal-soft text-ds-modal-ink"><Moon className="h-3.5 w-3.5" aria-hidden /></span>
            <span className="min-w-0"><span className="block text-[13px] font-bold text-ds-ink">Hora noturna (22h–5h)</span>
              <span className="block text-[11.5px] text-ds-ink-muted">Tempo físico contado. Hora reduzida e adicional noturno são tratados na folha pelo DP.</span></span>
            <span className="font-ds-mono text-[15px] font-extrabold text-ds-ink">{durationLabel(day.nightMinutes)}</span>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-ds-ink-muted">{bank.preview ? "Prévia pela política vigente; o lançamento oficial sai no fechamento do mês." : "Apuração do mês fechado."}</p>
    </PanelSection>
  );
}

function DestinationRow({ mark, tone, title, detail, value, preview = false }: { mark: string; tone: string; title: string; detail: string; value: string; preview?: boolean }) {
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2">
      <span className={cn("flex h-7 w-7 items-center justify-center rounded-ds-sm text-[13px] font-extrabold", tone)} aria-hidden>{mark}</span>
      <span className="min-w-0"><span className="flex flex-wrap items-center gap-1.5 text-[13px] font-bold text-ds-ink">{title}
        {preview ? <StatusPill variant="neutral">Prévia</StatusPill> : null}</span><span className="block text-[11.5px] text-ds-ink-muted">{detail}</span></span>
      <span className="font-ds-mono text-[15px] font-extrabold text-ds-ink">{value}</span>
    </div>
  );
}
