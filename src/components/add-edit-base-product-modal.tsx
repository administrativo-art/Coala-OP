
"use client"

import React, { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { useBaseProducts } from '@/hooks/use-base-products';
import { useKiosks } from '@/hooks/use-kiosks';
import { useProducts } from '@/hooks/use-products';
import { units, unitCategories, type UnitCategory } from '@/lib/conversion';
import { type BaseProduct } from '@/types';
import { DollarSign, Calendar, Settings, FileText, Package, Check, ChevronLeft, ChevronRight, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ClassificationManagementModal } from './classification-management-modal';
import { useClassifications } from '@/hooks/use-classifications';

const stockLevelSchema = z.object({
    min: z.coerce.number().min(0, "Deve ser um valor positivo.").optional(),
    safetyStock: z.coerce.number().min(0, "Deve ser um valor positivo.").optional(),
    leadTime: z.coerce.number().min(0, "Deve ser um valor positivo.").optional(),
    override: z.boolean(),
});

function normalizeBaseProductName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR');
}

const baseProductSchema = z.object({
  name: z.string().trim().min(1, 'O nome é obrigatório.').transform(normalizeBaseProductName),
  classification: z.string().optional(),
  category: z.enum(unitCategories),
  unit: z.string().min(1, 'A unidade de medida é obrigatória.'),
  initialCostPerUnit: z.coerce.number().optional(),
  stockLevels: z.record(stockLevelSchema).optional(),
  consumptionMonths: z.coerce.number().min(0, "Deve ser um valor positivo.").optional(),
});


type BaseProductFormValues = z.infer<typeof baseProductSchema>;

interface AddEditBaseProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productToEditId: string | null;
}

const WIZARD_STEPS = [
    { id: 1, label: 'Identificação & medida', icon: FileText, description: 'Nome canônico, classificação e a unidade de referência de todo o insumo.' },
    { id: 2, label: 'Parâmetros por quiosque', icon: Package, description: 'Controle de estoque por local. Cada quiosque pode ter limites próprios.' },
] as const;

