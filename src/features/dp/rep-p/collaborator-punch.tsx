"use client";

import Link from "next/link";
import { ChevronRight, Clock3, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { DayView } from "./day-model";
import { journeyState, MarkingSequence, nextMarkingOf, purposeLabel, recordActionLabel } from "./record-strip";
import type { useRepPMarking } from "./use-rep-p-marking";

type Marking = ReturnType<typeof useRepPMarking>;

/** Coleta ligada e vínculo habilitado hoje: só então o painel oferece a batida. */
export function canOfferPunch(marking: Marking) {
  return Boolean(marking.options?.markingEnabled && marking.options.eligible && marking.options.executionUnits.length);
}

/** Botão do topo de saudação do painel: a próxima batida (ou o reenvio) e a mesma confirmação do Registro de ponto. */
export function HeroPunchButton({ marking, day, onOpen }: { marking: Marking; day: DayView; onOpen: () => void }) {
  const next = nextMarkingOf(day);
  const pending = Boolean(marking.pendingAttempt);
  return (
    <Button type="button" variant={pending ? "ds-secondary" : "primary-page"} size="sm" disabled={!marking.canRecord} onClick={onOpen}
      className="gap-2 pr-1.5">
      {pending ? <RotateCw className="h-4 w-4" aria-hidden /> : <Clock3 className="h-4 w-4" aria-hidden />}
      {recordActionLabel(marking, day)}
      {!pending && marking.canRecord && next.reliable && !next.extra ? (
        <span className="rounded-ds-pill bg-black/20 px-2 py-0.5 text-[11px] font-bold">{purposeLabel(next.purpose).toLowerCase()}</span>
      ) : null}
    </Button>
  );
}

/** Linha "Ponto" dentro do topo de saudação: estado da jornada e batidas de hoje, com atalho para o Registro de ponto. */
export function HeroPunchRow({ day, today }: { day: DayView; today: string }) {
  return (
    <Link href="/dashboard/collaborator/time-recording"
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/10 pt-3 text-[12.5px] text-ds-on-dark-2",
        "rounded-ds-sm hover:text-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white/40")}>
      <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Ponto</span>
      <strong className="text-white">{journeyState(day)}</strong>
      <MarkingSequence day={day} today={today} dark />
      <span className="ml-auto inline-flex items-center gap-0.5 text-xs font-bold underline">Ver registro de ponto <ChevronRight className="h-3.5 w-3.5" aria-hidden /></span>
    </Link>
  );
}
