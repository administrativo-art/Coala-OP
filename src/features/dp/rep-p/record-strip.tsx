"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, Coffee, FileText, Info, MapPin, RotateCw } from "lucide-react";

import { ControlPanel } from "@/components/patterns/control-panel";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { errorMessageOf, PanelSelectField } from "@/components/patterns/panel-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { breakStatus, journeyStartStatus, plannedPausesOf, type BreakLevel } from "./break-status";
import { fiscalClock, minutesOf, workedMinutes, type DayShift, type DayView } from "./day-model";
import { brDate, LocationCaptureNotice, LocationResultNotice, OfficialClockDisplay, ReceiptPill, saveFile } from "./marking-ui";
import { formatOfficialClock } from "./official-clock";
import type { useRepPMarking } from "./use-rep-p-marking";

type Marking = ReturnType<typeof useRepPMarking>;

export function hm(minutes: number, signed = false) {
  const sign = minutes < 0 ? "−" : signed && minutes > 0 ? "+" : "";
  const abs = Math.abs(minutes);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

/** Batidas esperadas no dia: a do turno; sem cadastro, uma a mais que as feitas (sem inventar pares). */
export function expectedPunchesOf(day: DayView) {
  if (!day.shift || day.shift.type !== "work" || day.absence) return day.markings.length;
  if (day.shift.expectedPunches) return day.shift.expectedPunches;
  // Sem cadastro: 2 + 2 por pausa prevista; pausas em aberto deixam a conta aberta.
  if (day.shift.breakType === "none") return 2;
  const pauses = plannedPausesOf(day.shift);
  return pauses === null ? null : 2 + 2 * pauses;
}

const BREAK_NOTES: Record<string, string> = {
  fixed_single: "Fixo único: um horário definido de início e fim. A batida avisa a proximidade do início e do fim.",
  fixed_multi: "Fixo intercalado: vários horários definidos. Cada pausa tem seu aviso.",
  free: "Livre: só a duração; você escolhe quando. Aqui aparece até que horas o intervalo precisa começar para caber antes do fim do turno.",
  free_multi: "Intercalado livre: a duração total pode ser dividida em pausas. Aqui aparecem o tempo usado, o que falta e o limite para iniciar.",
  window: "Janela livre: uma pausa dentro de um período. Enquanto o intervalo não começa, aparece o limite para iniciar (fim da janela menos a duração).",
  window_multi: "Janela intercalada livre: a duração total dentro do período, em várias pausas, com o limite calculado sobre o que falta.",
};
const BREAK_TONE: Record<BreakLevel, string> = {
  neutral: "border-white/10 bg-white/[0.04] text-ds-on-dark-2",
  info: "border-ds-info/40 bg-ds-info/15 text-white",
  warn: "border-ds-caution-border/40 bg-ds-caution-tile/15 text-ds-caution-tile",
  danger: "border-ds-trouble-border/50 bg-ds-danger/20 text-ds-trouble-bg",
  ok: "border-ds-ok-bg/30 bg-ds-ok/15 text-ds-ok-bg",
};

function modalityKey(shift: DayShift) {
  if (shift.breakType === "fixed") return shift.breakSegments?.length ? "fixed_multi" : "fixed_single";
  const multiple = shift.breakSplit === "multiple";
  return shift.breakType === "staggered" ? (multiple ? "window_multi" : "window") : (multiple ? "free_multi" : "free");
}

/** Minutos do dia agora, no fuso informado (o da unidade da batida). */
function nowMinutesIn(timeZone: string | undefined) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
}

