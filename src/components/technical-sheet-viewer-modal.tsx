"use client";

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { type ProductSimulation } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useBaseProducts } from '@/hooks/use-base-products';
import { Download } from 'lucide-react';
import { FichaTecnicaDocument } from './pdf/FichaTecnicaDocument';
import { SheetContent, type SheetData } from '@/components/technical-sheet/sheet-content';

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false, loading: () => <Button variant="ds-secondary" size="md" disabled><Download className="mr-2 h-4 w-4 animate-spin" />Carregando...</Button> }
);

interface TechnicalSheetViewerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simulation: ProductSimulation | null;
}

export function TechnicalSheetViewerModal({ open, onOpenChange, simulation }: TechnicalSheetViewerModalProps) {
  const { simulationItems } = useProductSimulation();
  const { baseProducts } = useBaseProducts();

  const ingredients = useMemo(() => {
    if (!simulation) return [];
    return simulationItems
      .filter(item => item.simulationId === simulation.id)
      .map(item => {
        const bp = baseProducts.find(b => b.id === item.baseProductId);
        return {
          name: bp?.name || 'Insumo não encontrado',
          quantity: item.quantity,
          unit: item.overrideUnit || bp?.unit || 'un',
        };
      });
  }, [simulation, simulationItems, baseProducts]);

  const pdfData = useMemo(() => {
    if (!simulation) return null;
    return { ...simulation, totalCmv: simulation.totalCmv, ingredients };
  }, [simulation, ingredients]);

  if (!simulation || !pdfData) return null;

  const allergens: { id: string; text: string }[] = Array.isArray(simulation.ppo?.allergens)
    ? simulation.ppo.allergens.map((a: any) => typeof a === 'string' ? { id: a, text: a } : a)
    : [];
  const qualityStandard: { id: string; text: string }[] = Array.isArray(simulation.ppo?.qualityStandard)
    ? simulation.ppo.qualityStandard.filter((q: any) => typeof q === 'object' && q.text)
    : [];

  const sheet: SheetData = {
    name: simulation.name,
    imageUrl: simulation.ppo?.referenceImageUrl ?? null,
    preparationTime: simulation.ppo?.preparationTime ?? null,
    portionWeight: simulation.ppo?.portionWeight ?? null,
    portionTolerance: simulation.ppo?.portionTolerance ?? null,
    assemblyInstructions: simulation.ppo?.assemblyInstructions ?? [],
    qualityStandard,
    allergens,
    assemblyVideoUrl: simulation.ppo?.assemblyVideoUrl || null,
    ingredients,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(92vh,900px)] w-[calc(100vw-2rem)] max-w-[1080px] flex-col gap-0 overflow-hidden rounded-ds-modal border-0 bg-ds-page p-0 font-ds shadow-ds-modal sm:max-w-[1080px]">
        <DialogHeader className="shrink-0 space-y-0 bg-ds-dark px-6 py-5 pr-14 text-left text-ds-on-dark">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Ficha técnica de instrução</p>
          <DialogTitle className="mt-1 text-xl font-extrabold">{simulation.name}</DialogTitle>
          <DialogDescription className="mt-0.5 text-[12.5px] text-ds-on-dark-sub">SKU {simulation.ppo?.sku || 'N/A'}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <SheetContent product={sheet} />
        </div>

        <DialogFooter className="shrink-0 flex-row items-center justify-between gap-2 border-t border-ds-border bg-ds-warm px-6 py-4 sm:justify-between">
          <PDFDownloadLink
            document={<FichaTecnicaDocument data={pdfData} />}
            fileName={`ficha_tecnica_${simulation.name.replace(/ /g, '_')}.pdf`}
          >
            {((props: any) => (
              <Button variant="ds-secondary" size="md" disabled={props.loading}>
                <Download aria-hidden="true" className="mr-2 h-4 w-4" />
                {props.loading ? 'Gerando...' : 'Baixar PDF'}
              </Button>
            )) as any}
          </PDFDownloadLink>
          <Button variant="primary-modal" size="md" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
