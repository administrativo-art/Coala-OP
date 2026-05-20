"use client";

import React, { useEffect, useMemo, useState } from 'react';
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
import { ChevronsUpDown } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductSheetTab } from './product-sheet-tab';
import { cn } from '@/lib/utils';
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

const parseCurrencyInput = (value: string) => {
  const parsed = Number(value.trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
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

function normalizeUnitName(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isCommercialSalesUnit(name: string) {
  const normalized = normalizeUnitName(name);
  return !normalized.includes('matriz') && !normalized.includes('centro de distribuicao');
}

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
  const watchedKioskIds = useWatch({ control: form.control, name: 'kioskIds' }) || [];
  const [editingOverride, setEditingOverride] = useState<{ unitId: string | null; channelId: string | null } | null>(null);
  const [overridePriceInput, setOverridePriceInput] = useState<string>('');
  const [overrideAvailable, setOverrideAvailable] = useState(true);
  const [overrideUpdatedAt, setOverrideUpdatedAt] = useState<string | undefined>(undefined);
  const [unitPriceDrafts, setUnitPriceDrafts] = useState<Record<string, string>>({});

  const cmv = simulation.totalCmv || 0;
  const commercialSalesKiosks = useMemo(
    () => kiosks.filter((kiosk) => isCommercialSalesUnit(kiosk.name)),
    [kiosks]
  );
  const scopedKiosks = useMemo(() => {
    if (watchedKioskIds.length === 0) return commercialSalesKiosks;
    return kiosks.filter(kiosk => watchedKioskIds.includes(kiosk.id));
  }, [commercialSalesKiosks, kiosks, watchedKioskIds]);
  const activeChannels = useMemo(() => channels.filter(channel => channel.active), [channels]);
  const overrides = useMemo(() => getSimulationOverrides(simulation.id), [getSimulationOverrides, simulation.id]);
  const previewSimulation = useMemo(
    () => ({ ...simulation, kioskIds: scopedKiosks.map(kiosk => kiosk.id), salePrice: watchedSalePrice }),
    [simulation, scopedKiosks, watchedSalePrice]
  );
  const unitPriceDraftsKey = useMemo(
    () => scopedKiosks.map(kiosk => kiosk.id).join('|'),
    [scopedKiosks]
  );

  useEffect(() => {
    if ((simulation.kioskIds ?? []).length === 0 && commercialSalesKiosks.length > 0 && watchedKioskIds.length === 0) {
      form.setValue('kioskIds', commercialSalesKiosks.map(kiosk => kiosk.id), { shouldDirty: false });
      return;
    }

    const nextDrafts: Record<string, string> = {};
    scopedKiosks.forEach((kiosk) => {
      const existing = overrides.find(override => override.unitId === kiosk.id && override.channelId === null);
      const price = existing?.finalPrice ?? simulation.salePrice ?? 0;
      nextDrafts[kiosk.id] = price ? String(price).replace('.', ',') : '';
    });
    setUnitPriceDrafts(nextDrafts);
  }, [commercialSalesKiosks, form, simulation.id, simulation.kioskIds, simulation.salePrice, unitPriceDraftsKey, overrides, scopedKiosks, watchedKioskIds.length]);

  const getUnitDraftPrice = (unitId: string) => parseCurrencyInput(unitPriceDrafts[unitId] ?? '');
  
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
      toast({ title: 'Preço específico salvo.' });
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
      toast({ title: 'Preço específico removido. A herança foi restaurada.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Erro ao remover preço específico.' });
    }
  };

  const handleApplyChannelRule = async () => {
    if (!editingOverride?.channelId) return;
    await handleDeleteOverride();
  };

  const handleToggleContextAvailability = async (
    unitId: string,
    channelId: string,
    available: boolean
  ) => {
    const existing = overrides.find(
      override => override.unitId === unitId && override.channelId === channelId
    ) ?? null;

    try {
      if (available && existing?.finalPrice == null) {
        await deletePriceOverride(buildPriceOverrideId(simulation.id, unitId, channelId));
        return;
      }

      await upsertPriceOverride({
        simulationId: simulation.id,
        unitId,
        channelId,
        finalPrice: existing?.finalPrice ?? null,
        available,
        updatedAt: existing?.updatedAt,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao atualizar disponibilidade.',
        description: error instanceof Error ? error.message : 'Erro inesperado.',
      });
    }
  };

  const onSubmit = async (values: CostAnalysisFormValues) => {
    try {
      const invalidUnit = scopedKiosks.find((kiosk) => getUnitDraftPrice(kiosk.id) <= 0);
      if (invalidUnit) {
        toast({
          variant: "destructive",
          title: "Preço por unidade obrigatório",
          description: `Informe um preço maior que zero para ${invalidUnit.name}.`,
        });
        return;
      }

      await updateSimulation({
        ...simulation,
        ...values,
        salePrice: scopedKiosks[0] ? getUnitDraftPrice(scopedKiosks[0].id) : values.salePrice,
        kioskIds: scopedKiosks.map(kiosk => kiosk.id),
        ppo: {
          ...simulation.ppo,
          ncm: values.ncm,
          cest: values.cest,
          cfop: values.cfop,
        } as any
      });
      await Promise.all(scopedKiosks.map((kiosk) => {
        const existing = overrides.find(override => override.unitId === kiosk.id && override.channelId === null);
        return upsertPriceOverride({
          simulationId: simulation.id,
          unitId: kiosk.id,
          channelId: null,
          finalPrice: getUnitDraftPrice(kiosk.id),
          available: true,
          updatedAt: existing?.updatedAt,
        });
      }));
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
    'override:unit+channel': 'Preço específico',
    'override:unit': 'Preço da unidade',
    'override:channel': 'Preço do canal',
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
              2. Preço por Canal
            </TabsTrigger>
            <TabsTrigger value="ficha" className="data-[state=active]:bg-white data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-gray-200 px-3 py-1.5 text-xs font-bold rounded-lg transition-all">
              3. Composição e Preparo
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="cost" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex">
          <Form {...form}>
            <form id="product-modal-form" onSubmit={form.handleSubmit(onSubmit)} className="flex w-full h-full">
              <ScrollArea className="flex-1 p-6">
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
                                {field.value?.length ? `${field.value.length} selecionado(s)` : "Selecione unidades"}
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
                    <div className="flex justify-between items-center gap-4">
                      <div>
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Definição de preço por unidade</h4>
                        <p className="mt-1 text-xs text-gray-500">Preço balcão individual por unidade comercial.</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold text-gray-400">CMV</p>
                        <p className="text-lg font-bold text-gray-900">{formatCurrency(cmv)}</p>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {scopedKiosks.map((kiosk) => {
                        const unitPrice = getUnitDraftPrice(kiosk.id);
                        const tax = pricingParameters?.averageTaxPercentage || 0;
                        const fee = pricingParameters?.averageCardFeePercentage || 0;
                        const metrics = calculateSimulationMetrics(unitPrice, cmv, tax, fee);
                        const goal = form.getValues('profitGoal') || 0;

                        return (
                          <div key={kiosk.id} className="rounded-xl border bg-gray-50/50 p-4">
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-gray-900">{kiosk.name}</p>
                                <p className="mt-0.5 text-xs text-gray-400">Preço balcão da unidade</p>
                              </div>
                              <Badge variant="outline" className="bg-white text-[10px]">Balcão</Badge>
                            </div>

                            <div className="relative mb-4">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">R$</span>
                              <Input
                                inputMode="decimal"
                                className="pl-8 text-right font-bold text-gray-900 focus:ring-pink-200"
                                value={unitPriceDrafts[kiosk.id] ?? ''}
                                onChange={(event) =>
                                  setUnitPriceDrafts((current) => ({
                                    ...current,
                                    [kiosk.id]: event.target.value,
                                  }))
                                }
                              />
                            </div>

                            <div className="space-y-2 text-xs">
                              <div className="flex justify-between text-gray-400">
                                <span>Impostos {tax}% + Taxas {fee}%</span>
                                <span className="font-medium">({formatCurrency(unitPrice * ((tax + fee) / 100))})</span>
                              </div>
                              <Separator className="bg-gray-100" />
                              <div className="flex justify-between">
                                <span className="font-bold text-green-700">Margem de Contribuição</span>
                                <div className="text-right">
                                  <p className="font-bold text-green-700">{formatCurrency(metrics.profitValue)}</p>
                                  <p className="text-green-600">{metrics.profitPercentage.toFixed(1)}%</p>
                                </div>
                              </div>
                              <div className="flex justify-between">
                                <span className="font-bold text-gray-700">Margem Bruta</span>
                                <div className="text-right">
                                  <p className={cn(
                                    "text-lg font-black",
                                    metrics.grossMarginPct >= goal ? "text-green-600" : "text-orange-500"
                                  )}>
                                    {metrics.grossMarginPct.toFixed(1)}%
                                  </p>
                                  <p className="text-gray-400">{goal ? `Meta: ${goal}%` : 'Sem meta'}</p>
                                </div>
                              </div>
                              <div className="flex justify-between">
                                <span className="font-medium text-gray-500">Markup</span>
                                <span className="font-bold text-gray-700">{metrics.markup.toFixed(2)}x</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
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
            </form>
          </Form>
        </TabsContent>

        <TabsContent value="contexts" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex">
          <ScrollArea className="flex-1 p-6">
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">Preços por canal de venda</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  O balcão vem da definição por unidade. Use esta etapa para cadastrar preços dos demais canais.
                </p>
              </div>

              <div className="grid gap-4">
                {scopedKiosks.map((unit) => (
                  <div key={unit.id} className="rounded-xl border bg-white p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h5 className="text-sm font-bold text-gray-900">{unit.name}</h5>
                      <Badge variant="outline" className="bg-gray-50 text-[10px]">Unidade comercial</Badge>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {activeChannels.map((channel) => {
                        const resolution = resolveSimulationPrice(previewSimulation, unit.id, channel.id);
                        const exactOverride = overrides.find(
                          (override) => override.unitId === unit.id && override.channelId === channel.id
                        ) ?? null;

                        return (
                          <button
                            key={`${unit.id}:${channel.id}`}
                            type="button"
                            onClick={() => openOverrideEditor(unit.id, channel.id)}
                            className="rounded-lg border bg-gray-50/50 p-3 text-left transition-colors hover:bg-gray-50"
                          >
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-semibold text-gray-800">{channel.name}</span>
                              <div
                                className="flex items-center gap-2"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <span className={cn(
                                  "text-[10px] font-bold",
                                  resolution.available ? "text-emerald-600" : "text-rose-600"
                                )}>
                                  {resolution.available ? 'Ativo' : 'Inativo'}
                                </span>
                                <Switch
                                  checked={resolution.available}
                                  onCheckedChange={(checked) => handleToggleContextAvailability(unit.id, channel.id, checked)}
                                />
                              </div>
                            </div>
                            <div className="flex items-end justify-between gap-3">
                              <div>
                                <p className="text-lg font-black text-gray-900">
                                  {resolution.price === null ? 'Indisponível' : formatCurrency(resolution.price)}
                                </p>
                                <p className="mt-1 text-[11px] text-muted-foreground">{sourceLabels[resolution.source] ?? resolution.source}</p>
                              </div>
                              {exactOverride && (
                                <span className="text-[11px] font-medium text-muted-foreground">
                                  Preço específico
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
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
            <DialogTitle>Editar preço</DialogTitle>
            <DialogDescription>
              Defina um preço final para este contexto ou marque-o como indisponível sem perder o valor salvo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Preço final</label>
              <Input
                inputMode="decimal"
                placeholder="Deixe vazio para remover o preço específico"
                value={overridePriceInput}
                onChange={(event) => setOverridePriceInput(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Campo vazio remove o preço específico. `0` continua sendo uma tentativa explícita de preço zero e será rejeitado.
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
                  Remover preço específico
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