/** Aviso "Intervalo de hoje" da faixa; recalcula a cada 30 s, sem ler o banco, e nunca bloqueia a batida. */
function BreakNotice({ day, timeZone }: { day: DayView; timeZone?: string }) {
  const [now, setNow] = useState(() => nowMinutesIn(timeZone));
  const [showNote, setShowNote] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowMinutesIn(timeZone)), 30_000);
    return () => window.clearInterval(timer);
  }, [timeZone]);
  const beforeJourney = journeyStartStatus(day.shift, day.markings, now);
  const status = beforeJourney ? null : breakStatus(day.shift, day.markings, now);
  if ((!status && !beforeJourney) || !day.shift) return null;
  if (beforeJourney) {
    return (
      <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-ds-sm border px-2.5 py-1 text-[11.5px]", BREAK_TONE.neutral)} role="status">
        <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <strong className="font-bold">{beforeJourney.headline}</strong>
        {beforeJourney.detail ? <span className="opacity-80">· {beforeJourney.detail}</span> : null}
      </p>
    );
  }
  if (!status) return null;
  const key = modalityKey(day.shift);
  return (
    <div className={cn("rounded-ds-sm border px-2.5 py-1 text-[11.5px]", BREAK_TONE[status.level])} role="status">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Coffee className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <strong className="font-bold">{status.headline}</strong>
        {status.detail ? <span className="opacity-80">· {status.detail}</span> : null}
        <button type="button" onClick={() => setShowNote((current) => !current)} className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold opacity-80 hover:opacity-100">
          <Info className="h-3 w-3" aria-hidden /> Como funciona
        </button>
      </p>
      {showNote ? <p className="mt-1 border-t border-white/10 pt-1 text-[11px] opacity-90">{BREAK_NOTES[key]} São avisos para ajudar; nada impede a batida.</p> : null}
    </div>
  );
}

/** Leitura pela ordem das batidas, só visual: o REP-P guarda o instante, não o tipo. */
export function suggestedLabel(index: number, expected: number | null) {
  if (index === 0) return "Entrada";
  if (expected !== null && index === expected - 1) return "Saída";
  if (expected !== null && index >= expected) return "Batida extra";
  return index % 2 === 1 ? "Saída p/ intervalo" : "Volta do intervalo";
}

export const MARKING_PURPOSES = [
  ["journey_start", "Início da jornada"], ["break_start", "Início do intervalo"],
  ["break_end", "Volta do intervalo"], ["journey_end", "Fim da jornada"],
] as const;
export type MarkingPurpose = typeof MARKING_PURPOSES[number][0];
export function purposeLabel(value: string | null | undefined) {
  return MARKING_PURPOSES.find(([id]) => id === value)?.[1] ?? "Classificação pendente";
}
export function suggestedPurpose(markings: DayView["markings"], shift?: DayShift | null): MarkingPurpose {
  const last = markings.at(-1)?.classification?.purpose;
  if (!last) return "journey_start";
  if (last === "journey_start") return "break_start";
  if (last === "break_start") return "break_end";
  if (last === "break_end") {
    const completedPauses = markings.filter((marking) => marking.classification?.purpose === "break_end").length;
    const plannedPauses = shift?.type === "work" ? plannedPausesOf(shift) : 1;
    if (plannedPauses !== null && completedPauses < plannedPauses) return "break_start";
    if (plannedPauses === null && shift?.breakDurationMinutes) {
      let start: number | null = null;
      let used = 0;
      for (const marking of markings) {
        const purpose = marking.classification?.purpose;
        const time = minutesOf(fiscalClock(marking.markedAt));
        if (purpose === "break_start") start = time;
        if (purpose === "break_end" && start !== null) { used += Math.max(0, time - start); start = null; }
      }
      if (used < shift.breakDurationMinutes) return "break_start";
    }
    return "journey_end";
  }
  return "journey_start";
}

/** Cor da finalidade, igual à do Coala Go: início em verde, intervalo em azul, fim em grafite; sem classificação, tracejado. */
export const PURPOSE_DOT: Record<MarkingPurpose, string> = {
  journey_start: "bg-ds-ok", break_start: "bg-ds-info", break_end: "bg-ds-info", journey_end: "bg-ds-ink",
};
export function PurposeDot({ purpose, className }: { purpose: MarkingPurpose | null | undefined; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full",
    purpose ? PURPOSE_DOT[purpose] : "border border-dashed border-current opacity-60", className)} />;
}

