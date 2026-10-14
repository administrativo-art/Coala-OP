"use client";

import React from 'react';
import Image from 'next/image';
import { Layers } from 'lucide-react';

import { type ProductSimulation } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface AssemblyInstructionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simulation: ProductSimulation | null;
}

export function AssemblyInstructionsModal({ open, onOpenChange, simulation }: AssemblyInstructionsModalProps) {
  if (!simulation) return null;

  const instructions = simulation.ppo?.assemblyInstructions || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(80vh,760px)] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-ds-modal border-0 bg-ds-page p-0 font-ds shadow-ds-modal sm:max-w-2xl">
        <DialogHeader className="shrink-0 space-y-0 bg-ds-dark px-6 py-5 pr-14 text-left text-ds-on-dark">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Modo de montagem</p>
          <DialogTitle className="mt-1 text-xl font-extrabold">{simulation.name}</DialogTitle>
          <DialogDescription className="mt-0.5 text-[12.5px] text-ds-on-dark-sub">Siga as etapas abaixo para a montagem correta da mercadoria.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {instructions.length > 0 ? (
            instructions.map(phase => (
              <section key={phase.id} className="space-y-2">
                <h3 className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-ink">{phase.name}</h3>
                <ol className="space-y-2">
                  {phase.etapas.map((etapa, index) => (
                    <li key={etapa.id} className="flex items-start gap-3 rounded-ds-card border border-ds-border bg-ds-surface p-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ds-sm bg-ds-dark text-[14px] font-extrabold text-white">{index + 1}</span>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="text-[14px] font-semibold leading-snug text-ds-ink">{etapa.text}</p>
                        {etapa.quantity && etapa.unit && (
                          <span className="inline-flex h-[21px] items-center rounded-ds-pill bg-ds-neutral-bg px-[9px] text-[11.5px] font-bold text-ds-neutral">{etapa.quantity} {etapa.unit}</span>
                        )}
                      </div>
                      {etapa.imageUrl && (
                        <Image src={etapa.imageUrl} alt={`Etapa: ${etapa.text}`} width={72} height={72} className="h-[72px] w-[72px] shrink-0 rounded-ds-md border border-ds-border object-cover" />
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ))
          ) : (
            <div className="rounded-ds-card border border-dashed border-ds-border-input px-4 py-14 text-center text-ds-ink-faint">
              <Layers aria-hidden="true" size={26} className="mx-auto mb-2" />
              <p className="text-[13px] font-semibold">Nenhuma instrução de montagem cadastrada para esta mercadoria.</p>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-ds-border bg-ds-warm px-6 py-4">
          <Button variant="primary-modal" size="md" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
