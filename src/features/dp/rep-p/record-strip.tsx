"use client";

import { useState } from "react";
import { CheckCircle2, Clock3, FileText, MapPin } from "lucide-react";

import { ControlPanel } from "@/components/patterns/control-panel";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { fiscalClock, workedMinutes, type DayView } from "./day-model";
import { brDate, OfficialClockDisplay, ReceiptPill, saveFile } from "./marking-ui";
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
  return day.shift.expectedPunches ?? null;
}

/** Leitura pela ordem das batidas, só visual: o REP-P guarda o instante, não o tipo. */
export function suggestedLabel(index: number, expected: number | null) {
  if (index === 0) return "Entrada";
  if (expected !== null && index === expected - 1) return "Saída";
  if (expected !== null && index >= expected) return "Batida extra";
  return index % 2 === 1 ? "Saída p/ intervalo" : "Volta do intervalo";
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
  const { options, optionsError, unitId, setUnitId, canRecord } = marking;
  const [dialogOpen, setDialogOpen] = useState(false);
  const expected = expectedPunchesOf(day);
  const nextIndex = day.markings.length;
  const next = suggestedLabel(nextIndex, expected);
  const units = options?.executionUnits ?? [];
  const unitName = units.find((unit) => unit.id === unitId)?.name;
  const nowMinutes = (() => { const now = new Date(); return now.getHours() * 60 + now.getMinutes(); })();
  const blocked = options && !options.markingEnabled;
  const ineligible = options && options.markingEnabled && units.length === 0;
  const action = expected === null ? `Registrar ${nextIndex + 1}ª batida` : nextIndex < expected ? `Registrar ${nextIndex + 1}ª de ${expected}` : "Registrar batida extra";

  return (
    <ControlPanel className="mx-auto w-full max-w-[1180px] p-0">
      <div className="flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:gap-6">
        <div className="shrink-0">
          {options ? <OfficialClockDisplay clock={options.officialClock} tone="dark" /> : <p className="text-sm text-ds-on-dark-muted">Carregando…</p>}
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
                {units.length > 1 ? (
                  <select aria-label="Unidade onde você está trabalhando" value={unitId} onChange={(event) => setUnitId(event.target.value)}
                    className="h-8 rounded-ds-sm border border-white/15 bg-white/[0.07] px-2 text-[13px] font-semibold text-white">
                    {units.map((unit) => <option key={unit.id} value={unit.id} className="text-ds-ink">{unit.name}</option>)}
                  </select>
                ) : <strong className="text-white">{units[0].name}</strong>}
              </>
            ) : null}
          </p>
          <button type="button" onClick={onOpenDay} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-left" aria-label="Ver as batidas de hoje">
            <MarkingSequence day={day} today={today} dark />
            <span className="text-[11px] text-ds-on-dark-muted">{hm(workedMinutes(day.markings, nowMinutes))} trabalhadas</span>
          </button>
          {optionsError ? <p role="alert" className="text-[12px] font-semibold text-ds-caution-tile">{optionsError}</p> : null}
        </div>
        <div className="shrink-0 md:text-right">
          <Button type="button" variant="primary-page" className="w-full md:w-auto" disabled={!canRecord} onClick={() => setDialogOpen(true)}>
            <Clock3 className="h-4 w-4" aria-hidden /> {action}
          </Button>
          <p className="mt-1 text-[11px] text-ds-on-dark-muted">
            {blocked ? "Registro pelo sistema ainda não liberado" : ineligible ? "Vínculo de hoje sem registro de ponto" : `Próxima: ${nextIndex + 1}ª batida (sugestão: ${next.toLowerCase()})`}
          </p>
        </div>
      </div>
      <RecordDialog open={dialogOpen} onOpenChange={setDialogOpen} marking={marking} unitName={unitName ?? ""}
        label={next} index={nextIndex} onRecorded={onRecorded} />
    </ControlPanel>
  );
}

/** Confirmação antes de registrar e, depois, NSR e comprovante. Não fecha com a batida em andamento. */
function RecordDialog({ open, onOpenChange, marking, unitName, label, index, onRecorded }: {
  open: boolean; onOpenChange: (open: boolean) => void; marking: Marking; unitName: string; label: string; index: number; onRecorded: () => void;
}) {
  const { options, recording, recordError, record, lastMarking, setLastMarking, canRecord, fetchReceiptFile } = marking;
  const [downloading, setDownloading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  function changeOpen(next: boolean) {
    if (!next && recording) return;
    if (!next) { setLastMarking(null); setReceiptError(null); }
    onOpenChange(next);
  }
  async function confirm() {
    await record();
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
              <OfficialClockDisplay clock={options?.officialClock ?? null} />
              <p className="mt-1 text-xs text-ds-ink-muted">A hora gravada é a do servidor, no momento da confirmação.</p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-ds-ink-muted">Unidade</dt><dd className="font-bold text-ds-ink">{unitName}</dd>
              <dt className="text-ds-ink-muted">Sugestão</dt>
              <dd className="font-bold text-ds-ink">{label} <span className="font-normal text-ds-ink-muted">(sugerida pela ordem das batidas)</span></dd>
            </dl>
            {recordError ? <p role="alert" className="text-sm font-semibold text-ds-danger">{recordError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ds-ghost" onClick={() => changeOpen(false)} disabled={recording}>Cancelar</Button>
              <Button type="button" variant="primary-modal" loading={recording} loadingLabel="Registrando…" disabled={!canRecord} onClick={() => void confirm()}>
                <Clock3 className="h-4 w-4" aria-hidden /> Confirmar registro
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