/** Leitura da jornada de hoje pela última finalidade declarada; só visual, não muda a batida. */
export function journeyState(day: DayView) {
  const first = day.markings[0];
  const last = day.markings.at(-1);
  if (!first || !last) return "Jornada não iniciada";
  const purpose = last.classification?.purpose;
  if (purpose === "journey_end") return `Jornada encerrada às ${fiscalClock(last.markedAt)}`;
  if (purpose === "break_start") return `Em intervalo desde ${fiscalClock(last.markedAt)}`;
  return `Em jornada desde ${fiscalClock(first.markedAt)}`;
}

/** Próxima batida: posição na sequência do turno e a finalidade sugerida (organizacional; qualquer uma é aceita). */
export function nextMarkingOf(day: DayView) {
  const expected = expectedPunchesOf(day);
  const index = day.markings.length;
  const purpose = suggestedPurpose(day.markings, day.shift);
  const reliable = day.markings.length === 0 || day.markings.every((marking) => marking.classification?.purpose);
  const position = expected === null ? `${index + 1}ª batida` : index < expected ? `${index + 1}ª de ${expected}` : "batida extra";
  return { expected, index, purpose, reliable, position, extra: expected !== null && index >= expected };
}

/** Sequência numerada das batidas do dia, com a finalidade de cada uma; a que falta num dia passado aparece em vermelho. */
export function MarkingSequence({ day, today, dark, highlightNext = false }: { day: DayView; today: string; dark?: boolean; highlightNext?: boolean }) {
  const expected = expectedPunchesOf(day);
  const slots = Math.max(expected ?? day.markings.length + 1, day.markings.length);
  const past = day.date < today;
  const next = nextMarkingOf(day);
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {Array.from({ length: slots }, (_, index) => {
        const marking = day.markings[index];
        const missing = !marking && past;
        const isNext = highlightNext && !past && index === day.markings.length;
        const purpose = marking?.classification?.purpose ?? null;
        const label = marking ? (purpose ? purposeLabel(purpose) : suggestedLabel(index, expected))
          : isNext && next.reliable ? purposeLabel(next.purpose) : null;
        return (
          <span key={index} className={cn("inline-flex items-center gap-1.5",
            isNext && "rounded-ds-sm border border-ds-accent-kicker/50 bg-ds-accent-kicker/10 px-1.5 py-0.5")}>
            <span className={cn(marking ? (dark ? "text-white" : "text-ds-ink") : missing ? "text-ds-danger" : dark ? "text-ds-on-dark-muted" : "text-ds-ink-faint")}>
              <PurposeDot purpose={marking ? purpose : null} className={marking && !purpose ? "border-solid bg-current" : undefined} />
            </span>
            <span className={cn("font-ds-mono text-[13px] font-bold tabular-nums",
              marking ? (dark ? "text-white" : "text-ds-ink") : missing ? "text-ds-danger" : dark ? "text-ds-on-dark-muted" : "text-ds-ink-faint")}>
              {marking ? fiscalClock(marking.markedAt) : "··:··"}
            </span>
            {label && (dark || isNext) ? <span className={cn("text-[11px]", isNext ? (dark ? "text-white" : "text-ds-ink") : dark ? "text-ds-on-dark-muted" : "text-ds-ink-muted")}>{label}</span> : null}
          </span>
        );
      })}
    </span>
  );
}

/** Botão principal da batida: reenviar, indisponível ou "Registrar Nª de N". Usado na faixa, no painel e na barra. */
export function recordActionLabel(marking: Marking, day: DayView) {
  if (marking.pendingAttempt) return "Reenviar a mesma batida";
  if (marking.options && !marking.options.markingEnabled) return "Registro indisponível";
  if (marking.options?.officialClock && !marking.options.officialClock.available) return "Hora Legal indisponível";
  const next = nextMarkingOf(day);
  return next.extra ? "Registrar batida extra" : next.expected === null ? `Registrar ${next.index + 1}ª batida` : `Registrar ${next.position}`;
}

