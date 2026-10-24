"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock3, FileText } from "lucide-react";

import { errorMessageOf, PanelSelectField } from "@/components/patterns/panel-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { brDate, fiscalTime, LocationCaptureNotice, LocationResultNotice, OfficialClockDisplay, ReceiptPill, saveFile } from "./marking-ui";
import { MARKING_PURPOSES, type MarkingPurpose } from "./record-strip";
import { useRepPMarking } from "./use-rep-p-marking";

const MY_TIME_RECORDING_PATH = "/dashboard/collaborator/time-recording";

/**
 * Atalho "Bater ponto" na barra superior. Só aparece com a coleta ligada e para quem tem vínculo habilitado hoje;
 * a janela relê a hora oficial ao abrir e registra pelo mesmo serviço de "Registro de ponto".
 */
export function QuickMarkingButton({ chipClassName }: { chipClassName: string }) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<MarkingPurpose | null>(null);
  const marking = useRepPMarking();
  const {
    options, optionsError, loadOptions, unitId, setUnitId, recording, recordError, record, lastMarking, setLastMarking, canRecord,
    fetchReceiptFile, unitClock, locationCaptureState, unitLocationPolicy, discardPendingAttempt,
  } = marking;

  if (!options?.markingEnabled || !options.eligible || options.executionUnits.length === 0) return null;

  function changeOpen(next: boolean) {
    // Com a batida em voo a janela não fecha: a confirmação do servidor não pode se perder.
    if (!next && recording) return;
    setOpen(next);
    if (!next) discardPendingAttempt();
    if (next) {
      setLastMarking(null);
      setReceiptError(null);
      setPurpose(null);
      void loadOptions();
    }
  }

  async function downloadReceipt() {
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
    <>
      <button type="button" className={`${chipClassName} font-extrabold text-white hover:bg-white/[0.12]`} onClick={() => changeOpen(true)}>
        <Clock3 className="h-3.5 w-3.5 text-ds-accent-kicker" aria-hidden />
        Bater ponto
      </button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bater ponto</DialogTitle>
            <DialogDescription>{options.mode === "pilot"
              ? "Ensaio controlado: confira a unidade. A batida fica visível, mas não entra no fechamento oficial."
              : "Confira a unidade e registre. O comprovante também fica em Registro de ponto."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {optionsError ? <p role="alert" className="text-sm font-semibold text-ds-danger">{optionsError}</p> : null}
            <OfficialClockDisplay clock={unitClock} />
            {lastMarking ? (
              <div className="space-y-2 rounded-ds-md border border-ds-border bg-ds-warm p-4" role="status">
                <p className="text-sm text-ds-ink">
                  {lastMarking.pilot ? "Ensaio registrado" : "Ponto registrado"} em {brDate(lastMarking.marking.markedAt)} às <strong>{fiscalTime(lastMarking.marking.markedAt)}</strong> · {lastMarking.pilot ? "sequência" : "NSR"} {lastMarking.marking.nsr}
                  {lastMarking.status === "replayed" ? " (já estava gravado)" : ""}
                </p>
                {lastMarking.pilot ? <p className="text-xs font-semibold text-ds-warn">Sem validade como REP-P e fora do fechamento oficial.</p> : null}
                <LocationResultNotice location={lastMarking.location} />
                <ReceiptPill status={lastMarking.receiptStatus} />
                {lastMarking.receiptStatus === "available" ? (
                  <Button type="button" variant="ds-secondary" size="sm" loading={downloading} loadingLabel="Abrindo…" onClick={() => void downloadReceipt()}>
                    <FileText className="h-4 w-4" aria-hidden /> Baixar comprovante
                  </Button>
                ) : (
                  <p className="text-xs text-ds-ink-muted">O ponto está registrado. O comprovante fica disponível em Registro de ponto assim que for emitido.</p>
                )}
                {receiptError ? <p role="alert" className="text-xs font-semibold text-ds-danger">{receiptError}</p> : null}
              </div>
            ) : options.executionUnits.length > 1 ? (
              <PanelSelectField id="quick-execution-unit" label="Unidade onde você está trabalhando" value={unitId}
                onChange={setUnitId} options={options.executionUnits} />
            ) : (
              <p className="text-sm text-ds-ink-2">Unidade: <strong>{options.executionUnits[0]?.name}</strong></p>
            )}
            {!lastMarking ? <LocationCaptureNotice policy={unitLocationPolicy} state={locationCaptureState} /> : null}
            {!lastMarking ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-bold text-ds-ink">O que este registro representa?</legend>
                {MARKING_PURPOSES.map(([id, label]) => (
                  <label key={id} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-ds-sm border border-ds-border px-3 py-2 text-sm">
                    <input type="radio" name="quick-marking-purpose" value={id} checked={purpose === id} onChange={() => setPurpose(id)} />
                    <span className="font-semibold text-ds-ink">{label}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            {recordError ? <p role="alert" className="text-sm font-semibold text-ds-danger">{recordError}</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button asChild variant="ds-ghost" size="sm">
                <Link href={MY_TIME_RECORDING_PATH} onClick={() => changeOpen(false)}>Abrir Registro de ponto</Link>
              </Button>
              {lastMarking ? (
                <Button type="button" variant="ds-secondary" onClick={() => changeOpen(false)}>Fechar</Button>
              ) : (
                <Button type="button" variant="primary-page" loading={recording} loadingLabel="Registrando…"
                  disabled={!canRecord || !purpose} onClick={() => { if (purpose) void record(purpose); }}>
                  <Clock3 className="h-4 w-4" aria-hidden />
                  Registrar ponto
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
