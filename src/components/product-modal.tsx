"use client";

import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { type ProductSimulation } from '@/types';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { useToast } from '@/hooks/use-toast';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Trash2, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPricingCommercialStatus } from '@/lib/pricing-insights';
import { useAuth } from '@/hooks/use-auth';
import { canDeleteTechnicalSheets, canExportTechnicalSheets } from '@/lib/commercial-permissions';

import { CostAnalysisTab } from './product-modal/cost-analysis-tab';
import FullTechnicalSheetView from './product-modal/full-technical-sheet-view';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { FichaTecnicaCompletaDocument } from './pdf/FichaTecnicaCompletaDocument';
import { FichaTecnicaDocument } from './pdf/FichaTecnicaDocument';

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false, loading: () => <Button variant="secondary" disabled size="sm"><Download className="mr-2 h-4 w-4" />Carregando...</Button> }
);

interface ProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Completeness is derived by the provider, not part of the stored document. */
  simulation: (ProductSimulation & { cmvComplete?: boolean }) | null;
  initialTab?: 'cost' | 'ficha' | 'instruction';
}

export function ProductModal({ open, onOpenChange, simulation, initialTab = 'cost' }: ProductModalProps) {
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { deleteSimulation, simulationItems } = useProductSimulation();
  const { baseProducts } = useBaseProducts();
  const { categories } = useProductSimulationCategories();
  const { toast } = useToast();
  const { permissions } = useAuth();
  const canDeleteSheet = canDeleteTechnicalSheets(permissions);
  const canExportSheet = canExportTechnicalSheets(permissions);

  const pdfData = useMemo(() => {
    if (!simulation) return null;
    const getCatName = (id: string) => categories.find(c => c.id === id)?.name || '—';
    const ingredients = simulationItems
      .filter(item => item.simulationId === simulation.id)
      .map(item => {
        const bp = baseProducts.find(b => b.id === item.baseProductId);
        const cost = item.useDefault
          ? (bp?.lastEffectivePrice?.pricePerUnit || bp?.initialCostPerUnit || 0)
          : (item.overrideCostPerUnit || 0);
        return {
          name: bp?.name || 'Insumo não encontrado',
          quantity: item.quantity,
          unit: item.overrideUnit || bp?.unit || 'un',
          cost,
        };
      });
    return {
      ...simulation,
      totalCmv: simulation.totalCmv,
      ingredients,
      categoryName: simulation.categoryIds?.[0] ? getCatName(simulation.categoryIds[0]) : '—',
      lineName: simulation.lineId ? getCatName(simulation.lineId) : '—',
    };
  }, [simulation, simulationItems, baseProducts, categories]);

  const handleSave = async () => {
    // This will be triggered by a ref or a shared form context
    // For now, we'll implement the save logic inside the tabs or pass a trigger
    const submitBtn = document.getElementById('product-modal-submit-btn');
    if (submitBtn) {
      submitBtn.click();
    }
  };

  const handleDelete = async () => {
    if (!simulation) return;
    try {
      setIsLoading(true);
      await deleteSimulation(simulation.id);
      setIsDeleteConfirmOpen(false);
      onOpenChange(false);
      toast({ title: "Mercadoria excluída com sucesso." });
    } catch (error) {
      toast({ 
        variant: "destructive", 
        title: "Erro ao excluir", 
        description: "Não foi possível excluir a mercadoria." 
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!simulation) return null;

  const isCompleteSheetMode = initialTab === 'ficha';
  const isInstructionMode = initialTab === 'instruction';
  const isViewOnlyMode = isCompleteSheetMode || isInstructionMode;
  const commercialStatus = getPricingCommercialStatus(simulation.salePrice, simulation.totalCmv || 0, simulation.profitGoal);
  const statusPresentation = {
    loss: { label: 'Prejuízo', className: 'bg-ds-danger-bg text-ds-danger' },
    below: { label: 'Abaixo da meta', className: 'bg-ds-warn-bg text-ds-warn' },
    met: { label: 'Na meta', className: 'bg-ds-ok-bg text-ds-ok' },
    none: { label: 'Sem meta', className: 'bg-ds-neutral-bg text-ds-neutral' },
  }[commercialStatus];
  const categoryName = simulation.categoryIds?.[0]
    ? categories.find((category) => category.id === simulation.categoryIds?.[0])?.name ?? 'Sem categoria'
    : 'Sem categoria';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[90vh] w-[calc(100vw-2rem)] max-w-[900px] flex-col gap-0 overflow-hidden rounded-ds-modal border-0 bg-ds-page p-0 font-ds shadow-ds-modal sm:max-w-[900px]">
          <DialogDescription className="sr-only">
            {isInstructionMode ? 'Ficha técnica de instrução da mercadoria.' : isCompleteSheetMode ? 'Ficha técnica completa da mercadoria.' : 'Edição de custos, preços e ficha técnica da mercadoria.'}
          </DialogDescription>
          <header className="shrink-0 bg-ds-dark px-6 py-5 pr-14 text-ds-on-dark">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">
              {isInstructionMode ? 'Ficha de instrução' : isCompleteSheetMode ? 'Ficha completa' : 'Custos e preços'}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <DialogTitle className="text-xl font-extrabold">{simulation.name}</DialogTitle>
              <span className={cn('inline-flex h-[21px] items-center rounded-ds-pill px-[9px] text-[11.5px] font-bold', statusPresentation.className)}>{statusPresentation.label}</span>
            </div>
            <p className="mt-0.5 text-[12.5px] text-ds-on-dark-sub">
              SKU <span className="font-ds-mono font-bold text-ds-on-dark-2">{simulation.ppo?.sku || 'N/A'}</span> · {categoryName}
            </p>
          </header>

          {simulation.cmvComplete === false && (
            <p role="alert" className="mx-6 mt-4 rounded-ds-md border border-ds-alert-border bg-ds-alert-bg p-3 text-[13px] font-semibold text-ds-alert-ink">
              CMV incompleto: confira ingredientes e custos. Os valores e margens desta ficha são uma prévia parcial.
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-hidden">
            {isViewOnlyMode ? (
              <FullTechnicalSheetView simulation={simulation} variant={isInstructionMode ? 'instruction' : 'complete'} />
            ) : (
              <CostAnalysisTab simulation={simulation} onOpenChange={onOpenChange} />
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-ds-border bg-ds-warm px-6 py-4">
            <div>
              {canDeleteSheet && (
                <Button variant="danger-link" size="md" onClick={() => setIsDeleteConfirmOpen(true)}>
                  <Trash2 aria-hidden="true" className="mr-2 h-4 w-4" />Excluir
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {isViewOnlyMode && pdfData && canExportSheet && (
                <PDFDownloadLink
                  document={isInstructionMode
                    ? <FichaTecnicaDocument type="instrucao" data={pdfData as any} />
                    : <FichaTecnicaCompletaDocument data={pdfData as any} />}
                  fileName={`${isInstructionMode ? 'ficha_instrucao' : 'ficha_completa'}_${simulation.name.replace(/ /g, '_')}.pdf`}
                >
                  {((props: any) => (
                    <Button variant="ds-secondary" size="md" disabled={props.loading}>
                      <Download aria-hidden="true" className="mr-2 h-4 w-4" />
                      {props.loading ? 'Gerando...' : 'Baixar PDF'}
                    </Button>
                  )) as any}
                </PDFDownloadLink>
              )}
              <Button variant={isViewOnlyMode ? 'primary-modal' : 'ds-ghost'} size="md" onClick={() => onOpenChange(false)}>
                {isViewOnlyMode ? 'Fechar' : 'Cancelar'}
              </Button>
              {!isViewOnlyMode && (
                <Button variant="primary-modal" size="md" onClick={handleSave}>Salvar preços</Button>
              )}
            </div>
          </footer>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={isDeleteConfirmOpen}
        onOpenChange={setIsDeleteConfirmOpen}
        onConfirm={handleDelete}
        itemName={simulation.name}
      />
    </>
  );
}