/** Faixa escura de registro: hora oficial, estado da jornada, sequência com finalidade e a ação principal. */
export function RecordStrip({ marking, day, today, onOpenDay, onRecorded, dialogOpen: controlledOpen, onDialogOpenChange }: {
  marking: Marking; day: DayView; today: string; onOpenDay: () => void; onRecorded: () => void;
  /** Controle opcional da janela, para o detalhe do dia abrir a mesma confirmação. */
  dialogOpen?: boolean; onDialogOpenChange?: (open: boolean) => void;
}) {
  const { options, optionsError, unitId, setUnitId, canRecord, unitClock, pendingAttempt } = marking;
  const [localOpen, setLocalOpen] = useState(false);
  const dialogOpen = controlledOpen ?? localOpen;
  const setDialogOpen = onDialogOpenChange ?? setLocalOpen;
  const next = nextMarkingOf(day);
  const units = options?.executionUnits ?? [];
  const unitName = units.find((unit) => unit.id === unitId)?.name;
  // Turno com unidade fixa: a unidade da escala vem escolhida; trocar é possível e não bloqueia a batida.
  const work = day.shift?.type === "work" ? day.shift : null;
  const freeUnit = work?.executionUnitPolicy === "free";
  const scheduledUnitId = work && !freeUnit && work.unitId && units.some((unit) => unit.id === work.unitId) ? work.unitId : null;
  const [otherUnit, setOtherUnit] = useState(false);
  useEffect(() => {
    if (scheduledUnitId && !otherUnit && !pendingAttempt && unitId !== scheduledUnitId) setUnitId(scheduledUnitId);
  }, [scheduledUnitId, otherUnit, pendingAttempt, unitId, setUnitId]);
  const showSelect = !pendingAttempt && units.length > 1 && (!scheduledUnitId || otherUnit);
  const nowMinutes = (() => { const now = new Date(); return now.getHours() * 60 + now.getMinutes(); })();
  const blocked = options && !options.markingEnabled;
  const pilot = options?.mode === "pilot";
  const ineligible = options && options.markingEnabled && units.length === 0;
  const pendingTime = pendingAttempt?.firstTriedAt && unitClock?.available ? formatOfficialClock(Date.parse(pendingAttempt.firstTriedAt), unitClock.timeZone).slice(0, 5) : null;

  return (
    <ControlPanel className="mx-auto w-full max-w-[1180px] p-0">
      <div className="flex flex-col gap-3 px-5 py-3 md:flex-row md:items-center md:gap-6">
        <div className="shrink-0">
          {options ? <OfficialClockDisplay clock={unitClock} tone="dark" /> : <p className="text-sm text-ds-on-dark-muted">Carregando…</p>}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ds-on-dark-2">
            <strong className="text-[13px] text-white">{journeyState(day)}</strong>
            {day.markings.length ? <span>{hm(workedMinutes(day.markings, nowMinutes))} até agora</span> : null}
            <span className="text-ds-on-dark-muted" aria-hidden>·</span>
            {day.shift?.type === "work"
              ? <span>{day.shift.shiftName ?? "Turno"} {day.shift.startTime}–{day.shift.endTime}</span>
              : <span>{day.shift ? "Folga na escala" : "Sem escala publicada"}</span>}
            {units.length ? (
              <>
                <span className="text-ds-on-dark-muted" aria-hidden>·</span>
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                {showSelect ? (
                  <select aria-label="Unidade onde você está trabalhando" value={unitId} onChange={(event) => setUnitId(event.target.value)}
                    className="h-7 rounded-ds-sm border border-white/15 bg-white/[0.07] px-2 text-[12.5px] font-semibold text-white">
                    {units.map((unit) => <option key={unit.id} value={unit.id} className="text-ds-ink">{unit.name}{unit.id === scheduledUnitId ? " (da escala)" : ""}</option>)}
                  </select>
                ) : <strong className="text-white">{unitName ?? units[0].name}</strong>}
                {pendingAttempt ? null : freeUnit ? <span className="text-[11px] text-ds-on-dark-muted">turno volante</span>
                  : scheduledUnitId && units.length > 1 ? (otherUnit
                    ? <button type="button" className="text-[11px] font-bold underline" onClick={() => { setOtherUnit(false); setUnitId(scheduledUnitId); }}>usar a da escala</button>
                    : <button type="button" className="text-[11px] font-bold text-ds-on-dark-muted underline hover:text-white" onClick={() => setOtherUnit(true)}>outra unidade?</button>)
                    : null}
              </>
            ) : null}
          </p>
          <button type="button" onClick={onOpenDay} className="block text-left" aria-label="Ver as batidas de hoje">
            <MarkingSequence day={day} today={today} dark highlightNext />
          </button>
          <BreakNotice day={day} timeZone={unitClock?.available ? unitClock.timeZone : undefined} />
          {work?.assignmentKind === 'external_coverage' && scheduledUnitId ? (
            <p className="text-[11px] font-semibold text-ds-on-dark-2">Você foi escalado excepcionalmente para {work.unitName ?? unitName ?? 'esta unidade'} nesta data.</p>
          ) : null}
          {otherUnit && unitId !== scheduledUnitId ? <p className="text-[11px] text-ds-on-dark-muted">A batida é registrada normalmente; o DP confere a troca de unidade.</p> : null}
          {optionsError ? <p role="alert" className="text-[12px] font-semibold text-ds-caution-tile">{optionsError}</p> : null}
        </div>
        <div className="shrink-0 space-y-1 md:text-right">
          {pendingAttempt ? (
            <p className="max-w-[260px] text-[11.5px] text-ds-caution-tile md:ml-auto">
              Tentativa{pendingTime ? ` feita por volta das ${pendingTime}` : ""} ficou sem resposta. Reenvie para confirmar sem duplicar.
            </p>
          ) : !blocked && !ineligible ? (
            <p className="text-[11.5px] text-ds-on-dark-2">
              Próxima: <strong className="text-white">{next.position}{next.reliable ? ` · ${purposeLabel(next.purpose).toLowerCase()}` : ""}</strong>
            </p>
          ) : null}
          <Button type="button" variant={pendingAttempt ? "ds-secondary" : "primary-page"} className="w-full md:w-auto" disabled={!canRecord} onClick={() => setDialogOpen(true)}>
            {pendingAttempt ? <RotateCw className="h-4 w-4" aria-hidden /> : <Clock3 className="h-4 w-4" aria-hidden />} {recordActionLabel(marking, day)}
          </Button>
          {!pendingAttempt && !blocked && !ineligible ? <p className="text-[10.5px] text-ds-on-dark-muted">A hora gravada é a do servidor ao confirmar.</p> : null}
          {blocked || ineligible || pilot || !next.reliable ? (
            <p className="text-[11px] text-ds-on-dark-muted">
              {blocked ? "Registro pelo sistema ainda não liberado" : ineligible ? "Vínculo de hoje sem registro de ponto"
                : pilot ? "Ensaio controlado: fora do fechamento oficial" : "Há batida anterior sem classificação: escolha a finalidade"}
            </p>
          ) : null}
        </div>
      </div>
      <RecordDialog open={dialogOpen} onOpenChange={setDialogOpen} marking={marking} day={day} onRecorded={onRecorded} />
    </ControlPanel>
  );
}

