"use client";

import { ArrowLeft, ArrowRight, CalendarDays } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FinancialCompetenceNavigatorProps = {
  label: string;
  meta?: string;
  onPrevious: () => void;
  onNext: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  className?: string;
};

/**
 * Seletor canônico de competência dos fluxos financeiros.
 * Mantém mês, contexto e navegação temporal com a mesma hierarquia visual.
 */
export function FinancialCompetenceNavigator({
  label,
  meta,
  onPrevious,
  onNext,
  previousDisabled = false,
  nextDisabled = false,
  className,
}: FinancialCompetenceNavigatorProps) {
  return (
    <section
      data-ui="financial-competence-navigator"
      aria-label={`Competência ${label}`}
      className={cn(
        "flex w-full shrink-0 flex-col justify-between rounded-[14px] border border-border/70 bg-card p-3.5 shadow-sm lg:w-[220px]",
        className,
      )}
    >
      <div>
        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Competência
        </p>
        <p className="mt-2 flex items-center gap-2 text-[15px] font-bold capitalize tracking-tight">
          <CalendarDays
            className="h-4 w-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <span>{label}</span>
        </p>
        {meta ? (
          <p className="mt-1 text-[10.5px] text-muted-foreground">{meta}</p>
        ) : null}
      </div>

      <div className="mt-3 flex gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 flex-1 rounded-lg bg-background px-2 text-[11px]"
          disabled={previousDisabled}
          aria-label="Competência anterior"
          onClick={onPrevious}
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Anterior
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 flex-1 rounded-lg bg-background px-2 text-[11px]"
          disabled={nextDisabled}
          aria-label="Próxima competência"
          onClick={onNext}
        >
          Próxima
          <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
