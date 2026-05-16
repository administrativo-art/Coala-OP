"use client";

import React, { useMemo } from 'react';
import { type ProductSimulation } from '@/types';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from '@/components/ui/table';
import { Clock, Weight, ShieldAlert, LayoutDashboard, Utensils, Check, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function FullTechnicalSheetView({ simulation }: { simulation: ProductSimulation }) {
  const { simulationItems } = useProductSimulation();
  const { baseProducts } = useBaseProducts();
  const { categories } = useProductSimulationCategories();

  const getCatName = (id: string) => categories.find(c => c.id === id)?.name || id;

  const ingredients = useMemo(() => {
    return simulationItems
      .filter(item => item.simulationId === simulation.id)
      .map(item => {
        const bp = baseProducts.find(b => b.id === item.baseProductId);
        return {
          name: bp?.name || 'Insumo não encontrado',
          quantity: item.quantity,
          unit: item.overrideUnit || bp?.unit || 'un',
          cost: item.useDefault 
            ? (bp?.lastEffectivePrice?.pricePerUnit || bp?.initialCostPerUnit || 0)
            : (item.overrideCostPerUnit || 0)
        };
      });
  }, [simulation.id, simulationItems, baseProducts]);

  return (
    <div className="h-full flex flex-col bg-gray-50/50">
      <ScrollArea className="flex-1 p-8">
        <div className="max-w-4xl mx-auto space-y-8">
          
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="bg-white p-4 rounded-xl border shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Preço de Venda</p>
              <p className="text-xl font-black text-gray-900">{formatCurrency(simulation.salePrice)}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Custo (CMV)</p>
              <p className="text-xl font-black text-gray-900">{formatCurrency(simulation.totalCmv)}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Margem Bruta R$</p>
              <p className="text-xl font-black text-gray-900">{formatCurrency(simulation.salePrice - simulation.totalCmv)}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Margem Bruta %</p>
              <p className="text-xl font-black text-gray-900">
                {simulation.salePrice > 0 ? (((simulation.salePrice - simulation.totalCmv) / simulation.salePrice) * 100).toFixed(1) : 0}%
              </p>
            </div>
            <div className="bg-white p-4 rounded-xl border shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">M. Contribuição</p>
              <p className={cn(
                "text-xl font-black",
                (simulation.profitGoal && simulation.profitPercentage >= simulation.profitGoal) ? "text-green-600" : "text-orange-500"
              )}>
                {simulation.profitPercentage.toFixed(1)}%
              </p>
            </div>
            <div className="bg-white p-4 rounded-xl border shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Markup</p>
              <p className="text-xl font-black text-gray-700">{simulation.markup.toFixed(2)}x</p>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_300px] gap-8">
            <div className="space-y-8">
              {/* Composition */}
              <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b bg-gray-50/50">
                  <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                    <Utensils className="h-4 w-4 text-pink-500" />
                    Composição e Custos
                  </h3>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-[10px] font-bold uppercase h-10">Item</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase h-10 text-center">Quantidade</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase h-10 text-right">Custo Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ingredients.map((ing, i) => (
                      <TableRow key={i}>
                        <TableCell className="py-3">
                          <p className="text-sm font-semibold text-gray-800">{ing.name}</p>
                        </TableCell>
                        <TableCell className="py-3 text-center text-xs font-medium text-gray-600">
                          {ing.quantity} {ing.unit}
                        </TableCell>
                        <TableCell className="py-3 text-right text-sm font-bold text-gray-900">
                          {formatCurrency(ing.quantity * ing.cost)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Instructions */}
              <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b bg-gray-50/50">
                  <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                    <LayoutDashboard className="h-4 w-4 text-blue-500" />
                    Modo de Montagem
                  </h3>
                </div>
                <div className="p-6 space-y-6">
                  {simulation.ppo?.assemblyInstructions?.map((phase, pi) => (
                    <div key={pi} className="space-y-3">
                      <h4 className="text-xs font-black text-blue-600 uppercase tracking-widest border-b pb-1">
                        {phase.name}
                      </h4>
                      <div className="space-y-4">
                        {phase.etapas.map((etapa, ei) => (
                          <div key={ei} className="flex gap-4">
                            <span className="text-sm font-black text-gray-300">{ei + 1}</span>
                            <p className="text-sm text-gray-700 leading-relaxed">{etapa.text}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {(!simulation.ppo?.assemblyInstructions || simulation.ppo.assemblyInstructions.length === 0) && (
                    <p className="text-sm text-gray-400 italic">Nenhuma instrução cadastrada.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              {/* Photo */}
              {simulation.ppo?.referenceImageUrl ? (
                <div className="bg-white p-2 rounded-2xl border shadow-sm">
                   <img src={simulation.ppo.referenceImageUrl} className="w-full aspect-square object-cover rounded-xl" />
                </div>
              ) : (
                <div className="bg-gray-50 p-2 rounded-2xl border-2 border-dashed border-gray-200 aspect-square flex flex-col items-center justify-center text-gray-400">
                    <Utensils className="h-8 w-8 mb-2 opacity-20" />
                    <p className="text-sm font-medium text-center">Sem foto<br/>de referência</p>
                </div>
              )}

              {/* Specs */}
              <div className="bg-white p-6 rounded-2xl border shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <span className="text-xs font-bold text-gray-500 uppercase">Preparo</span>
                  </div>
                  <span className="text-sm font-bold text-gray-900">{simulation.ppo?.preparationTime || 0}s</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Utensils className="h-4 w-4 text-gray-400" />
                    <span className="text-xs font-bold text-gray-500 uppercase">Peso</span>
                  </div>
                  <span className="text-sm font-bold text-gray-900">{simulation.ppo?.portionWeight || 0}g</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-orange-500">
                    <ShieldAlert className="h-4 w-4" />
                    <span className="text-xs font-bold uppercase">Alergênicos</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {simulation.ppo?.allergens?.map((a: any, i: number) => (
                    <Badge key={i} variant="outline" className="bg-orange-50 text-orange-700 border-orange-100 text-[10px]">
                      {typeof a === 'string' ? a : a.text}
                    </Badge>
                  ))}
                  {(!simulation.ppo?.allergens || simulation.ppo.allergens.length === 0) && (
                    <span className="text-xs text-gray-400">Nenhum</span>
                  )}
                </div>
              </div>
              
              {/* Categorização & Kiosks */}
              <div className="bg-white p-6 rounded-2xl border shadow-sm space-y-4">
                <div className="space-y-3">
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Localização e Categoria</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between items-start text-xs">
                      <span className="text-gray-500">Quiosques</span>
                      <div className="flex flex-wrap gap-1 justify-end max-w-[150px]">
                        {simulation.kioskIds?.length ? simulation.kioskIds.map((id, i) => (
                           <Badge key={i} variant="secondary" className="text-[9px] px-1.5 h-4">{id}</Badge>
                        )) : <span className="font-bold text-gray-700">Todos</span>}
                      </div>
                    </div>
                    <Separator className="bg-gray-50" />
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Categoria</span>
                      <span className="font-bold text-gray-700">{simulation.categoryIds?.[0] ? getCatName(simulation.categoryIds[0]) : '—'}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Linha</span>
                      <span className="font-bold text-gray-700">{simulation.lineId ? getCatName(simulation.lineId) : '—'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Fiscal & Impostos */}
              <div className="bg-gray-100/50 p-6 rounded-2xl border border-dashed border-gray-200 space-y-3">
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Dados Fiscais e Taxas</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-[9px] text-gray-400 uppercase">NCM</span>
                    <p className="font-mono font-bold text-xs text-gray-700">{simulation.ppo?.ncm || '—'}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[9px] text-gray-400 uppercase">CEST</span>
                    <p className="font-mono font-bold text-xs text-gray-700">{simulation.ppo?.cest || '—'}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[9px] text-gray-400 uppercase">CFOP</span>
                    <p className="font-mono font-bold text-xs text-gray-700">{simulation.ppo?.cfop || '—'}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[9px] text-gray-400 uppercase">Meta M.B.</span>
                    <p className="font-bold text-xs text-gray-700">{simulation.profitGoal ? `${simulation.profitGoal}%` : '—'}</p>
                  </div>
                </div>
              </div>

              {/* Tabela Nutricional */}
              <div className="bg-green-50/50 p-6 rounded-2xl border border-dashed border-green-200 space-y-3">
                <h4 className="text-[10px] font-black text-green-700 uppercase tracking-widest">Tabela Nutricional</h4>
                <div className="flex flex-col items-center justify-center py-4 text-center text-green-600/60">
                    <Utensils className="h-6 w-6 mb-2 opacity-50" />
                    <p className="text-xs font-bold uppercase">Módulo em breve</p>
                    <p className="text-[10px] max-w-[200px]">A tabela nutricional automática será implementada no futuro.</p>
                </div>
              </div>

              {/* Notes */}
              {simulation.notes && (
                <div className="bg-yellow-50/50 p-4 rounded-xl border border-yellow-100">
                  <h4 className="text-[10px] font-black text-yellow-600 uppercase tracking-widest mb-2 flex items-center gap-1">
                    <Info className="h-3 w-3" /> Observações
                  </h4>
                  <p className="text-xs text-yellow-800 leading-relaxed italic">
                    "{simulation.notes}"
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