/**
 * Confirmação antes de registrar e, depois, NSR e comprovante. Não fecha com a batida em andamento.
 * Com tentativa sem resposta, vira "Reenviar a mesma batida": mostra a hora da primeira tentativa e trava a finalidade.
 */
export function RecordDialog({ open, onOpenChange, marking, day, onRecorded, chooseUnit = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; marking: Marking; day: DayView; onRecorded?: () => void;
  /** Fora da faixa (painel e barra) a unidade é escolhida na própria janela. */
  chooseUnit?: boolean;
}) {
  const { recording, recordError, record, lastMarking, setLastMarking, canRecord, fetchReceiptFile, unitClock,
    locationCaptureState, unitLocationPolicy, pendingAttempt, options, unitId, setUnitId } = marking;
  const units = options?.executionUnits ?? [];
  const unitName = units.find((unit) => unit.id === unitId)?.name ?? "";
  const next = nextMarkingOf(day);
  const [downloading, setDownloading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<MarkingPurpose | null>(next.reliable ? next.purpose : null);
  const [recordedIndex, setRecordedIndex] = useState(next.index);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  useEffect(() => setPurpose(next.reliable ? next.purpose : null), [next.purpose, next.reliable, open]);
  const chosen = pendingAttempt?.purpose ?? purpose;
  const pendingTime = pendingAttempt?.firstTriedAt && unitClock?.available ? formatOfficialClock(Date.parse(pendingAttempt.firstTriedAt), unitClock.timeZone) : null;

  function changeOpen(next: boolean) {
    if (!next && recording) return;
    if (!next) { setLastMarking(null); setReceiptError(null); setConfirmingDiscard(false); marking.resetDialog(); }
    onOpenChange(next);
  }
  async function confirm() {
    if (!chosen) return;
    setRecordedIndex(next.index);
    await record(chosen);
    onRecorded?.();
  }
  async function download() {
    if (!lastMarking) return;
    setDownloading(true);
    setReceiptError(null);
    try {
      saveFile(await fetchReceiptFile(lastMarking.receiptId, lastMarking.marking.nsr, lastMarking.marking.markedAt));
    } catch (error) {
      setReceiptError(errorMessageOf(error, "Não foi possível abrir o comprovante."));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-md">
        {lastMarking ? (
          <div className="space-y-4 text-center" role="status">
            <CheckCircle2 className="mx-auto h-12 w-12 text-ds-ok" aria-hidden />
            <DialogHeader className="items-center text-center sm:text-center">
              <DialogTitle>{lastMarking.pilot ? "Ensaio registrado" : "Ponto registrado"}</DialogTitle>
              <DialogDescription>{lastMarking.status === "replayed" ? "A batida já estava gravada; nada foi duplicado." : `${recordedIndex + 1}ª batida de hoje`}</DialogDescription>
            </DialogHeader>
            <p className="font-ds-mono text-[44px] font-extrabold leading-none text-ds-ink">{fiscalClock(lastMarking.marking.markedAt)}</p>
            <p className="text-sm text-ds-ink-muted">{brDate(lastMarking.marking.markedAt)} · {unitName} · {lastMarking.pilot ? "Sequência do ensaio" : "NSR"} {lastMarking.marking.nsr}</p>
            {lastMarking.pilot ? <p className="rounded-ds-md border border-ds-warn/20 bg-ds-warn-bg px-3 py-2 text-xs font-semibold text-ds-warn">Teste sem validade como REP-P. Não entra no fechamento oficial.</p> : null}
            <LocationResultNotice location={lastMarking.location} />
            <div className="space-y-2 rounded-ds-md border border-ds-border bg-ds-warm p-3">
              <ReceiptPill status={lastMarking.receiptStatus} />
              {lastMarking.receiptStatus === "available" ? (
                <Button type="button" variant="ds-secondary" size="sm" loading={downloading} loadingLabel="Abrindo…" onClick={() => void download()}>
                  <FileText className="h-4 w-4" aria-hidden /> Baixar comprovante
                </Button>
              ) : <p className="text-xs text-ds-ink-muted">O ponto está registrado. O comprovante aparece no dia assim que for emitido.</p>}
              {receiptError ? <p role="alert" className="text-xs font-semibold text-ds-danger">{receiptError}</p> : null}
            </div>
            <Button type="button" variant="primary-modal" className="w-full" onClick={() => changeOpen(false)}>Fechar</Button>
          </div>
        ) : pendingAttempt ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Reenviar a mesma batida</DialogTitle>
              <DialogDescription>A primeira tentativa não teve resposta. O reenvio usa a mesma identificação: se ela já chegou, nada é duplicado e você recebe a batida gravada com o comprovante.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1 rounded-ds-md border border-ds-caution-border bg-ds-caution-bg px-3.5 py-3 text-xs text-ds-ink-2">
              <p><strong className="text-ds-ink">Tentativa feita por volta das {pendingTime ? pendingTime.slice(0, 5) : "—"}</strong> (estimada pela tela, sem valor de registro).</p>
              <p>Se a primeira tentativa não chegou, a batida será gravada na hora do reenvio, não nesta. A hora que vale é a do comprovante.</p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-ds-ink-muted">Unidade</dt><dd className="font-bold text-ds-ink">{unitName}</dd>
              <dt className="text-ds-ink-muted">Finalidade</dt>
              <dd className="flex items-center gap-2 font-bold text-ds-ink"><PurposeDot purpose={pendingAttempt.purpose} />{purposeLabel(pendingAttempt.purpose)} <span className="text-xs font-semibold text-ds-ink-muted">(travada)</span></dd>
            </dl>
            {recordError ? <p role="alert" className="text-sm font-semibold text-ds-danger">{recordError}</p> : null}
            {confirmingDiscard ? (
              <InlineConfirm message="Descartar a tentativa? Se ela chegou ao servidor, a batida continua registrada: confira as batidas do dia antes de registrar de novo."
                confirmLabel="Descartar tentativa" onConfirm={() => { marking.discardPendingAttempt(); setConfirmingDiscard(false); }} onCancel={() => setConfirmingDiscard(false)} />
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ds-ghost" className="mr-auto" onClick={() => setConfirmingDiscard(true)} disabled={recording || confirmingDiscard}>Descartar tentativa</Button>
              <Button type="button" variant="ds-ghost" onClick={() => changeOpen(false)} disabled={recording}>Agora não</Button>
              <Button type="button" variant="primary-modal" loading={recording} loadingLabel="Reenviando…" disabled={!canRecord} onClick={() => void confirm()}>
                <RotateCw className="h-4 w-4" aria-hidden /> Reenviar batida
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Registrar {next.position}</DialogTitle>
              <DialogDescription>{marking.options?.mode === "pilot"
                ? "Confira antes de registrar. Este ensaio fica separado do ponto oficial e não entra no fechamento."
                : "Confira antes de registrar. A batida não pode ser apagada depois."}</DialogDescription>
            </DialogHeader>
            <div className="rounded-ds-md border border-ds-border bg-ds-warm p-4 text-center">
              <OfficialClockDisplay clock={unitClock} />
              <p className="mt-1 text-xs text-ds-ink-muted">A hora gravada é a do servidor, no momento da confirmação.</p>
            </div>
            {chooseUnit && units.length > 1 ? (
              <PanelSelectField id="record-execution-unit" label="Unidade onde você está trabalhando" value={unitId}
                onChange={setUnitId} options={units} />
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-ds-ink-muted">Unidade</dt><dd className="font-bold text-ds-ink">{unitName}</dd>
              </dl>
            )}
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-bold text-ds-ink">O que este registro representa?</legend>
              {MARKING_PURPOSES.map(([id, label]) => <label key={id} className="flex min-h-12 cursor-pointer items-center gap-2.5 rounded-ds-sm border border-ds-border px-3 py-2 text-sm">
                <input type="radio" name="marking-purpose" value={id} checked={purpose === id} onChange={() => setPurpose(id)} />
                <PurposeDot purpose={id} />
                <span className="font-semibold">{label}</span>{next.reliable && id === next.purpose ? <span className="ml-auto text-xs font-bold text-ds-accent-ink">Sugerida</span> : null}
              </label>)}
            </fieldset>
            <LocationCaptureNotice policy={unitLocationPolicy} state={locationCaptureState} />
            {recordError ? <p role="alert" className="text-sm font-semibold text-ds-danger">{recordError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ds-ghost" onClick={() => changeOpen(false)} disabled={recording}>Cancelar</Button>
              <Button type="button" variant="primary-modal" loading={recording} loadingLabel="Registrando…" disabled={!canRecord || !purpose} onClick={() => void confirm()}>
                <Clock3 className="h-4 w-4" aria-hidden /> Confirmar ponto
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
