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
import { useToast } from '@/hooks/use-toast';

import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ChevronsUpDown, Calculator, Info } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductSheetTab } from './product-sheet-tab';
import { cn } from '@/lib/utils';

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
  const { updateSimulation } = useProductSimulation();
  const { categories } = useProductSimulationCategories();
  const { pricingParameters } = useCompanySettings();
  const { kiosks } = useKiosks();
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

  const cmv = simulation.totalCmv || 0;
  
  const results = useMemo(() => {
    const price = watchedSalePrice;
    const tax = pricingParameters?.averageTaxPercentage || 0;
    const fee = pricingParameters?.averageCardFeePercentage || 0;
    const taxVal = price * (tax / 100);
    const feeVal = price * (fee / 100);
    const netRev = price - taxVal - feeVal;
    const margin = netRev - cmv;
    const marginPct = price > 0 ? (margin / price) * 100 : 0;
    const grossMargin = price - cmv;
    const grossMarginPct = price > 0 ? (grossMargin / price) * 100 : 0;
    const markup = cmv > 0 ? price / cmv : 0;

    return { netRev, taxVal, feeVal, margin, marginPct, grossMargin, grossMarginPct, markup };
  }, [watchedSalePrice, cmv, pricingParameters]);

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

  const onSubmit = async (values: CostAnalysisFormValues) => {
    try {
      await updateSimulation({
        ...simulation,
        ...values,
        totalCmv: cmv,
        profitValue: results.margin,
        profitPercentage: results.marginPct,
        markup: results.markup,
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
      toast({ variant: "destructive", title: "Erro ao salvar", description: "Ocorreu um erro ao salvar as alterações." });
    }
  };

  const mainCategories = categories.filter(c => c.type === 'category');
  const lines = categories.filter(c => c.type === 'line');
  const groups = categories.filter(c => c.type === 'group');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Tabs defaultValue="cost" className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-2 border-b bg-gray-50/30">
          <TabsList className="bg-transparent border-0 p-0 h-auto gap-4">
            <TabsTrigger value="cost" className="data-[state=active]:bg-white data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-gray-200 px-3 py-1.5 text-xs font-bold rounded-lg transition-all">
              1. Precificação e Fiscal
            </TabsTrigger>
            <TabsTrigger value="ficha" className="data-[state=active]:bg-white data-[state=active]:shadow-sm border border-transparent data-[state=active]:border-gray-200 px-3 py-1.5 text-xs font-bold rounded-lg transition-all">
              2. Composição e Preparo
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

        <TabsContent value="ficha" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex">
          <ProductSheetTab simulation={simulation} onOpenChange={onOpenChange} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
