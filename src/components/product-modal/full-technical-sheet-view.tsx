"use client";

import React, { useMemo, useState } from 'react';
import { type ProductSimulation } from '@/types';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { useKiosks } from '@/hooks/use-kiosks';
import { useChannels } from '@/hooks/use-channels';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from '@/components/ui/table';
import { Clock, ShieldAlert, LayoutDashboard, Utensils, CheckCircle2, Info, Video } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { calculateSimulationMetrics } from '@/lib/pricing-context';

const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

interface FullTechnicalSheetViewProps {
  simulation: ProductSimulation;
  variant?: 'complete' | 'instruction';
}

export default function FullTechnicalSheetView({ simulation, variant = 'complete' }: FullTechnicalSheetViewProps) {
  const { simulationItems, resolveSimulationPrice } = useProductSimulation();
  const { baseProducts } = useBaseProducts();
  const { categories } = useProductSimulationCategories();
  const { kiosks } = useKiosks();
  const { channels } = useChannels();
  const { pricingParameters } = useCompanySettings();
  const [unitId, setUnitId] = useState<string>('all');
  const [channelId, setChannelId] = useState<string>('all');

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
  const commercialKiosks = useMemo(() => kiosks.filter((kiosk) => {
    const name = kiosk.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return !name.includes('matriz') && !name.includes('centro de distribuicao');
  }), [kiosks]);
  const scopedKiosks = useMemo(() => {
    if (!(simulation.kioskIds ?? []).length) return commercialKiosks;
    return commercialKiosks.filter((kiosk) => simulation.kioskIds?.includes(kiosk.id));
  }, [commercialKiosks, simulation.kioskIds]);
  const activeChannels = useMemo(() => channels.filter((channel) => channel.active && channel.type !== 'balcao'), [channels]);
  const priceResolution = resolveSimulationPrice(simulation, unitId === 'all' ? null : unitId, channelId === 'all' ? null : channelId);
  const metrics = calculateSimulationMetrics(
    priceResolution.price ?? 0,
    simulation.totalCmv || 0,
    pricingParameters?.averageTaxPercentage || 0,
    pricingParameters?.averageCardFeePercentage || 0,
  );
  const isInstruction = variant === 'instruction';
  const qualityStandards = Array.isArray(simulation.ppo?.qualityStandard)
    ? simulation.ppo.qualityStandard.filter((item: any) => typeof item === 'object' && item.text)
    : [];

  return (
    <div className="flex h-full flex-col bg-[#faf9f6]">
      <ScrollArea className="flex-1 p-6">
        <div className="mx-auto w-full space-y-5">
          {!isInstruction && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#eeece7] bg-white p-3">
            <span className="mr-1 text-[10px] font-black uppercase tracking-wide text-slate-400">Contexto do preço</span>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger className="h-9 w-48 rounded-lg text-xs font-bold"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Preço global</SelectItem>{scopedKiosks.map((kiosk) => <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger className="h-9 w-44 rounded-lg text-xs font-bold"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Balcão</SelectItem>{activeChannels.map((channel) => <SelectItem key={channel.id} value={channel.id}>{channel.name}</SelectItem>)}</SelectContent>
            </Select>
            <span className="text-[11px] text-slate-400">Indicadores recalculados para a unidade e o canal escolhidos.</span>
          </div>}
          
          {/* Summary Cards */}
          {!isInstruction && <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <div className="bg-white p-4 rounded-xl border shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Preço de Venda</p>
              <p className="text-lg font-black text-gray-900">{priceResolution.available ? formatCurrency(priceResolution.price) : 'Indisponível'}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Custo (CMV)</p>
              <p className="text-lg font-black text-gray-900">{formatCurrency(simulation.totalCmv)}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Margem Bruta R$</p>
              <p className="text-lg font-black text-gray-900">{formatCurrency(metrics.grossMargin)}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Margem Bruta %</p>
              <p className="text-lg font-black text-gray-900">{metrics.grossMarginPct.toFixed(1)}%</p>
            </div>
            <div className="bg-white p-4 rounded-xl border shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">M. Contribuição</p>
              <p className={cn(
                "text-xl font-black",
                (simulation.profitGoal && metrics.profitPercentage >= simulation.profitGoal) ? "text-green-600" : "text-orange-500"
              )}>
                {metrics.profitPercentage.toFixed(1)}%
              </p>
            </div>
            <div className="bg-white p-4 rounded-xl border shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Markup</p>
              <p className="text-lg font-black text-gray-700">{metrics.markup.toFixed(2)}x</p>
            </div>
          </div>}

          <div className="grid gap-5 lg:grid-cols-[1fr_258px]">
            <div className="space-y-8">
              {/* Composition */}
              <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b bg-gray-50/50">
                  <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                    <Utensils className="h-4 w-4 text-pink-500" />
                    {isInstruction ? 'Checklist de Ingredientes' : 'Composição e Custos'}
                  </h3>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-[10px] font-bold uppercase h-10">Item</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase h-10 text-center">Quantidade</TableHead>
                      {!isInstruction && <TableHead className="text-[10px] font-bold uppercase h-10 text-right">Custo Total</TableHead>}
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
                        {!isInstruction && <TableCell className="py-3 text-right text-sm font-bold text-gray-900">
                          {formatCurrency(ing.quantity * ing.cost)}
                        </TableCell>}
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

              {isInstruction && qualityStandards.length > 0 && (
                <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                  <div className="flex items-center gap-2 border-b bg-slate-950 px-6 py-4 text-white">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <h3 className="text-sm font-bold">Padrão de Qualidade</h3>
                  </div>
                  <div className="divide-y">
                    {qualityStandards.map((item: any) => (
                      <div key={item.id ?? item.text} className="flex items-start gap-3 px-6 py-4">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        <p className="text-sm leading-relaxed text-slate-700">{item.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isInstruction && simulation.ppo?.assemblyVideoUrl && (
                <a
                  href={simulation.ppo.assemblyVideoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 transition-colors hover:bg-blue-100"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white"><Video className="h-4 w-4" /></span>
                  <span><strong className="block text-sm text-blue-950">Vídeo de montagem</strong><span className="text-xs text-blue-600">Abrir instrução em vídeo</span></span>
                </a>
              )}
            </div>

            <div className="space-y-6">
              {/* Photo */}
              {simulation.ppo?.referenceImageUrl ? (
                <div className="bg-white p-2 rounded-2xl border shadow-sm">
                   <img src={simulation.ppo.referenceImageUrl} alt={`Foto de referência de ${simulation.name}`} className="w-full aspect-square object-contain rounded-xl" />
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
                      <span className="text-gray-500">Unidades</span>
                      <div className="flex flex-wrap gap-1 justify-end max-w-[150px]">
                        {scopedKiosks.length === commercialKiosks.length ? <span className="font-bold text-gray-700">Todas</span> : scopedKiosks.map((kiosk) => <Badge key={kiosk.id} variant="secondary" className="h-4 px-1.5 text-[9px]">{kiosk.name}</Badge>)}
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
              {!isInstruction && <div className="bg-gray-100/50 p-6 rounded-2xl border border-dashed border-gray-200 space-y-3">
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
              </div>}

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
