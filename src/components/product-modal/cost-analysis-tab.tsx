"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { type ProductSimulation } from '@/types';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { useKiosks } from '@/hooks/use-kiosks';
import { useChannels } from '@/hooks/use-channels';
import { useToast } from '@/hooks/use-toast';
import { buildPriceOverrideId, calculateSimulationMetrics } from '@/lib/pricing-context';

import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ChevronsUpDown, Calculator } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductSheetTab } from './product-sheet-tab';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';

const simulationSchema = z.object({
  name: z.string().min(1, 'O nome da mercadoria é obrigatório.'),
  kioskIds: z.array(z.string()).optional(),
  categoryIds: z.array(z.string()),
  lineId: z.string().nullable().optional(),
  groupIds: z.array(z.string()),
  salePrice: z.coerce.number().min(0).optional(),
  profitGoal: z.coerce.number().nullable().optional(),
  notes: z.string().optional(),
  ncm: z.string().optional(),
  cest: z.string().optional(),
  cfop: z.string().optional(),
});

type CostAnalysisFormValues = z.infer<typeof simulationSchema>;

const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    const isNegative = value < 0;
    const formatted = Math.abs(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return isNegative ? `- ${formatted}` : formatted;
};

const fmtNCM = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 8);
    if (d.length <= 4) return d;
    if (d.length <= 6) return `${d.slice(0, 4)}.${d.slice(4)}`;
    return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`;
};

const fmtCEST = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 7);
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
};

export function CostAnalysisTab({ simulation, onOpenChange }: { simulation: ProductSimulation, onOpenChange: (open: boolean) => void }) {
  const { updateSimulation, getSimulationOverrides, resolveSimulationPrice, upsertPriceOverride, deletePriceOverride } = useProductSimulation();
  const { categories } = useProductSimulationCategories();
  const { pricingParameters } = useCompanySettings();
  const { kiosks } = useKiosks();
  const { channels } = useChannels();
  const { toast } = useToast();

  const form = useForm<CostAnalysisFormValues>({
    resolver: zodResolver(simulationSchema),
    defaultValues: {
      name: simulation.name,
      kioskIds: simulation.kioskIds || [],
      categoryIds: simulation.categoryIds || [],
      lineId: simulation.lineId,
      groupIds: simulation.groupIds || [],
      salePrice: simulation.salePrice,
      profitGoal: simulation.profitGoal,
      notes: simulation.notes,
      ncm: simulation.ppo?.ncm || '',
      cest: simulation.ppo?.cest || '',
      cfop: simulation.ppo?.cfop || '',
    },
  });

  const watchedSalePrice = useWatch({ control: form.control, name: 'salePrice' }) || 0;
  const [simulatedPrice, setSimulatedPrice] = useState<number | null>(null);
  const [simulatedGoal, setSimulatedGoal] = useState<number | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('all');
  const [selectedChannelId, setSelectedChannelId] = useState<string>('all');
  const [editingOverride, setEditingOverride] = useState<{ unitId: string | null; channelId: string | null } | null>(null);
  const [overridePriceInput, setOverridePriceInput] = useState<string>('');
  const [overrideAvailable, setOverrideAvailable] = useState(true);
  const [overrideUpdatedAt, setOverrideUpdatedAt] = useState<string | undefined>(undefined);

  const cmv = simulation.totalCmv || 0;
  const scopedKiosks = useMemo(() => kiosks.filter(kiosk => (simulation.kioskIds || []).includes(kiosk.id)), [kiosks, simulation.kioskIds]);
  const activeChannels = useMemo(() => channels.filter(channel => channel.active), [channels]);
  const overrides = useMemo(() => getSimulationOverrides(simulation.id), [getSimulationOverrides, simulation.id]);
  const previewSimulation = useMemo(() => ({ ...simulation, salePrice: watchedSalePrice }), [simulation, watchedSalePrice]);
  const selectedResolution = useMemo(() => {
    return resolveSimulationPrice(
      previewSimulation,
      selectedUnitId === 'all' ? null : selectedUnitId,
      selectedChannelId === 'all' ? null : selectedChannelId
    );
  }, [previewSimulation, resolveSimulationPrice, selectedUnitId, selectedChannelId]);
  const effectiveSalePrice = (selectedUnitId !== 'all' || selectedChannelId !== 'all')
    ? (selectedResolution.price ?? 0)
    : watchedSalePrice;
  
  const results = useMemo(() => {
    const price = effectiveSalePrice;
    const tax = pricingParameters?.averageTaxPercentage || 0;
    const fee = pricingParameters?.averageCardFeePercentage || 0;
    const metrics = calculateSimulationMetrics(price, cmv, tax, fee);

    return {
      netRev: metrics.netRevenue,
      taxVal: price * (tax / 100),
      feeVal: price * (fee / 100),
      margin: metrics.profitValue,
      marginPct: metrics.profitPercentage,
      grossMargin: metrics.grossMargin,
      grossMarginPct: metrics.grossMarginPct,
      markup: metrics.markup,
    };
  }, [effectiveSalePrice, cmv, pricingParameters]);

  const handleSimPriceChange = (val: string) => {
    const p = parseFloat(val);
    setSimulatedPrice(p);
    if (!isNaN(p) && p > 0) {
      const tax = pricingParameters?.averageTaxPercentage || 0;
      const fee = pricingParameters?.averageCardFeePercentage || 0;
      const net = p * (1 - (tax + fee) / 100);
      setSimulatedGoal(((net - cmv) / p * 100));
    } else {
      setSimulatedGoal(null);
    }
  };

  const handleSimGoalChange = (val: string) => {
    const g = parseFloat(val);
    setSimulatedGoal(g);
    if (!isNaN(g)) {
      const tax = pricingParameters?.averageTaxPercentage || 0;
      const fee = pricingParameters?.averageCardFeePercentage || 0;
      const denom = (1 - (tax + fee) / 100) - (g / 100);
      setSimulatedPrice(denom > 0 ? cmv / denom : null);
    } else {
      setSimulatedPrice(null);
    }
  };

  const applySimulation = () => {
    if (simulatedPrice !== null) form.setValue('salePrice', simulatedPrice);
    if (simulatedGoal !== null) form.setValue('profitGoal', simulatedGoal);
    setSimulatedPrice(null);
    setSimulatedGoal(null);
    toast({ title: "Simulação aplicada!" });
  };

  const openOverrideEditor = (unitId: string | null, channelId: string | null) => {
    if (unitId === null && channelId === null) {
      return;
    }

    const existing = overrides.find(
      override => override.unitId === unitId && override.channelId === channelId
    );
    const resolved = resolveSimulationPrice(previewSimulation, unitId, channelId);

    setEditingOverride({ unitId, channelId });
    setOverridePriceInput(existing?.finalPrice != null ? String(existing.finalPrice).replace('.', ',') : (resolved.price != null ? String(resolved.price).replace('.', ',') : ''));
    setOverrideAvailable(existing?.available ?? true);
    setOverrideUpdatedAt(existing?.updatedAt);
  };

  const handleSaveOverride = async () => {
    if (!editingOverride) return;

    try {
      const trimmedPrice = overridePriceInput.trim();
      const parsedPrice =
        trimmedPrice === ''
          ? null
          : Number(trimmedPrice.replace(/\./g, '').replace(',', '.'));

      await upsertPriceOverride({
        simulationId: simulation.id,
        unitId: editingOverride.unitId,
        channelId: editingOverride.channelId,
        finalPrice: parsedPrice,
        available: overrideAvailable,
        updatedAt: overrideUpdatedAt,
      });
      setEditingOverride(null);
      toast({ title: 'Override salvo com sucesso.' });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao salvar override',
        description: error instanceof Error ? error.message : 'Erro inesperado.',
      });
    }
  };

  const handleDeleteOverride = async () => {
    if (!editingOverride) return;

    try {
      await deletePriceOverride(buildPriceOverrideId(simulation.id, editingOverride.unitId, editingOverride.channelId));
      setEditingOverride(null);
      toast({ title: 'Override removido. A herança foi restaurada.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Erro ao remover override.' });
    }
  };

  const handleApplyChannelRule = async () => {
    if (!editingOverride?.channelId) return;
    await handleDeleteOverride();
  };

  const onSubmit = async (values: CostAnalysisFormValues) => {
    try {
      await updateSimulation({
        ...simulation,
        ...values,
        ppo: {
          ...simulation.ppo,
          ncm: values.ncm,
          cest: values.cest,
          cfop: values.cfop,
        } as any
      });
      toast({ title: "Análise de custo salva com sucesso!" });
      onOpenChange(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: error instanceof Error ? error.message : "Ocorreu um erro ao salvar as alterações."
      });
    }
  };

  const mainCategories = categories.filter(c => c.type === 'category');
  const lines = categories.filter(c => c.type === 'line');
  const groups = categories.filter(c => c.type === 'group');
  const editingChannel = editingOverride?.channelId ? channels.find(channel => channel.id === editingOverride.channelId) ?? null : null;
  const editingChannelRulePrice = useMemo(() => {
    if (!editingChannel?.defaultPriceRule || editingChannel.defaultPriceRule.mode !== 'markup') {
      return null;
    }
    return watchedSalePrice * (1 + editingChannel.defaultPriceRule.value);
  }, [editingChannel, watchedSalePrice]);
  const editingHasManualOverride = useMemo(() => {
    if (!editingOverride) return false;
    return overrides.some(
      (override) => override.unitId === editingOverride.unitId && override.channelId === editingOverride.channelId
    );
  }, [editingOverride, overrides]);

  const sourceLabels: Record<string, string> = {
    'override:unit+channel': 'Override específico',
    'override:unit': 'Override da unidade',
    'override:channel': 'Override do canal',
    'channel-default-rule': 'Regra do canal',
    'global': 'Preço global',
    'unit-disabled': 'Unidade desabilitada',
    'channel-inactive': 'Canal inativo',
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Tabs defaultValue="cost" className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-2 border-b bg-gray-50/30">
          <TabsList className="bg-transparent border-0 p-0 h-auto gap-4">
            <TabsTrigger value="cost" className="data-[state=active]:bg-white data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-gray-200 px-3 py-1.5 text-xs font-bold rounded-lg transition-all">
              1. Precificação e Fiscal
            </TabsTrigger>
            <TabsTrigger value="contexts" className="data-[state=active]:bg-white data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-gray-200 px-3 py-1.5 text-xs font-bold rounded-lg transition-all">
              2. Preços por Contexto
            </TabsTrigger>
            <TabsTrigger value="ficha" className="data-[state=active]:bg-white data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-gray-200 px-3 py-1.5 text-xs font-bold rounded-lg transition-all">
              3. Composição e Preparo
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="cost" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex">
          <Form {...form}>
            <form id="product-modal-form" onSubmit={form.handleSubmit(onSubmit)} className="flex w-full h-full">
              {/* Left Side - Form */}
              <ScrollArea className="flex-1 p-6 border-r">
                <div className="space-y-6">
                  {/* Categorização */}
                  <div className="grid grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="kioskIds"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold text-gray-500 uppercase">Quiosques</FormLabel>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" className="w-full justify-between text-xs font-normal">
                                {field.value?.length ? `${field.value.length} selecionado(s)` : "Todos"}
                                <ChevronsUpDown className="h-3 w-3 opacity-50" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-56">
                              {kiosks.map(k => (
                                <DropdownMenuCheckboxItem
                                  key={k.id}
                                  checked={field.value?.includes(k.id)}
                                  onCheckedChange={(checked) => {
                                    const curr = field.value || [];
                                    field.onChange(checked ? [...curr, k.id] : curr.filter(id => id !== k.id));
                                  }}
                                >
                                  {k.name}
                                </DropdownMenuCheckboxItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="categoryIds"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold text-gray-500 uppercase">Categorias</FormLabel>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" className="w-full justify-between text-xs font-normal">
                                {field.value?.length ? `${field.value.length} selecionada(s)` : "Selecione"}
                                <ChevronsUpDown className="h-3 w-3 opacity-50" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-56">
                              {mainCategories.map(c => (
                                <DropdownMenuCheckboxItem
                                  key={c.id}
                                  checked={field.value?.includes(c.id)}
                                  onCheckedChange={(checked) => {
                                    const curr = field.value || [];
                                    field.onChange(checked ? [...curr, c.id] : curr.filter(id => id !== c.id));
                                  }}
                                >
                                  {c.name}
                                </DropdownMenuCheckboxItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="lineId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-semibold text-gray-500 uppercase">Linha</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || "none"}>
                            <SelectTrigger className="text-xs">
                              <SelectValue placeholder="Selecione" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Nenhuma</SelectItem>
                              {lines.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Dados Fiscais */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Dados Fiscais</h4>
                    <div className="grid grid-cols-3 gap-4">
                      <FormField
                        control={form.control}
                        name="ncm"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs font-medium text-gray-600">NCM</FormLabel>
                            <Input 
                              {...field} 
                              placeholder="0000.00.00" 
                              onChange={(e) => field.onChange(fmtNCM(e.target.value))}
                              className="font-mono text-xs"
                            />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="cest"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs font-medium text-gray-600">CEST</FormLabel>
                            <Input 
                              {...field} 
                              placeholder="00.000.00" 
                              onChange={(e) => field.onChange(fmtCEST(e.target.value))}
                              className="font-mono text-xs"
                            />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="cfop"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs font-medium text-gray-600">CFOP</FormLabel>
                            <Input 
                              {...field} 
                              placeholder="5102" 
                              maxLength={4}
                              onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ''))}
                              className="font-mono text-xs"
                            />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {/* Definição de Preço */}
                  <div className="p-5 border rounded-xl bg-white shadow-sm space-y-4">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Definição de Preço</h4>
                    
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-sm font-semibold text-gray-800">Custo da mercadoria (CMV)</p>
                        <p className="text-xs text-gray-400">Calculado pela composição na aba Ficha</p>
                      </div>
                      <div className="text-right">
                        <span className="text-lg font-bold text-gray-900">{formatCurrency(cmv)}</span>
                      </div>
                    </div>

                    <Separator className="bg-gray-100" />

                    <FormField
                      control={form.control}
                      name="salePrice"
                      render={({ field }) => (
                        <FormItem className="flex justify-between items-center space-y-0">
                          <FormLabel className="text-sm font-semibold text-gray-800">Preço de venda</FormLabel>
                          <div className="relative w-32">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">R$</span>
                            <Input 
                              type="number" 
                              step="0.01" 
                              className="pl-8 text-right font-bold text-gray-900 focus:ring-pink-200" 
                              {...field} 
                            />
                          </div>
                        </FormItem>
                      )}
                    />

                    <div className="flex justify-between items-center text-xs text-gray-400">
                      <span>— Impostos {pricingParameters?.averageTaxPercentage}% + Taxas {pricingParameters?.averageCardFeePercentage}%</span>
                      <span className="font-medium">({formatCurrency(results.taxVal + results.feeVal)})</span>
                    </div>

                    <Separator className="bg-gray-100" />

                    <div className="flex justify-between items-center">
                      <span className="text-sm font-bold text-green-700">= Margem de Contribuição</span>
                      <div className="text-right">
                        <p className="text-lg font-bold text-green-700">{formatCurrency(results.margin)}</p>
                        <p className="text-xs text-green-600 font-medium">{results.marginPct.toFixed(1)}%</p>
                      </div>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-sm font-bold text-gray-700">Margem Bruta</span>
                      <div className="text-right">
                        <p className={cn(
                          "text-2xl font-black",
                          results.grossMarginPct >= (form.getValues('profitGoal') || 0) ? "text-green-600" : "text-orange-500"
                        )}>
                          {results.grossMarginPct.toFixed(1)}%
                        </p>
                        <p className="text-xs font-medium text-gray-400">
                          {form.getValues('profitGoal') ? `Meta: ${form.getValues('profitGoal')}%` : 'Sem meta'}
                        </p>
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-1">
                      <span className="text-xs font-medium text-gray-500">Markup</span>
                      <span className="text-sm font-bold text-gray-700">{results.markup.toFixed(2)}x</span>
                    </div>
                  </div>

                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-semibold text-gray-500 uppercase">Observações</FormLabel>
                        <FormControl>
                          <Input placeholder="Notas sobre esta mercadoria..." {...field} className="text-xs" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <button type="submit" id="product-modal-submit-btn" className="hidden" />
              </ScrollArea>

              {/* Right Side - What If Simulator */}
              <div className="w-[320px] bg-blue-50/50 flex-shrink-0 overflow-y-auto">
                <div className="p-6 space-y-6">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Calculator className="h-4 w-4 text-blue-600" />
                      <h4 className="text-sm font-bold text-blue-900">Simulador</h4>
                    </div>
                    <p className="text-xs text-blue-600 leading-relaxed">
                      Insira o preço <em>ou</em> a meta desejada para calcular o outro automaticamente.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-blue-700 uppercase">Unidade</label>
                      <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
                        <SelectTrigger className="bg-white border-blue-200 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todas as unidades</SelectItem>
                          {scopedKiosks.map((kiosk) => (
                            <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-blue-700 uppercase">Canal</label>
                      <Select value={selectedChannelId} onValueChange={setSelectedChannelId}>
                        <SelectTrigger className="bg-white border-blue-200 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos os canais</SelectItem>
                          {activeChannels.map((channel) => (
                            <SelectItem key={channel.id} value={channel.id}>{channel.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="rounded-lg border border-blue-100 bg-white p-3 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Fonte</span>
                        <span className="font-semibold text-blue-700">{selectedResolution.source}</span>
                      </div>
                      <div className="mt-2 flex justify-between">
                        <span className="text-gray-500">Disponibilidade</span>
                        <span className={cn("font-semibold", selectedResolution.available ? "text-emerald-600" : "text-rose-600")}>
                          {selectedResolution.available ? 'Disponível' : 'Indisponível'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-blue-700 uppercase">Simular Preço (R$)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-300 text-xs font-bold">R$</span>
                        <Input 
                          type="number" 
                          placeholder="Ex: 14.90" 
                          value={simulatedPrice === null ? '' : simulatedPrice}
                          onChange={(e) => handleSimPriceChange(e.target.value)}
                          className="pl-8 bg-white border-blue-200 text-sm focus:ring-blue-300"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-center">
                      <span className="text-[10px] font-black text-blue-200">OU</span>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-blue-700 uppercase">Simular Meta (%)</label>
                      <div className="relative">
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-300 text-xs font-bold">%</span>
                        <Input 
                          type="number" 
                          placeholder="Ex: 65" 
                          value={simulatedGoal === null ? '' : simulatedGoal?.toFixed(1)}
                          onChange={(e) => handleSimGoalChange(e.target.value)}
                          className="pr-8 bg-white border-blue-200 text-sm focus:ring-blue-300"
                        />
                      </div>
                    </div>

                    {(simulatedPrice !== null || simulatedGoal !== null) && (
                      <div className="bg-white rounded-lg p-3 border border-blue-100 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Preço</span>
                            <span className="font-bold text-gray-900">{formatCurrency(simulatedPrice)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-500">M. Bruta</span>
                            <span className="font-bold text-blue-600">{(simulatedGoal || 0).toFixed(1)}%</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <Button 
                      type="button"
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold h-9 shadow-sm"
                      disabled={simulatedPrice === null && simulatedGoal === null}
                      onClick={applySimulation}
                    >
                      Aplicar Valores →
                    </Button>
                  </div>

                  <Separator className="bg-blue-100" />

                  <div className="space-y-3">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-blue-500 font-medium">CMV Atual</span>
                      <span className="text-blue-900 font-bold">{formatCurrency(cmv)}</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-blue-400">Impostos</span>
                      <span className="text-blue-700">{pricingParameters?.averageTaxPercentage}%</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-blue-400">Taxa Cartão</span>
                      <span className="text-blue-700">{pricingParameters?.averageCardFeePercentage}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </Form>
        </TabsContent>

        <TabsContent value="contexts" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex">
          <ScrollArea className="flex-1 p-6">
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">Matriz de preços por contexto</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Edite overrides por unidade, por canal ou por unidade + canal. A célula global continua sendo o `salePrice`.
                </p>
              </div>

              <div className="rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[220px]">Unidade \\ Canal</TableHead>
                      <TableHead className="min-w-[170px]">Todos os canais</TableHead>
                      {activeChannels.map((channel) => (
                        <TableHead key={channel.id} className="min-w-[170px]">{channel.name}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[{ id: null, name: 'Todas as unidades' }, ...scopedKiosks.map(kiosk => ({ id: kiosk.id, name: kiosk.name }))].map((row) => (
                      <TableRow key={row.id ?? 'all-units'}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        {[null, ...activeChannels.map(channel => channel.id)].map((columnChannelId) => {
                          const isGlobalCell = row.id === null && columnChannelId === null;
                          const resolution = resolveSimulationPrice(previewSimulation, row.id, columnChannelId);
                          const exactOverride = overrides.find(
                            (override) => override.unitId === row.id && override.channelId === columnChannelId
                          ) ?? null;

                          return (
                            <TableCell key={`${row.id ?? 'all'}:${columnChannelId ?? 'all'}`}>
                              <button
                                type="button"
                                disabled={isGlobalCell}
                                onClick={() => openOverrideEditor(row.id, columnChannelId)}
                                className={cn(
                                  "w-full rounded-lg border p-3 text-left transition-colors",
                                  isGlobalCell ? "cursor-default bg-gray-50" : "hover:bg-gray-50"
                                )}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm font-semibold">{resolution.price === null ? 'Indisponível' : formatCurrency(resolution.price)}</span>
                                  <Badge variant={resolution.available ? 'outline' : 'destructive'}>
                                    {resolution.available ? 'Disponível' : 'Indisponível'}
                                  </Badge>
                                </div>
                                <p className="mt-2 text-[11px] text-muted-foreground">{sourceLabels[resolution.source] ?? resolution.source}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {exactOverride ? 'Override aplicado' : 'Herdado'}
                                </p>
                              </button>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="ficha" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex">
          <ProductSheetTab simulation={simulation} onOpenChange={onOpenChange} />
        </TabsContent>
      </Tabs>

      <Dialog open={!!editingOverride} onOpenChange={(open) => !open && setEditingOverride(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar override de preço</DialogTitle>
            <DialogDescription>
              Defina um preço final para este contexto ou marque-o como indisponível sem perder o valor salvo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Preço final</label>
              <Input
                inputMode="decimal"
                placeholder="Deixe vazio para remover o override"
                value={overridePriceInput}
                onChange={(event) => setOverridePriceInput(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Campo vazio remove o override. `0` continua sendo uma tentativa explícita de preço zero e será rejeitado.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Disponível para venda</p>
                <p className="text-xs text-muted-foreground">Quando desligado, o contexto fica indisponível mesmo com fallback global.</p>
              </div>
              <Switch checked={overrideAvailable} onCheckedChange={setOverrideAvailable} />
            </div>
            {editingChannelRulePrice !== null && (
              <div className="rounded-lg border p-3">
                <p className="text-sm font-medium">Regra padrão do canal</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Regra padrão: {formatCurrency(editingChannelRulePrice)}. Você está em {overridePriceInput.trim() ? overridePriceInput : 'herança'}.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="justify-between">
            <div className="flex gap-2">
              {editingHasManualOverride && (
                <Button type="button" variant="outline" onClick={handleDeleteOverride}>
                  Remover override
                </Button>
              )}
              {editingChannelRulePrice !== null && (
                <Button type="button" variant="outline" onClick={handleApplyChannelRule}>
                  Aplicar regra do canal
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingOverride(null)}>
                Cancelar
              </Button>
              <Button type="button" onClick={handleSaveOverride}>
                Salvar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
