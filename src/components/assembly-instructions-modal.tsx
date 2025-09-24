
"use client";

import React from 'react';
import { type ProductSimulation } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import Image from 'next/image';
import { Settings } from 'lucide-react';

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
            <DialogContent className="max-w-2xl h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Settings /> Modo de Montagem: {simulation.name}
                    </DialogTitle>
                    <DialogDescription>
                        Siga as etapas abaixo para a montagem correta da mercadoria.
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="flex-1 pr-6 -mr-6">
                    <div className="space-y-6 py-4">
                        {instructions.length > 0 ? (
                            instructions.map(phase => (
                                <div key={phase.id} className="p-4 border rounded-lg bg-muted/30">
                                    <h3 className="font-semibold text-lg mb-4">{phase.name}</h3>
                                    <ol className="space-y-4">
                                        {phase.etapas.map((etapa, index) => (
                                            <li key={etapa.id} className="grid grid-cols-[auto_1fr_auto] gap-4 items-start">
                                                <span className="font-bold text-primary pt-1">{index + 1}.</span>
                                                <div>
                                                    <p className="font-medium">{etapa.text}</p>
                                                    {etapa.quantity && etapa.unit && (
                                                        <span className="text-sm text-muted-foreground">({etapa.quantity} {etapa.unit})</span>
                                                    )}
                                                </div>
                                                {etapa.imageUrl && (
                                                    <Image src={etapa.imageUrl} alt={`Etapa: ${etapa.text}`} width={80} height={80} className="rounded-md object-cover" />
                                                )}
                                            </li>
                                        ))}
                                    </ol>
                                </div>
                            ))
                        ) : (
                            <div className="text-center text-muted-foreground py-16">
                                <p>Nenhuma instrução de montagem cadastrada para esta mercadoria.</p>
                            </div>
                        )}
                    </div>
                </ScrollArea>
                <DialogFooter className="pt-4 border-t">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
