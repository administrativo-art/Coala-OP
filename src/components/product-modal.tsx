"use client";

import React, { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { type ProductSimulation, type PPO, type SimulationCategory } from '@/types';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { useKiosks } from '@/hooks/use-kiosks';
import { useToast } from '@/hooks/use-toast';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Trash2, Loader2, Info, LayoutDashboard, ClipboardList, Check, Search, Edit, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { canDeleteTechnicalSheets, canExportTechnicalSheets } from '@/lib/commercial-permissions';

import { CostAnalysisTab } from './product-modal/cost-analysis-tab';
import FullTechnicalSheetView from './product-modal/full-technical-sheet-view';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { FichaTecnicaCompletaDocument } from './pdf/FichaTecnicaCompletaDocument';

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false, loading: () => <Button variant="secondary" disabled size="sm"><Download className="mr-2 h-4 w-4" />Carregando...</Button> }
);

interface ProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simulation: ProductSimulation | null;
  initialTab?: 'cost' | 'ficha';
}

export function ProductModal({ open, onOpenChange, simulation, initialTab = 'cost' }: ProductModalProps) {
  const [activeTab, setActiveTab] = useState<'cost' | 'ficha'>(initialTab);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { updateSimulation, deleteSimulation, simulationItems } = useProductSimulation();
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

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
    }
  }, [open, initialTab]);

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

  const isViewOnlyMode = initialTab === 'ficha';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[1000px] sm:max-w-[1000px] w-[95vw] h-[92vh] flex flex-col p-0 overflow-hidden rounded-2xl">
          {/* Header */}
          <div className="px-8 pt-6 pb-2 flex-shrink-0">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-3">
                   <DialogTitle className="text-2xl font-black text-gray-900 tracking-tight">{simulation.name}</DialogTitle>
                   {isViewOnlyMode ? (
                     <Badge className="bg-blue-600 text-white hover:bg-blue-600 border-none font-bold text-[10px] uppercase px-2 py-0.5">
                       Ficha Técnica Completa
                     </Badge>
                   ) : (
                     <Badge className="bg-pink-600 text-white hover:bg-pink-600 border-none font-bold text-[10px] uppercase px-2 py-0.5">
                       Modo de Edição
                     </Badge>
                   )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  SKU: <span className="font-mono font-bold text-gray-600">{simulation.ppo?.sku || 'N/A'}</span> · {simulation.categoryIds?.[0] ? 'Mercadoria Cadastrada' : 'Sem Categoria'}
                </p>
              </div>
            </div>
            
            {/* Tabs List - ONLY show if we are in Edit mode. In View mode, we show everything in one place. */}
            {!isViewOnlyMode && (
              <div className="flex gap-1 mt-4 border-b">
                <button 
                  onClick={() => setActiveTab('cost')}
                  className={cn(
                    "px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px flex items-center gap-2",
                    activeTab === 'cost' 
                      ? "border-pink-500 text-pink-600" 
                      : "border-transparent text-gray-400 hover:text-gray-700"
                  )}
                >
                  <Edit className="h-4 w-4" />
                  Editar Ficha
                </button>
                {/* We can still allow switching to view, but the user wants them separate */}
              </div>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden">
            {isViewOnlyMode ? (
              <FullTechnicalSheetView simulation={simulation} />
            ) : (
              <CostAnalysisTab simulation={simulation} onOpenChange={onOpenChange} />
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-between items-center px-6 py-3 border-t bg-gray-50 flex-shrink-0">
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
                  document={<FichaTecnicaCompletaDocument data={pdfData as any} />}
                  fileName={`ficha_completa_${simulation.name.replace(/ /g, '_')}.pdf`}
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
                  className="bg-pink-500 hover:bg-pink-600 text-white font-semibold"
                  onClick={handleSave}
                >
                  Salvar Alterações
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
