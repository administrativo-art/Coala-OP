"use client";

import { type ReactNode } from 'react';
import { Info } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface InfoTooltipProps {
  title: string;
  children: ReactNode;
}

/**
 * Ícone "i" explicativo reutilizável, para ligar ao lado de um rótulo/coluna e detalhar
 * como um valor calculado é obtido (fórmula, período considerado, arredondamento, etc.).
 * Extraído de `goal-method-settings.tsx` (MethodInfoTooltip) para reuso fora daquele módulo.
 */
export function InfoTooltip({ title, children }: InfoTooltipProps) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-pink-200 hover:text-pink-700"
            aria-label={title}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-[380px] space-y-2 p-3 text-xs leading-relaxed">
          <p className="font-bold text-slate-950">{title}</p>
          <div className="space-y-1 text-muted-foreground">{children}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