export function AddEditBaseProductModal({ open, onOpenChange, productToEditId }: AddEditBaseProductModalProps) {
  const { baseProducts, updateBaseProduct, addBaseProduct } = useBaseProducts();
  const { classifications, loading: loadingClassifications } = useClassifications();
  const { kiosks } = useKiosks();
  const { products } = useProducts();
  const [isClassificationModalOpen, setIsClassificationModalOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);

  const productToEdit = useMemo(() => {
    if (!productToEditId) return null;
    return baseProducts.find(p => p.id === productToEditId) || null;
  }, [productToEditId, baseProducts]);

  const derivedCount = useMemo(
    () => (productToEditId ? products.filter((p) => p.baseProductId === productToEditId && !p.isArchived).length : 0),
    [products, productToEditId],
  );

  const sortedKiosks = useMemo(() => {
    return [...kiosks].sort((a,b) => {
        if (a.id === 'matriz') return -1;
        if (b.id === 'matriz') return 1;
        return a.name.localeCompare(b.name);
    });
  }, [kiosks]);

  const form = useForm<BaseProductFormValues>({
    resolver: zodResolver(baseProductSchema),
    defaultValues: { name: '', classification: '', category: 'Massa', unit: 'g', initialCostPerUnit: 0, stockLevels: {}, consumptionMonths: 0 }
  });

  useEffect(() => {
    if (open) {
      setCurrentStep(1);
      const stockLevelsObject: Record<string, any> = {};
      sortedKiosks.forEach(kiosk => {
        const level = productToEdit?.stockLevels?.[kiosk.id];
        stockLevelsObject[kiosk.id] = {
            min: level?.min ?? 0,
            safetyStock: level?.safetyStock ?? 0,
            leadTime: level?.leadTime ?? 0,
            override: level?.override ?? false,
        };
      });

      form.reset({
        name: productToEdit?.name ? normalizeBaseProductName(productToEdit.name) : '',
        classification: productToEdit?.classification || 'none',
        category: productToEdit?.category ?? 'Massa',
        unit: productToEdit?.unit ?? 'g',
        initialCostPerUnit: productToEdit?.lastEffectivePrice?.pricePerUnit ?? productToEdit?.initialCostPerUnit ?? 0,
        stockLevels: stockLevelsObject,
        consumptionMonths: productToEdit?.consumptionMonths ?? 0,
      });
    }
  }, [open, productToEdit, sortedKiosks, form]);


  const categoryWatch = form.watch('category');
  const unitWatch = form.watch('unit');
  const classificationWatch = form.watch('classification');
  const costWatch = form.watch('initialCostPerUnit');
  const classificationName = useMemo(
    () => classifications.find((c) => c.id === classificationWatch)?.name,
    [classifications, classificationWatch],
  );

  const handleCategoryChange = (value: UnitCategory) => {
      form.setValue('category', value);
      const availableUnits = Object.keys(units[value]);
      form.setValue('unit', availableUnits[0] || '');
  };

  const onSubmit = (values: BaseProductFormValues) => {
    const finalClassification = values.classification === 'none' ? '' : values.classification;

    const dataPayload: Partial<BaseProduct> = {
      name: normalizeBaseProductName(values.name),
      classification: finalClassification,
      category: values.category,
      unit: values.unit,
      stockLevels: values.stockLevels,
      consumptionMonths: values.consumptionMonths,
      initialCostPerUnit: values.initialCostPerUnit,
    };

    if (productToEdit) {
      updateBaseProduct({ ...productToEdit, ...dataPayload });
    } else {
      addBaseProduct(dataPayload as Omit<BaseProduct, 'id'>);
    }
    onOpenChange(false);
  };

  const handleNext = async () => {
    const valid = await form.trigger(['name', 'category', 'unit']);
    if (valid) setCurrentStep((s) => Math.min(WIZARD_STEPS.length, s + 1));
  };
  const handleBack = () => setCurrentStep((s) => Math.max(1, s - 1));
  const onInvalid = () => {
    setCurrentStep(1);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] sm:max-w-5xl p-0 gap-0 overflow-hidden">
          {/* Header */}
          <DialogHeader className="space-y-2 border-b px-6 py-4 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                {categoryWatch} · {unitWatch}
              </span>
              {classificationName && (
                <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700">
                  {classificationName}
                </span>
              )}
              {productToEdit && (
                <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  <Link2 className="h-3 w-3" />
                  {derivedCount} derivado{derivedCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <DialogTitle className="text-2xl font-bold">{productToEdit ? 'Editar insumo base' : 'Novo insumo base'}</DialogTitle>
            <DialogDescription className="text-sm">Produto-tipo · referência medida em {unitWatch}</DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit, onInvalid)}>
              <div className="grid grid-cols-1 md:grid-cols-[260px_1fr]">
                {/* Stepper */}
                <aside className="border-r bg-muted/40 px-5 py-6">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Etapa {currentStep} de {WIZARD_STEPS.length}</p>
                  <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${(currentStep / WIZARD_STEPS.length) * 100}%` }} />
                  </div>
                  <nav className="space-y-1">
                    {WIZARD_STEPS.map((step) => {
                      const isActive = step.id === currentStep;
                      const isDone = step.id < currentStep;
                      return (
                        <button
                          key={step.id}
                          type="button"
                          onClick={() => setCurrentStep(step.id)}
                          className={cn('flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors', isActive ? 'font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted')}
                        >
                          <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', isActive ? 'bg-indigo-500 text-white' : isDone ? 'bg-indigo-100 text-indigo-600' : 'bg-muted text-muted-foreground')}>
                            {isDone ? <Check className="h-4 w-4" /> : step.id}
                          </span>
                          <span className="truncate">{step.label}</span>
                        </button>
                      );
                    })}
                  </nav>
                  <div className="mt-8 rounded-lg border bg-background/60 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold"><Package className="h-3.5 w-3.5" /> Produto-tipo</p>
                    <p className="mt-1 text-xs text-muted-foreground">O insumo base é o conceito genérico. Marcas, tamanhos e embalagens ficam nos insumos derivados vinculados a ele.</p>
                  </div>
                </aside>

                {/* Content */}
                <ScrollArea className="h-[62vh]">
                  <div className="px-6 py-6">
                    <div className="mb-5 flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
                        {React.createElement(WIZARD_STEPS[currentStep - 1].icon, { className: 'h-4 w-4' })}
                      </div>
                      <div>
                        <h3 className="font-semibold leading-tight">{WIZARD_STEPS[currentStep - 1].label}</h3>
                        <p className="text-sm text-muted-foreground">{WIZARD_STEPS[currentStep - 1].description}</p>
                      </div>
                    </div>

                    {/* STEP 1 */}
                    {currentStep === 1 && (
                      <div className="space-y-5">
                        <FormField control={form.control} name="name" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Nome do produto base <span className="text-rose-500">*</span></FormLabel>
                            <FormControl>
                              <Input placeholder="EX: OVOMALTINE (PÓ)" {...field} onChange={(event) => field.onChange(event.target.value.toLocaleUpperCase('pt-BR'))} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}/>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <FormField control={form.control} name="classification" render={({ field }) => (
                            <FormItem>
                              <div className="flex items-center justify-between">
                                <FormLabel>Classificação</FormLabel>
                                <span className="text-xs text-muted-foreground">opcional</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Select onValueChange={field.onChange} value={field.value} disabled={loadingClassifications}>
                                  <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                                  <SelectContent>
                                    <SelectItem value="none">Nenhuma</SelectItem>
                                    {classifications.map(c => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                                  </SelectContent>
                                </Select>
                                <Button type="button" variant="outline" size="icon" onClick={() => setIsClassificationModalOpen(true)}><Settings className="h-4 w-4" /></Button>
                              </div>
                              <FormMessage />
                            </FormItem>
                          )}/>
                          <FormField control={form.control} name="consumptionMonths" render={({ field }) => (
                            <FormItem>
                              <div className="flex items-center justify-between">
                                <FormLabel className="flex items-center gap-1.5"><Calendar className="h-4 w-4 text-muted-foreground"/> Sugerir pedido para</FormLabel>
                                <span className="text-xs text-muted-foreground">meses de histórico</span>
                              </div>
                              <FormControl><Input type="number" placeholder="Ex: 2" {...field} value={field.value ?? ''} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}/>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <FormField control={form.control} name="category" render={({ field }) => (
                            <FormItem>
                              <div className="flex items-center justify-between">
                                <FormLabel>Categoria da unidade <span className="text-rose-500">*</span></FormLabel>
                                <span className="text-xs text-muted-foreground">controla as unidades</span>
                              </div>
                              <Select onValueChange={(value) => handleCategoryChange(value as UnitCategory)} value={field.value}>
                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>{unitCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}/>
                          <FormField control={form.control} name="unit" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Unidade de medida padrão <span className="text-rose-500">*</span></FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>{Object.keys(units[categoryWatch] || {}).map(u => (<SelectItem key={u} value={u}>{u}</SelectItem>))}</SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}/>
                        </div>

                        {/* Callout unidade de referência */}
                        <div className="rounded-xl bg-zinc-900 p-4 text-zinc-100">
                          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">Unidade de referência</p>
                          <p className="text-xs leading-relaxed text-zinc-300">
                            Todo o estoque, custo e conversões deste insumo usam <span className="font-bold text-white">{unitWatch}</span> como medida comum. Cada derivado informa quantos <span className="font-bold text-white">{unitWatch}</span> cabem na sua embalagem.
                          </p>
                        </div>

                        {/* Custo por unidade (AUTO) */}
                        <FormField control={form.control} name="initialCostPerUnit" render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center gap-2">
                              <FormLabel>Custo por unidade</FormLabel>
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Auto</span>
                            </div>
                            <div className="relative">
                              <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                              <Input type="number" readOnly disabled className="bg-muted/60 pl-8 pr-10" {...field} value={field.value ?? ''} />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">/{unitWatch}</span>
                            </div>
                            <FormDescription className="text-xs">Definido automaticamente na confirmação da compra.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}/>
                      </div>
                    )}

                    {/* STEP 2 */}
                    {currentStep === 2 && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                            {sortedKiosks.length} loca{sortedKiosks.length === 1 ? 'l' : 'is'}
                          </span>
                        </div>
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Quiosque</TableHead>
                                <TableHead className="text-center">Est. mínimo</TableHead>
                                <TableHead className="text-center">Est. segurança</TableHead>
                                <TableHead className="text-center">Lead time (dias)</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {sortedKiosks.map((kiosk) => (
                                <TableRow key={kiosk.id}>
                                  <TableCell className="font-medium">{kiosk.name}</TableCell>
                                  <TableCell>
                                    <FormField control={form.control} name={`stockLevels.${kiosk.id}.min`} render={({ field }) => (
                                      <FormItem><FormControl><Input type="number" className="w-full text-right" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                                    )}/>
                                  </TableCell>
                                  <TableCell>
                                    <FormField control={form.control} name={`stockLevels.${kiosk.id}.safetyStock`} render={({ field }) => (
                                      <FormItem><FormControl><Input type="number" className="w-full text-right" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                                    )}/>
                                  </TableCell>
                                  <TableCell>
                                    <FormField control={form.control} name={`stockLevels.${kiosk.id}.leadTime`} render={({ field }) => (
                                      <FormItem><FormControl><Input type="number" className="w-full text-right" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                                    )}/>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          O alerta de reposição dispara quando o estoque atinge <span className="font-medium text-foreground">mínimo + segurança</span> (em {unitWatch}). O <span className="font-medium text-foreground">lead time</span> antecipa o pedido conforme o prazo de entrega. Deixe <span className="font-medium text-foreground">0</span> nos quiosques que não controlam este insumo.
                        </p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>

              {/* Footer */}
              <DialogFooter className="flex flex-row items-center justify-between gap-4 border-t px-6 py-4 sm:justify-between">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                <div className="hidden flex-col items-center text-center sm:flex">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Etapa {currentStep} de {WIZARD_STEPS.length}</span>
                  <span className="text-sm font-medium">{WIZARD_STEPS[currentStep - 1].label}</span>
                </div>
                <div className="flex items-center gap-2">
                  {currentStep > 1 && (<Button type="button" variant="outline" onClick={handleBack}><ChevronLeft className="mr-1 h-4 w-4" /> Voltar</Button>)}
                  {currentStep < WIZARD_STEPS.length ? (
                    <Button type="button" className="bg-indigo-500 hover:bg-indigo-600" onClick={handleNext}>Avançar <ChevronRight className="ml-1 h-4 w-4" /></Button>
                  ) : (
                    <Button type="submit" className="bg-indigo-500 hover:bg-indigo-600">{productToEdit ? 'Salvar alterações' : 'Adicionar produto'}</Button>
                  )}
                </div>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
       <ClassificationManagementModal open={isClassificationModalOpen} onOpenChange={setIsClassificationModalOpen} />
    </>
  );
}
