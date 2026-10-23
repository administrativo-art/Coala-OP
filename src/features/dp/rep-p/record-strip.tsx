"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, Coffee, FileText, Info, MapPin } from "lucide-react";

import { ControlPanel } from "@/components/patterns/control-panel";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { breakStatus, plannedPausesOf, type BreakLevel } from "./break-status";
import { fiscalClock, minutesOf, workedMinutes, type DayShift, type DayView } from "./day-model";
import { brDate, LocationCaptureNotice, LocationResultNotice, OfficialClockDisplay, ReceiptPill, saveFile } from "./marking-ui";
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
  const status = breakStatus(day.shift, day.markings, now);
  if (!status || !day.shift) return null;
  const key = modalityKey(day.shift);
  return (
    <div className={cn("rounded-ds-md border px-3 py-2", BREAK_TONE[status.level])} role="status">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Coffee className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="text-[13px] font-bold">{status.headline}</span>
        <button type="button" onClick={() => setShowNote((current) => !current)} className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold opacity-80 hover:opacity-100">
          <Info className="h-3 w-3" aria-hidden /> Como funciona
        </button>
      </div>
      {status.detail ? <p className="mt-0.5 text-[11px] opacity-80">{status.detail}</p> : null}
      {showNote ? <p className="mt-1.5 border-t border-white/10 pt-1.5 text-[11px] opacity-90">{BREAK_NOTES[key]} São avisos para ajudar; nada impede a batida.</p> : null}
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

/** Sequência numerada das batidas do dia; a que falta num dia passado aparece em vermelho. */
export function MarkingSequence({ day, today, dark }: { day: DayView; today: string; dark?: boolean }) {
  const expected = expectedPunchesOf(day);
  const slots = Math.max(expected ?? day.markings.length + 1, day.markings.length);
  const past = day.date < today;
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {Array.from({ length: slots }, (_, index) => {
        const marking = day.markings[index];
        const missing = !marking && past;
        return (
          <span key={index} className="inline-flex items-center gap-1">
            <span className={cn("inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-extrabold",
              marking ? (dark ? "bg-white text-ds-ink" : "bg-ds-ink text-white")
                : missing ? "bg-ds-danger-bg text-ds-danger"
                  : dark ? "border border-dashed border-white/30 text-ds-on-dark-muted" : "border border-dashed border-ds-border text-ds-ink-faint")}>
              {index + 1}
            </span>
            <span className={cn("font-ds-mono text-[13px] font-bold tabular-nums",
              marking ? (dark ? "text-white" : "text-ds-ink") : missing ? "text-ds-danger" : dark ? "text-ds-on-dark-muted" : "text-ds-ink-faint")}>
              {marking ? fiscalClock(marking.markedAt) : "··:··"}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Faixa escura de registro: hora oficial, escala e unidade de hoje, sequência e a ação principal. */
export function RecordStrip({ marking, day, today, onOpenDay, onRecorded }: {
  marking: Marking; day: DayView; today: string; onOpenDay: () => void; onRecorded: () => void;
}) {
  const { options, optionsError, unitId, setUnitId, canRecord, unitClock } = marking;
  const [dialogOpen, setDialogOpen] = useState(false);
  const expected = expectedPunchesOf(day);
  const nextIndex = day.markings.length;
  const nextPurpose = suggestedPurpose(day.markings, day.shift);
  const suggestionReliable = day.markings.length === 0 || day.markings.every((marking) => marking.classification?.purpose);
  const units = options?.executionUnits ?? [];
  const unitName = units.find((unit) => unit.id === unitId)?.name;
  // Turno com unidade fixa: a unidade da escala vem escolhida; trocar é possível e não bloqueia a batida.
  const work = day.shift?.type === "work" ? day.shift : null;
  const freeUnit = work?.executionUnitPolicy === "free";
  const scheduledUnitId = work && !freeUnit && work.unitId && units.some((unit) => unit.id === work.unitId) ? work.unitId : null;
  const [otherUnit, setOtherUnit] = useState(false);
  useEffect(() => {
    if (scheduledUnitId && !otherUnit && unitId !== scheduledUnitId) setUnitId(scheduledUnitId);
  }, [scheduledUnitId, otherUnit, unitId, setUnitId]);
  const showSelect = units.length > 1 && (!scheduledUnitId || otherUnit);
  const nowMinutes = (() => { const now = new Date(); return now.getHours() * 60 + now.getMinutes(); })();
  const blocked = options && !options.markingEnabled;
  const ineligible = options && options.markingEnabled && units.length === 0;
  const action = expected === null ? `Registrar ${nextIndex + 1}ª batida` : nextIndex < expected ? `Registrar ${nextIndex + 1}ª de ${expected}` : "Registrar batida extra";

  return (
    <ControlPanel className="mx-auto w-full max-w-[1180px] p-0">
      <div className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:gap-6">
        <div className="shrink-0">
          {options ? <OfficialClockDisplay clock={unitClock} tone="dark" /> : <p className="text-sm text-ds-on-dark-muted">Carregando…</p>}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ds-on-dark-2">
            <span className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ds-accent-kicker">Hoje</span>
            {day.shift?.type === "work"
              ? <span>{day.shift.shiftName ?? "Turno"} {day.shift.startTime}–{day.shift.endTime}</span>
              : <span>{day.shift ? "Folga na escala" : "Sem escala publicada"}</span>}
            {units.length ? (
              <>
                <span className="text-ds-on-dark-muted" aria-hidden>·</span>
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                {showSelect ? (
                  <select aria-label="Unidade onde você está trabalhando" value={unitId} onChange={(event) => setUnitId(event.target.value)}
                    className="h-8 rounded-ds-sm border border-white/15 bg-white/[0.07] px-2 text-[13px] font-semibold text-white">
                    {units.map((unit) => <option key={unit.id} value={unit.id} className="text-ds-ink">{unit.name}{unit.id === scheduledUnitId ? " (da escala)" : ""}</option>)}
                  </select>
                ) : <strong className="text-white">{unitName ?? units[0].name}</strong>}
                {freeUnit ? <span className="text-[11px] text-ds-on-dark-muted">turno volante</span>
                  : scheduledUnitId && units.length > 1 ? (otherUnit
                    ? <button type="button" className="text-[11px] font-bold underline" onClick={() => { setOtherUnit(false); setUnitId(scheduledUnitId); }}>usar a da escala</button>
                    : <><span className="text-[11px] text-ds-on-dark-muted">da sua escala</span>
                      <button type="button" className="text-[11px] font-bold text-ds-on-dark-muted underline hover:text-white" onClick={() => setOtherUnit(true)}>outra unidade?</button></>)
                    : null}
              </>
            ) : null}
          </p>
          <button type="button" onClick={onOpenDay} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-left" aria-label="Ver as batidas de hoje">
            <MarkingSequence day={day} today={today} dark />
            <span className="text-[11px] text-ds-on-dark-muted">{hm(workedMinutes(day.markings, nowMinutes))} trabalhadas</span>
          </button>
          <BreakNotice day={day} timeZone={unitClock?.available ? unitClock.timeZone : undefined} />
          {otherUnit && unitId !== scheduledUnitId ? <p className="text-[11px] text-ds-on-dark-muted">A batida é registrada normalmente; o DP confere a troca de unidade.</p> : null}
          {optionsError ? <p role="alert" className="text-[12px] font-semibold text-ds-caution-tile">{optionsError}</p> : null}
        </div>
        <div className="shrink-0 md:text-right">
          <Button type="button" variant="primary-page" className="w-full md:w-auto" disabled={!canRecord} onClick={() => setDialogOpen(true)}>
            <Clock3 className="h-4 w-4" aria-hidden /> {action}
          </Button>
          <p className="mt-1 text-[11px] text-ds-on-dark-muted">
            {blocked ? "Registro pelo sistema ainda não liberado" : ineligible ? "Vínculo de hoje sem registro de ponto"
              : suggestionReliable ? `Sugestão: ${purposeLabel(nextPurpose).toLowerCase()}` : "Escolha a finalidade; há batida anterior sem classificação"}
          </p>
        </div>
      </div>
      <RecordDialog open={dialogOpen} onOpenChange={setDialogOpen} marking={marking} unitName={unitName ?? ""}
        suggestedPurpose={nextPurpose} suggestionReliable={suggestionReliable} index={nextIndex} onRecorded={onRecorded} />
    </ControlPanel>
  );
}

/** Confirmação antes de registrar e, depois, NSR e comprovante. Não fecha com a batida em andamento. */
function RecordDialog({ open, onOpenChange, marking, unitName, suggestedPurpose, suggestionReliable, index, onRecorded }: {
  open: boolean; onOpenChange: (open: boolean) => void; marking: Marking; unitName: string; suggestedPurpose: MarkingPurpose; suggestionReliable: boolean; index: number; onRecorded: () => void;
}) {
  const { recording, recordError, record, lastMarking, setLastMarking, canRecord, fetchReceiptFile, unitClock,
    locationCaptureState, unitLocationPolicy } = marking;
  const [downloading, setDownloading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<MarkingPurpose | null>(suggestionReliable ? suggestedPurpose : null);
  useEffect(() => setPurpose(suggestionReliable ? suggestedPurpose : null), [suggestedPurpose, suggestionReliable, open]);

  function changeOpen(next: boolean) {
    if (!next && recording) return;
    if (!next) { setLastMarking(null); setReceiptError(null); marking.discardPendingAttempt(); }
    onOpenChange(next);
  }
  async function confirm() {
    if (!purpose) return;
    await record(purpose);
    onRecorded();
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
              <DialogTitle>Ponto registrado</DialogTitle>
              <DialogDescription>{index + 1}ª batida de hoje{lastMarking.status === "replayed" ? " (já estava gravada)" : ""}</DialogDescription>
            </DialogHeader>
            <p className="font-ds-mono text-[44px] font-extrabold leading-none text-ds-ink">{fiscalClock(lastMarking.marking.markedAt)}</p>
            <p className="text-sm text-ds-ink-muted">{brDate(lastMarking.marking.markedAt)} · {unitName} · NSR {lastMarking.marking.nsr}</p>
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
        ) : (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Registrar {index + 1}ª batida</DialogTitle>
              <DialogDescription>Confira antes de registrar. A batida não pode ser apagada depois.</DialogDescription>
            </DialogHeader>
            <div className="rounded-ds-md border border-ds-border bg-ds-warm p-4 text-center">
              <OfficialClockDisplay clock={unitClock} />
              <p className="mt-1 text-xs text-ds-ink-muted">A hora gravada é a do servidor, no momento da confirmação.</p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-ds-ink-muted">Unidade</dt><dd className="font-bold text-ds-ink">{unitName}</dd>
            </dl>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-bold text-ds-ink">O que este registro representa?</legend>
              {MARKING_PURPOSES.map(([id, label]) => <label key={id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-ds-sm border border-ds-border px-3 py-2 text-sm">
                <input type="radio" name="marking-purpose" value={id} checked={purpose === id} onChange={() => setPurpose(id)} />
                <span className="font-semibold">{label}</span>{suggestionReliable && id === suggestedPurpose ? <span className="ml-auto text-xs text-ds-accent">Sugerida</span> : null}
              </label>)}
            </fieldset>
            <LocationCaptureNotice policy={unitLocationPolicy} state={locationCaptureState} />
            {recordError ? <p role="alert" className="text-sm font-semibold text-ds-danger">{recordError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ds-ghost" onClick={() => changeOpen(false)} disabled={recording}>Cancelar</Button>
              <Button type="button" variant="primary-modal" loading={recording} loadingLabel="Registrando…" disabled={!canRecord || !purpose} onClick={() => void confirm()}>
                <Clock3 className="h-4 w-4" aria-hidden /> Confirmar registro
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
