"use client";

import { useState } from "react";
import { Clock3, RotateCw } from "lucide-react";

import { RecordDialog } from "./record-strip";
import { useRepPMarking } from "./use-rep-p-marking";
import { useTodayJourney } from "./use-today-journey";

/**
 * Atalho "Bater ponto" na barra superior. Só aparece com a coleta ligada e para quem tem vínculo habilitado hoje;
 * a janela relê a hora oficial e a jornada de hoje ao abrir e registra pela mesma confirmação de "Registro de ponto",
 * inclusive o reenvio de uma tentativa sem resposta.
 */
export function QuickMarkingButton({ chipClassName }: { chipClassName: string }) {
  const [open, setOpen] = useState(false);
  const marking = useRepPMarking();
  const { options, loadOptions, pendingAttempt } = marking;
  const journey = useTodayJourney(marking, open);

  if (!options?.markingEnabled || !options.eligible || options.executionUnits.length === 0) return null;

  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) { void loadOptions(); journey.reload(); }
  }

  return (
    <>
      <button type="button" className={`${chipClassName} font-extrabold text-white hover:bg-white/[0.12]`} onClick={() => changeOpen(true)}>
        {pendingAttempt ? <RotateCw className="h-3.5 w-3.5 text-ds-caution-tile" aria-hidden /> : <Clock3 className="h-3.5 w-3.5 text-ds-accent-kicker" aria-hidden />}
        {pendingAttempt ? "Reenviar batida" : "Bater ponto"}
      </button>
      <RecordDialog open={open} onOpenChange={changeOpen} marking={marking} day={journey.day} chooseUnit onRecorded={journey.reload} />
    </>
  );
}
