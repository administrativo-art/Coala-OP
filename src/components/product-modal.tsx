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
import { Badge } from '@/components/ui/badge';
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
  simulation: ProductSimulation | null;
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
    loss: { label: 'Prejuízo', className: 'border-red-200 bg-red-50 text-red-700' },
    below: { label: 'Abaixo da meta', className: 'border-orange-200 bg-orange-50 text-orange-700' },
    met: { label: 'Na meta', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    none: { label: 'Sem meta', className: 'border-slate-200 bg-slate-50 text-slate-600' },
  }[commercialStatus];
  const categoryName = simulation.categoryIds?.[0]
    ? categories.find((category) => category.id === simulation.categoryIds?.[0])?.name ?? 'Sem categoria'
    : 'Sem categoria';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[90vh] w-[calc(100vw-2rem)] max-w-[900px] flex-col overflow-hidden rounded-[22px] border-0 p-0 shadow-2xl sm:max-w-[900px]">
          <DialogDescription className="sr-only">
            {isInstructionMode ? 'Ficha técnica de instrução da mercadoria.' : isCompleteSheetMode ? 'Ficha técnica completa da mercadoria.' : 'Edição de custos, preços e ficha técnica da mercadoria.'}
          </DialogDescription>
          {/* Header */}
          <div className="flex-shrink-0 border-b border-[#eeece7] px-6 py-5 pr-14">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-3">
                   <DialogTitle className="text-xl font-black tracking-tight text-slate-950">{simulation.name}</DialogTitle>
                   <Badge variant="outline" className={cn('rounded-full text-[10px] font-black uppercase', statusPresentation.className)}>{statusPresentation.label}</Badge>
                   {isViewOnlyMode ? <Badge variant="outline" className="rounded-full border-blue-200 bg-blue-50 text-[10px] font-black uppercase text-blue-700">{isInstructionMode ? 'Ficha de instrução' : 'Ficha completa'}</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  SKU <span className="font-mono font-bold text-slate-600">{simulation.ppo?.sku || 'N/A'}</span> · {categoryName}
                </p>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden">
            {isViewOnlyMode ? (
              <FullTechnicalSheetView simulation={simulation} variant={isInstructionMode ? 'instruction' : 'complete'} />
            ) : (
              <CostAnalysisTab simulation={simulation} onOpenChange={onOpenChange} />
            )}
          </div>

          {/* Footer */}
          <div className="flex flex-shrink-0 items-center justify-between border-t border-[#eeece7] bg-[#faf9f6] px-6 py-4">
            <div className="flex gap-2">
              {canDeleteSheet && (
                <Button 
                  variant="ghost" 
                  className="text-red-500 hover:text-red-600 hover:bg-red-50"
                  onClick={() => setIsDeleteConfirmOpen(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Excluir
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
                    <Button variant="secondary" size="sm" disabled={props.loading}>
                      <Download className="mr-2 h-4 w-4" />
                      {props.loading ? 'Gerando...' : 'Baixar PDF'}
                    </Button>
                  )) as any}
                </PDFDownloadLink>
              )}
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {isViewOnlyMode ? 'Fechar' : 'Cancelar'}
              </Button>
              {!isViewOnlyMode && (
                <Button 
                  className="bg-pink-600 font-bold text-white hover:bg-pink-700"
                  onClick={handleSave}
                >
                  Salvar preços
                </Button>
              )}
            </div>
          </div>
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
