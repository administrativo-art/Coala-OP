
"use client"

import React, { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { useBaseProducts } from '@/hooks/use-base-products';
import { useKiosks } from '@/hooks/use-kiosks';
import { useProducts } from '@/hooks/use-products';
import { units, unitCategories, type UnitCategory } from '@/lib/conversion';
import { type BaseProduct, type BaseProductStockLevel } from '@/types';
import { cn } from '@/lib/utils';
import { ClassificationManagementModal } from './classification-management-modal';
import { useClassifications } from '@/hooks/use-classifications';
import { useAuth } from '@/hooks/use-auth';
import { canAccessUnit } from '@/lib/unit-access';
import { useReplenishmentPolicy } from '@/hooks/use-replenishment-policy';
import { useAuthenticatedApi } from '@/hooks/use-authenticated-api';
import { getUnitsPerPackageForProduct, operationalMinimum, previewMinimum } from '@/lib/replenishment-display';
import { useDP } from '@/components/dp-context';

const stockLevelSchema = z.object({
    min: z.coerce.number().min(0, "Deve ser um valor positivo.").optional(),
    safetyStock: z.coerce.number().min(0, "Deve ser um valor positivo.").optional(),
    leadTime: z.coerce.number().min(0, "Deve ser um valor positivo.").optional(),
    override: z.boolean(),
    supplyMode: z.enum(['cd', 'direct']).optional(),
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
  minStockRecalcPeriod: z.enum(['monthly', 'biweekly']).default('monthly'),
});


type BaseProductFormValues = z.infer<typeof baseProductSchema>;

interface AddEditBaseProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productToEditId: string | null;
}

const WIZARD_STEPS = [
    { id: 1, label: 'Identificação e medida', description: 'Nome canônico, classificação e a unidade de referência de todo o insumo.' },
    { id: 2, label: 'Parâmetros por quiosque', description: 'Controle de estoque por local. Cada quiosque pode ter limites próprios.' },
] as const;

// Massa antes de Volume, como no design; o conjunto continua vindo de unitCategories.
const CATEGORY_ORDER: readonly UnitCategory[] = [...unitCategories].sort((a, b) => (a === 'Massa' ? -1 : b === 'Massa' ? 1 : 0));
const CATEGORY_SYMBOLS: Record<UnitCategory, string> = { Massa: 'kg', Volume: 'l', Unidade: 'un', Embalagem: 'cx', Vestimenta: 'pç' };
const UNIT_NAMES: Record<string, string> = { un: 'unidade', kg: 'quilograma', g: 'grama', mg: 'miligrama', l: 'litro', ml: 'mililitro', bag: 'bag', pacote: 'pacote', caixa: 'caixa', peça: 'peça' };
const UNIT_SYMBOLS: Record<string, string> = { pacote: 'pct', caixa: 'cx', peça: 'pç' };
const COLLAPSED_DERIVED = 3;

const costFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 3 });

export function AddEditBaseProductModal({ open, onOpenChange, productToEditId }: AddEditBaseProductModalProps) {
  const { baseProducts, addBaseProduct } = useBaseProducts();
  const api = useAuthenticatedApi();
  const { classifications, loading: loadingClassifications } = useClassifications();
  const { kiosks } = useKiosks();
  const { products } = useProducts();
  const { user, isDefaultAdmin } = useAuth();
  const { enabled: policyEnabled, loading: policyLoading, error: policyError } = useReplenishmentPolicy();
  const { units: operationalUnits } = useDP();
  const [isClassificationModalOpen, setIsClassificationModalOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [derivedExpanded, setDerivedExpanded] = useState(false);
  const [showHow, setShowHow] = useState(false);

  const productToEdit = useMemo(() => {
    if (!productToEditId) return null;
    return baseProducts.find(p => p.id === productToEditId) || null;
  }, [productToEditId, baseProducts]);

  const derivedProducts = useMemo(
    () => (productToEditId ? products.filter((p) => p.baseProductId === productToEditId && !p.isArchived) : []),
    [products, productToEditId],
  );
  const derivedCount = derivedProducts.length;

  const sortedKiosks = useMemo(() => {
    return kiosks.filter(kiosk => user && canAccessUnit(user, kiosk.id, { isDefaultAdmin })).sort((a,b) => {
        if (a.id === 'matriz') return -1;
        if (b.id === 'matriz') return 1;
        return a.name.localeCompare(b.name);
    });
  }, [kiosks, user, isDefaultAdmin]);

  const form = useForm<BaseProductFormValues>({
    resolver: zodResolver(baseProductSchema),
    defaultValues: { name: '', classification: '', category: 'Massa', unit: 'g', initialCostPerUnit: 0, stockLevels: {}, consumptionMonths: 0, minStockRecalcPeriod: 'monthly' }
  });

  useEffect(() => {
    if (open) { setCurrentStep(1); setSaveError(''); setDerivedExpanded(false); setShowHow(false); }
  }, [open, productToEditId]);

  useEffect(() => {
    if (open) {
      const stockLevelsObject: Record<string, any> = {};
      sortedKiosks.forEach(kiosk => {
        const level = productToEdit?.stockLevels?.[kiosk.id];
        stockLevelsObject[kiosk.id] = {
            min: level?.min ?? 0,
            safetyStock: level?.safetyStock ?? 0,
            leadTime: level?.leadTime ?? 0,
            override: level?.override ?? false,
            supplyMode: level?.supplyMode ?? 'cd',
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
        minStockRecalcPeriod: productToEdit?.minStockRecalcPeriod ?? 'monthly',
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

  const onSubmit = async (values: BaseProductFormValues) => {
    if (policyEnabled === null) {
      setSaveError('Política de reposição indisponível. Confira a conexão antes de salvar.');
      return;
    }
    const finalClassification = values.classification === 'none' ? '' : values.classification;

    const stockLevels: Record<string, BaseProductStockLevel> = {};
    for (const [kioskId, level] of Object.entries(values.stockLevels ?? {})) {
      const previous = productToEdit?.stockLevels?.[kioskId];
      const role = operationalUnits.find(unit => unit.externalSource === 'kiosk' && unit.externalId === kioskId)?.stockRole;
      const mode = role === 'supply' ? 'cd' : level.supplyMode ?? previous?.supplyMode ?? 'cd';
      if (mode === 'direct' && (!level.leadTime || level.leadTime <= 0)) {
        form.setError(`stockLevels.${kioskId}.leadTime`, { message: 'Compra direta exige prazo local maior que zero.' });
        setCurrentStep(2);
        return;
      }
      stockLevels[kioskId] = {
        ...previous,
        ...(policyEnabled ? {} : { min: level.min, safetyStock: level.safetyStock, override: level.override }),
        supplyMode: mode,
        leadTime: policyEnabled && mode === 'cd' && role !== 'supply' ? 2 : level.leadTime,
        override: policyEnabled ? false : level.override,
      };
    }

    const dataPayload: Partial<BaseProduct> = {
      name: normalizeBaseProductName(values.name),
      classification: finalClassification,
      category: values.category,
      unit: values.unit,
      stockLevels,
      ...(policyEnabled ? {} : { consumptionMonths: values.consumptionMonths }),
      minStockRecalcPeriod: values.minStockRecalcPeriod,
      initialCostPerUnit: values.initialCostPerUnit,
    };

    setSaving(true);
    setSaveError('');
    try {
      if (productToEdit) {
        const result = await api<{ ok: boolean; recalculation?: { status: 'pending' } }>(`/api/registry/base-products/${productToEdit.id}`, {
          method: 'PATCH', json: dataPayload, fallbackError: 'Não foi possível atualizar o insumo.',
        });
        if (result.recalculation?.status === 'pending') {
          setSaveError('Configuração salva. O recálculo ainda está pendente; confira o estado antes de usar a sugestão.');
          return;
        }
      } else {
        await addBaseProduct(dataPayload as Omit<BaseProduct, 'id'>);
      }
      onOpenChange(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Não foi possível salvar o insumo.');
    } finally {
      setSaving(false);
    }
  };

  const handleNext = async () => {
    const valid = await form.trigger(['name', 'category', 'unit']);
    if (valid) setCurrentStep((s) => Math.min(WIZARD_STEPS.length, s + 1));
  };
  const handleBack = () => setCurrentStep((s) => Math.max(1, s - 1));
  const onInvalid = () => {
    setCurrentStep(1);
  };
  const saveNow = () => { void form.handleSubmit(onSubmit, onInvalid)(); };
  // Enter na etapa 1 avança o assistente; salvar exige o botão da etapa ou a etapa final.
  const handleWizardSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (currentStep < WIZARD_STEPS.length) void handleNext();
    else saveNow();
  };

  const nameWatch = form.watch('name') ?? '';
  const heroName = nameWatch.trim() || 'Sem nome';
  const unitSymbol = UNIT_SYMBOLS[unitWatch] ?? unitWatch;
  const unitFullName = UNIT_NAMES[unitWatch] ?? unitWatch;
  const unitChanged = !!productToEdit && derivedCount > 0 && unitWatch !== productToEdit.unit;
  const costLabel = productToEdit && Number(costWatch) > 0 ? costFormatter.format(Number(costWatch)) : 'R$ —';
  const derivedRows = useMemo(() => {
    const base = { unit: unitWatch } as BaseProduct;
    return derivedProducts.map((p) => {
      const amount = getUnitsPerPackageForProduct(p, base);
      return { id: p.id, name: [p.baseName, p.brand].filter(Boolean).join(' · '), amount, label: amount > 0 ? `${amount} ${unitWatch}` : 'Revisar' };
    });
  }, [derivedProducts, unitWatch]);
  const derivedRange = useMemo(() => {
    const amounts = derivedRows.map((r) => r.amount).filter((a) => a > 0);
    if (unitChanged || amounts.length === 0) return 'quantidades a revisar';
    return `de ${Math.min(...amounts)} a ${Math.max(...amounts)} ${unitWatch} por embalagem`;
  }, [derivedRows, unitChanged, unitWatch]);
  const visibleDerived = derivedExpanded ? derivedRows : derivedRows.slice(0, COLLAPSED_DERIVED);
  const period = form.watch('minStockRecalcPeriod');
  const leadErrors = form.formState.errors.stockLevels as Record<string, { leadTime?: { message?: string } } | undefined> | undefined;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent hideClose className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] gap-0 overflow-y-auto overflow-x-hidden rounded-[26px] border-0 bg-[#faf9f6] p-0 sm:w-[calc(100vw-2rem)] sm:p-0 sm:max-w-[1080px] sm:rounded-[26px]">
          <Form {...form}>
            <form className="grid min-h-0 grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)]" onSubmit={handleWizardSubmit}>
              {/* Painel escuro: o insumo ao vivo */}
              <aside className="flex flex-col gap-7 bg-[#15151c] px-6 py-7 text-[#f3f2ee] sm:px-[30px] sm:py-8">
                <div className="flex flex-col gap-3">
                  <DialogDescription className="text-[10.5px] font-extrabold uppercase tracking-[.16em] text-[#8e8d99]">
                    {productToEdit ? 'Insumo base · editando' : 'Novo insumo base'}
                  </DialogDescription>
                  <DialogTitle className={cn('break-words font-extrabold leading-none tracking-[-.035em]', currentStep === 1 && nameWatch.trim().length <= 18 ? 'text-[40px]' : 'text-[30px]', nameWatch.trim() ? 'text-[#f3f2ee]' : 'text-[#5d5c68]')}>
                    {heroName}
                  </DialogTitle>
                  <div className="flex flex-wrap gap-1.5">
                    {classificationName && <span className="whitespace-nowrap rounded-full bg-[rgba(185,185,255,.14)] px-2.5 py-[3px] text-[11.5px] font-bold text-[#d4d4ff]">{classificationName}</span>}
                    {currentStep === 1 && productToEdit && <span className="whitespace-nowrap rounded-full border border-white/15 px-2.5 py-0.5 text-[11.5px] font-semibold text-[#c8c7d0]">{derivedCount} derivado{derivedCount === 1 ? '' : 's'}</span>}
                    {currentStep === 2 && <span className="whitespace-nowrap rounded-full border border-white/15 px-2.5 py-0.5 text-[11.5px] font-semibold text-[#c8c7d0]">medido em {unitWatch}</span>}
                  </div>
                </div>

                {currentStep === 1 && (
                  <>
                    <div className="flex flex-col gap-2.5">
                      <Eyebrow>Unidade de referência</Eyebrow>
                      <div className="flex items-center gap-[18px]">
                        <div className="flex h-[120px] w-[120px] shrink-0 items-center justify-center rounded-3xl border border-[rgba(185,185,255,.28)] bg-[rgba(185,185,255,.12)]">
                          <span className="text-[56px] font-extrabold leading-none tracking-[-.05em] text-[#b9b9ff]">{unitSymbol}</span>
                        </div>
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="break-words text-[22px] font-extrabold tracking-[-.02em] text-white">{unitFullName}</span>
                          <span className="text-xs text-[#8e8d99]">no sistema: <b className="font-bold text-[#c8c7d0]">{unitWatch}</b></span>
                        </div>
                      </div>
                      <p className="mt-1.5 text-[13px] leading-[1.55] text-[#c8c7d0]">
                        Todo o estoque, custo e conversões deste insumo usam <b className="text-white">{unitWatch}</b> como medida comum. Cada derivado informa quantos <b className="text-white">{unitWatch}</b> cabem na sua embalagem.
                      </p>
                    </div>

                    {!productToEdit && (
                      <div className="rounded-[14px] border border-dashed border-white/20 px-4 py-3.5 text-[12.5px] leading-normal text-[#a3a2ad]">
                        Nenhum derivado ainda. Depois de salvar, vincule marcas, tamanhos e embalagens a este insumo.
                      </div>
                    )}
                    {productToEdit && (
                      <div className="flex flex-col overflow-hidden rounded-[14px] border border-white/10 bg-white/5">
                        <div className="flex items-baseline justify-between gap-3 px-4 pb-2 pt-3">
                          <Eyebrow>{derivedCount} derivado{derivedCount === 1 ? '' : 's'} vinculado{derivedCount === 1 ? '' : 's'}</Eyebrow>
                          {derivedCount > 0 && <span className="whitespace-nowrap text-[11px] text-[#8e8d99]">{derivedRange}</span>}
                        </div>
                        <div className={cn(derivedExpanded && 'max-h-[236px] overflow-y-auto')}>
                          {visibleDerived.map((d) => (
                            <div key={d.id} className="flex items-center justify-between gap-3 border-t border-white/5 px-4 py-[9px]">
                              <span className="min-w-0 truncate text-[13px] font-semibold text-[#e7e6ee]">{d.name}</span>
                              <span className={cn('whitespace-nowrap font-mono text-[13px] font-bold', unitChanged || d.amount <= 0 ? 'text-[#f5c26b]' : 'text-[#b9b9ff]')}>{unitChanged ? 'Revisar' : d.label}</span>
                            </div>
                          ))}
                        </div>
                        {derivedCount > COLLAPSED_DERIVED && (
                          <button type="button" onClick={() => setDerivedExpanded((v) => !v)} className="border-t border-white/5 px-4 py-2.5 text-left text-[12.5px] font-bold text-[#b9b9ff]">
                            {derivedExpanded ? 'Mostrar menos' : `Ver todos os ${derivedCount}`}
                          </button>
                        )}
                      </div>
                    )}

                    <div className="mt-auto flex flex-col gap-1.5 border-t border-white/10 pt-[22px]">
                      <Eyebrow>Custo por {unitWatch} · auto</Eyebrow>
                      <span className="whitespace-nowrap font-mono text-[34px] font-bold tracking-[-.03em]">{costLabel}<span className="text-[15px] text-[#8e8d99]"> /{unitWatch}</span></span>
                      <span className="text-xs text-[#a3a2ad]">Definido automaticamente na confirmação da compra.</span>
                    </div>
                  </>
                )}

                {currentStep === 2 && (
                  <>
                    <div className="flex flex-col gap-2.5">
                      <Eyebrow>Política de reposição</Eyebrow>
                      {policyEnabled === true && (
                        <div className="flex flex-col gap-1.5 rounded-xl border border-[rgba(155,231,181,.22)] bg-[rgba(155,231,181,.1)] px-3.5 py-3">
                          <span className="flex items-center gap-[7px] text-[12.5px] font-extrabold text-[#9be7b5]"><span className="h-[7px] w-[7px] rounded-full bg-[#9be7b5]" />Ativa · mínimo sempre automático</span>
                          <span className="text-[12.5px] leading-normal text-[#c8c7d0]">Meta automática: média diária × {period === 'monthly' ? '30' : '15'} dias × 1,3. A margem de 30% entra uma vez. Prazo de entrega e validade são informações separadas.</span>
                        </div>
                      )}
                      {policyEnabled === false && (
                        <div className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
                          <span className="flex items-center gap-[7px] text-[12.5px] font-extrabold text-[#e7e6ee]"><span className="h-[7px] w-[7px] rounded-full bg-[#a3a2ad]" />Regra legada</span>
                          <span className="text-[12.5px] leading-normal text-[#c8c7d0]">O mínimo operacional ainda usa a regra legada. A prévia da nova política aparece por unidade para comparação e não determina pedidos.</span>
                        </div>
                      )}
                      {policyEnabled === null && (
                        <div role="status" className="flex flex-col gap-1.5 rounded-xl border border-[rgba(245,194,107,.35)] bg-[rgba(245,194,107,.12)] px-3.5 py-3">
                          <span className="flex items-center gap-[7px] text-[12.5px] font-extrabold text-[#f5c26b]"><span className="h-[7px] w-[7px] rounded-full bg-[#f5c26b]" />{policyError ? 'Indisponível' : 'Consultando'}</span>
                          <span className="text-[12.5px] leading-normal text-[#e9d9b8]">{policyError ? 'Política de reposição indisponível. Confira a conexão antes de alterar parâmetros.' : 'Consultando a política de reposição…'}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2.5">
                      <Eyebrow>Base do estoque mínimo automático</Eyebrow>
                      <FormField control={form.control} name="minStockRecalcPeriod" render={({ field }) => (
                        <FormItem className="space-y-0">
                          <div role="radiogroup" aria-label="Base do estoque mínimo automático" className="flex gap-1 rounded-xl bg-white/[.07] p-1">
                            {([['monthly', 'Mensal'], ['biweekly', 'Quinzenal']] as const).map(([value, label]) => (
                              <button key={value} type="button" role="radio" aria-checked={field.value === value} onClick={() => field.onChange(value)}
                                className={cn('h-[34px] flex-1 rounded-lg text-xs font-bold', field.value === value ? 'bg-[#f3f2ee] text-[#15151c]' : 'text-[#a3a2ad]')}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </FormItem>
                      )}/>
                      <span className="text-[12.5px] leading-normal text-[#a3a2ad]">Média diária dos 180 dias completos anteriores × {period === 'monthly' ? '30' : '15'} dias.</span>
                      <button type="button" onClick={() => setShowHow((v) => !v)} aria-expanded={showHow} className="self-start text-[12.5px] font-bold text-[#b9b9ff]">{showHow ? 'Ocultar detalhes' : 'Como é calculado?'}</button>
                      {showHow && (
                        <ul className="flex list-disc flex-col gap-1.5 rounded-xl bg-white/5 py-3 pl-7 pr-3.5 text-xs leading-[1.55] text-[#c8c7d0]">
                          <li>Com a política ativa, a meta usa média diária dos 180 dias completos anteriores × 30 dias (mensal) ou 15 dias (quinzenal) × 1,3. O mínimo é sempre automático.</li>
                          <li>Consumo interno do PDV é a fonte principal; transferências podem aparecer como aproximação de abastecimento. Dados incompletos deixam o cálculo pendente.</li>
                          <li>O CD considera somente unidades que recebem dele. Compra direta usa prazo próprio da unidade; rota via CD usa prazo operacional de dois dias na unidade comercial.</li>
                        </ul>
                      )}
                    </div>

                    {policyEnabled === true && (
                      <div className="flex flex-col gap-1.5">
                        <Eyebrow>Sugerir pedido para</Eyebrow>
                        <span className="text-[12.5px] leading-normal text-[#a3a2ad]">Usado só na regra legada. Com a política ativa, a sugestão segue a meta automática.</span>
                      </div>
                    )}
                    {policyEnabled === false && (
                      <FormField control={form.control} name="consumptionMonths" render={({ field }) => {
                        const months = Number(field.value) || 0;
                        return (
                          <FormItem className="flex flex-col gap-2.5 space-y-0">
                            <Eyebrow>Sugerir pedido para</Eyebrow>
                            <div className="flex items-center gap-3.5">
                              <button type="button" aria-label="Diminuir meses de histórico" onClick={() => field.onChange(Math.max(0, months - 1))} className="h-10 w-10 rounded-full border border-white/20 text-lg">−</button>
                              <span aria-live="polite" className="min-w-[44px] text-center font-mono text-[40px] font-bold leading-none tracking-[-.03em]">{months}</span>
                              <button type="button" aria-label="Aumentar meses de histórico" onClick={() => field.onChange(months + 1)} className="h-10 w-10 rounded-full border border-white/20 text-lg">+</button>
                              <span className="text-[13px] text-[#c8c7d0]">meses de histórico</span>
                            </div>
                            <FormMessage />
                          </FormItem>
                        );
                      }}/>
                    )}

                    <p className="mt-auto border-t border-white/10 pt-5 text-[12.5px] leading-[1.55] text-[#a3a2ad]">
                      {policyEnabled === true
                        ? 'Compra a caminho aparece como aviso e não reduz a falta física. O prazo de compra direta deve ser positivo no local; via CD, a unidade comercial usa dois dias. A validade continua por lote.'
                        : 'Enquanto a política nova está desativada, mínimo manual, estoque de segurança e meses para sugerir pedido pertencem ao motor legado. A prévia não altera o mínimo operacional.'}
                    </p>
                  </>
                )}
              </aside>

              {/* Conteúdo da etapa */}
              <div className="flex min-w-0 flex-col gap-6 px-5 pb-6 pt-7 sm:px-[34px] sm:pb-[26px]">
                <div className="flex items-start gap-5">
                  <ol className="grid flex-1 grid-cols-2 gap-3.5">
                    {WIZARD_STEPS.map((step) => {
                      const isActive = step.id === currentStep;
                      const isDone = step.id < currentStep;
                      return (
                        <li key={step.id}>
                          <button type="button" aria-current={isActive ? 'step' : undefined} onClick={() => (step.id === 1 ? setCurrentStep(1) : void handleNext())} className="flex w-full flex-col gap-2 text-left">
                            <span className={cn('h-1 w-full rounded-[9px]', isActive || isDone ? 'bg-[#5b5bd6]' : 'bg-[#e3e0d8]')} />
                            <span className={cn('text-[12.5px]', isActive ? 'font-bold text-[#1a1b1f]' : 'font-semibold text-[#8a8f99]')}>
                              <span className="text-[#5b5bd6]">{isDone ? '✓' : `0${step.id}`}</span> {step.label}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                  <button type="button" aria-label="Fechar" onClick={() => onOpenChange(false)} className="-mt-2 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[#efede7] text-lg text-[#4a4f57]">×</button>
                </div>

                <p className="text-[13px] text-[#70757d]">{WIZARD_STEPS[currentStep - 1].description}</p>

                {currentStep === 1 && (
                  <div className="flex flex-1 flex-col gap-6">
                    <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem className="flex flex-col gap-1.5 space-y-0">
                        <Eyebrow light>Nome do produto base <span className="text-[#e11d48]">*</span></Eyebrow>
                        <FormControl>
                          <input
                            placeholder="EX: OVOMALTINE (PÓ)"
                            autoComplete="off"
                            {...field}
                            onChange={(event) => field.onChange(event.target.value.toLocaleUpperCase('pt-BR'))}
                            className={cn('border-0 border-b-2 bg-transparent pb-2 pt-1 text-[28px] font-extrabold tracking-[-.02em] text-[#15151c] outline-none placeholder:text-[#c9c6bd]', form.formState.errors.name ? 'border-[#e11d48]' : 'border-[#15151c]')}
                          />
                        </FormControl>
                        <FormMessage className="text-xs font-semibold text-[#e11d48]" />
                        <span className="text-xs leading-[1.45] text-[#70757d]">O insumo base é o conceito genérico. Marcas, tamanhos e embalagens ficam nos insumos derivados vinculados a ele.</span>
                      </FormItem>
                    )}/>

                    <FormField control={form.control} name="classification" render={({ field }) => (
                      <FormItem className="flex flex-col gap-2 space-y-0">
                        <div className="flex items-baseline justify-between">
                          <Eyebrow light>Classificação <span className="font-medium normal-case tracking-normal">· opcional</span></Eyebrow>
                          <button type="button" onClick={() => setIsClassificationModalOpen(true)} className="text-xs font-bold text-[#5b5bd6] hover:text-[#4646b8]">Gerenciar</button>
                        </div>
                        <Select onValueChange={field.onChange} value={field.value} disabled={loadingClassifications}>
                          <FormControl><SelectTrigger className="h-[46px] rounded-xl border-[#dcd9d1] bg-white px-4 text-sm font-semibold"><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="none">Nenhuma</SelectItem>
                            {classifications.map(c => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}/>

                    <FormField control={form.control} name="category" render={({ field }) => (
                      <FormItem className="flex flex-col gap-2.5 space-y-0">
                        <Eyebrow light>Categoria da unidade <span className="text-[#e11d48]">*</span> <span className="font-medium normal-case tracking-normal">· controla as unidades</span></Eyebrow>
                        <div role="radiogroup" aria-label="Categoria da unidade" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                          {CATEGORY_ORDER.map((cat) => {
                            const active = field.value === cat;
                            return (
                              <button key={cat} type="button" role="radio" aria-checked={active} onClick={() => handleCategoryChange(cat)}
                                className={cn('flex h-[92px] min-w-0 flex-col justify-between rounded-[14px] border p-3 text-left', active ? 'border-[#15151c] bg-[#15151c] text-[#f3f2ee] shadow-[0_10px_24px_rgba(21,21,28,.18)]' : 'border-[#e0ddd5] bg-white text-[#1a1b1f]')}>
                                <span className={cn('text-[26px] font-extrabold leading-none tracking-[-.03em]', active ? 'text-[#b9b9ff]' : 'text-[#1a1b1f]')}>{CATEGORY_SYMBOLS[cat]}</span>
                                <span className="max-w-full truncate text-[12.5px] font-bold">{cat}</span>
                              </button>
                            );
                          })}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}/>

                    <FormField control={form.control} name="unit" render={({ field }) => (
                      <FormItem className="flex flex-wrap items-center gap-3.5 space-y-0">
                        <Eyebrow light>Unidade de medida padrão <span className="text-[#e11d48]">*</span></Eyebrow>
                        <div role="radiogroup" aria-label="Unidade de medida padrão" className="flex flex-wrap gap-2">
                          {Object.keys(units[categoryWatch] || {}).map((u) => {
                            const active = field.value === u;
                            return (
                              <button key={u} type="button" role="radio" aria-checked={active} onClick={() => field.onChange(u)}
                                className={cn('h-10 min-w-16 rounded-full px-[18px] text-sm font-bold', active ? 'border-2 border-[#5b5bd6] bg-[#eeeefc] text-[#3f3fb0]' : 'border border-[#dcd9d1] bg-white text-[#4a4f57]')}>
                                {u}
                              </button>
                            );
                          })}
                        </div>
                        <FormMessage className="basis-full" />
                      </FormItem>
                    )}/>

                    {unitChanged && productToEdit && (
                      <div role="status" className="rounded-xl border border-[#f5d9a3] bg-[#fff7e6] px-3.5 py-[11px] text-[12.5px] leading-[1.45] text-[#8a5a00]">
                        A unidade original era <b>{productToEdit.unit}</b>. Os {derivedCount} derivados vinculados vão precisar ter a quantidade por embalagem revisada.
                      </div>
                    )}
                  </div>
                )}

                {currentStep === 2 && (
                  <div className="flex flex-1 flex-col gap-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs font-bold text-[#4a4f57]">{sortedKiosks.length} loca{sortedKiosks.length === 1 ? 'l' : 'is'} com acesso</span>
                    </div>
                    <div className="flex flex-col gap-2.5">
                      {sortedKiosks.map((kiosk) => {
                        const autoCalc = productToEdit?.stockLevels?.[kiosk.id];
                        const lastAutoCalculatedAt = autoCalc?.lastAutoCalculatedAt;
                        const manualMin = form.watch(`stockLevels.${kiosk.id}.override`) === true;
                        const minimum = operationalMinimum(autoCalc, policyEnabled === true);
                        const preview = productToEdit ? previewMinimum(productToEdit, kiosk.id, policyEnabled === true) : null;
                        const mode = form.watch(`stockLevels.${kiosk.id}.supplyMode`) ?? 'cd';
                        const role = operationalUnits.find(unit => unit.externalSource === 'kiosk' && unit.externalId === kiosk.id)?.stockRole;
                        const isSupply = role === 'supply';
                        const leadLocked = policyEnabled === true && !isSupply && mode === 'cd';
                        const leadError = leadErrors?.[kiosk.id]?.leadTime?.message;
                        const sourceLine = policyEnabled === true
                          ? [minimum.sourceLabel, minimum.limitation].filter(Boolean).join(' · ')
                          : preview ? `Prévia nova política: ${preview.minimum === null ? preview.label : `${preview.minimum} ${unitWatch}`}${preview.sourceLabel ? ` · ${preview.sourceLabel}` : ''}${preview.limitation ? ` · ${preview.limitation}` : ''}` : '';
                        return (
                          <div key={kiosk.id} className={cn('flex flex-col gap-3.5 rounded-[18px] border border-[#e6e2da] bg-white px-5 py-4', policyEnabled === null && 'opacity-70')}>
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                              <div className="flex min-w-0 items-baseline gap-2">
                                <span className="text-[15px] font-extrabold tracking-[-.01em]">{kiosk.name}</span>
                                <span className="text-[11.5px] text-[#8a8f99]">{isSupply ? 'Abastecimento' : 'Unidade comercial'}</span>
                              </div>
                              {sourceLine && <span className="text-[11.5px] text-[#70757d]">{sourceLine}</span>}
                            </div>
                            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,.85fr)_minmax(0,1.3fr)_minmax(0,.75fr)]">
                              {/* Estoque mínimo */}
                              <div className="flex flex-col gap-1.5">
                                <span className="flex min-h-[19px] items-center gap-1.5 whitespace-nowrap text-[11.5px] font-bold text-[#4a4f57]">
                                  Estoque mínimo
                                  {policyEnabled === false && (
                                    <FormField control={form.control} name={`stockLevels.${kiosk.id}.override`} render={({ field }) => (
                                      <button type="button" aria-pressed={field.value} title="Manter valor manual" aria-label={`Manter valor manual — ${kiosk.name}`} onClick={() => field.onChange(!field.value)}
                                        className={cn('rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-[.06em]', field.value ? 'bg-[#e4e4fb] text-[#3f3fb0]' : 'bg-[#d1fae5] text-[#047857]')}>
                                        {field.value ? 'MANUAL' : 'AUTO'}
                                      </button>
                                    )}/>
                                  )}
                                  {policyEnabled === true && <span title="Com a política ativa o mínimo é sempre automático" className="rounded-full bg-[#d1fae5] px-2 py-0.5 text-[10px] font-extrabold tracking-[.06em] text-[#047857]">AUTO</span>}
                                </span>
                                {policyEnabled === false ? (
                                  <FormField control={form.control} name={`stockLevels.${kiosk.id}.min`} render={({ field }) => (
                                    <FormItem className="space-y-0">
                                      <div className={cn('flex h-[38px] items-center rounded-[10px]', manualMin ? 'border-[1.5px] border-[#5b5bd6] bg-white' : 'bg-[#f4f3ef]')}>
                                        <FormControl><input type="number" {...field} value={field.value ?? ''} readOnly={!manualMin} aria-label={`Estoque mínimo — ${kiosk.name}`} title={manualMin ? undefined : 'Calculado automaticamente no motor legado.'}
                                          className={cn('h-full w-full min-w-0 bg-transparent pl-3 pr-1.5 text-sm outline-none', manualMin ? 'font-extrabold' : 'font-mono font-bold text-[#1a1b1f]')} /></FormControl>
                                        <span className="pr-3 text-xs text-[#8a8f99]">{unitWatch}</span>
                                      </div>
                                      {lastAutoCalculatedAt && !manualMin && <p className="pt-1.5 text-[10px] text-[#8a8f99]">Calc. automaticamente em {new Date(lastAutoCalculatedAt).toLocaleDateString('pt-BR')}</p>}
                                      <FormMessage />
                                    </FormItem>
                                  )}/>
                                ) : minimum.minimum === null ? (
                                  <div className="flex min-h-[38px] items-center rounded-[10px] border border-[#f5d9a3] bg-[#fff7e6] px-3 py-1.5 text-xs font-bold leading-snug text-[#8a5a00]">{minimum.label}</div>
                                ) : (
                                  <div className="flex h-[38px] items-center justify-between gap-1.5 rounded-[10px] bg-[#f4f3ef] px-3">
                                    <span className="font-mono text-[15px] font-bold">{minimum.minimum}</span>
                                    <span className="text-xs text-[#8a8f99]">{unitWatch}</span>
                                  </div>
                                )}
                              </div>

                              {/* Segurança */}
                              <div className="flex flex-col gap-1.5">
                                <span className="flex min-h-[19px] items-center text-[11.5px] font-bold text-[#4a4f57]">Segurança</span>
                                {policyEnabled === false ? (
                                  <FormField control={form.control} name={`stockLevels.${kiosk.id}.safetyStock`} render={({ field }) => (
                                    <FormItem className="space-y-0">
                                      <div className="flex h-[38px] items-center rounded-[10px] border border-[#dcd9d1] bg-white">
                                        <FormControl><input type="number" {...field} value={field.value ?? ''} aria-label={`Segurança legada — ${kiosk.name}`} className="h-full w-full min-w-0 bg-transparent pl-3 pr-1.5 text-sm font-bold outline-none" /></FormControl>
                                        <span className="pr-3 text-xs text-[#8a8f99]">{unitWatch}</span>
                                      </div>
                                      <FormMessage />
                                    </FormItem>
                                  )}/>
                                ) : (
                                  <div title="A margem de 30% entra uma vez na meta automática" className="flex h-[38px] items-center rounded-[10px] bg-[#f4f3ef] px-2.5 text-[11.5px] text-[#70757d]"><span className="truncate">{policyEnabled === null ? '—' : 'Na margem de 30%'}</span></div>
                                )}
                              </div>

                              {/* Abastecimento */}
                              <div className="flex flex-col gap-1.5">
                                <span className="flex min-h-[19px] items-center text-[11.5px] font-bold text-[#4a4f57]">Abastecimento</span>
                                {isSupply ? (
                                  <div className="flex h-[38px] items-center rounded-[10px] bg-[#f4f3ef] px-3 text-[12.5px] text-[#70757d]">Não se aplica</div>
                                ) : (
                                  <FormField control={form.control} name={`stockLevels.${kiosk.id}.supplyMode`} render={({ field }) => (
                                    <FormItem className="space-y-0">
                                      <div role="radiogroup" aria-label={`Abastecimento — ${kiosk.name}`} className="flex gap-0.5 rounded-[10px] bg-[#f1efe9] p-0.5">
                                        {([['cd', 'Via CD'], ['direct', 'Compra direta']] as const).map(([value, label]) => (
                                          <button key={value} type="button" role="radio" aria-checked={(field.value ?? 'cd') === value} disabled={policyEnabled === null} onClick={() => field.onChange(value)}
                                            className={cn('h-[34px] flex-1 whitespace-nowrap rounded-lg text-xs font-bold disabled:cursor-not-allowed', (field.value ?? 'cd') === value ? 'bg-white text-[#15151c] shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-[#8a8f99]')}>
                                            {label}
                                          </button>
                                        ))}
                                      </div>
                                    </FormItem>
                                  )}/>
                                )}
                              </div>

                              {/* Lead time */}
                              <div className="flex flex-col gap-1.5">
                                <span className="flex min-h-[19px] items-center text-[11.5px] font-bold text-[#4a4f57]">Lead time</span>
                                {leadLocked ? (
                                  <div title="Rota via CD usa prazo operacional de dois dias" className="flex h-[38px] items-center justify-between gap-1.5 rounded-[10px] bg-[#f4f3ef] px-3">
                                    <span className="text-sm font-bold">2</span>
                                    <span className="whitespace-nowrap text-[11px] text-[#8a8f99]">fixo</span>
                                  </div>
                                ) : (
                                  <FormField control={form.control} name={`stockLevels.${kiosk.id}.leadTime`} render={({ field }) => (
                                    <FormItem className="space-y-0">
                                      <div className={cn('flex h-[38px] items-center rounded-[10px] border', leadError ? 'border-[1.5px] border-[#e11d48]' : 'border-[#dcd9d1]', policyEnabled === null ? 'bg-[#f4f3ef]' : 'bg-white')}>
                                        <FormControl><input type="number" min={mode === 'direct' ? 1 : 0} {...field} value={field.value ?? ''} disabled={policyEnabled === null} aria-label={`Prazo de abastecimento — ${kiosk.name}`} className="h-full w-full min-w-0 bg-transparent pl-3 pr-1 text-sm font-bold outline-none" /></FormControl>
                                        <span className="pr-2.5 text-xs text-[#8a8f99]">dias</span>
                                      </div>
                                    </FormItem>
                                  )}/>
                                )}
                              </div>
                            </div>
                            {leadError && <span role="alert" className="-mt-1.5 text-right text-[11.5px] font-semibold text-[#e11d48]">{leadError}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Rodapé */}
                <div className="mt-auto flex flex-col gap-2.5 pt-1.5">
                  {saveError && <p role="alert" className="rounded-xl border border-[#f5d9a3] bg-[#fff7e6] px-3.5 py-2.5 text-[12.5px] leading-snug text-[#8a5a00]">{saveError}</p>}
                  <div className="flex items-center justify-between gap-3">
                    <button type="button" onClick={() => onOpenChange(false)} className="h-[46px] whitespace-nowrap px-1 text-[13.5px] font-semibold text-[#4a4f57]">Cancelar</button>
                    <div className="flex flex-wrap justify-end gap-2">
                      {currentStep === 1 ? (
                        <>
                          <button type="button" onClick={() => void handleNext()} className="h-[46px] whitespace-nowrap rounded-[14px] border border-[#dcd9d1] bg-white px-[18px] text-[13.5px] font-bold">Estoque por quiosque →</button>
                          {productToEdit && (
                            <button type="button" onClick={saveNow} disabled={policyEnabled === null || policyLoading || saving} className="h-[46px] whitespace-nowrap rounded-[14px] bg-[#15151c] px-[22px] text-[13.5px] font-bold text-white hover:bg-[#5b5bd6] disabled:cursor-not-allowed disabled:bg-[#b9b8c2]">{saving ? 'Salvando…' : 'Salvar alterações'}</button>
                          )}
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={handleBack} className="h-[46px] whitespace-nowrap rounded-[14px] border border-[#dcd9d1] bg-white px-[18px] text-[13.5px] font-bold">← Voltar</button>
                          <button type="submit" disabled={policyEnabled === null || policyLoading || saving} className="h-[46px] whitespace-nowrap rounded-[14px] bg-[#15151c] px-[22px] text-[13.5px] font-bold text-white hover:bg-[#5b5bd6] disabled:cursor-not-allowed disabled:bg-[#b9b8c2]">{saving ? 'Salvando…' : productToEdit ? 'Salvar alterações' : 'Adicionar produto'}</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      <ClassificationManagementModal open={isClassificationModalOpen} onOpenChange={setIsClassificationModalOpen} />
    </>
  );
}

function Eyebrow({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <span className={cn('text-[10.5px] font-extrabold uppercase', light ? 'tracking-[.14em] text-[#8a8f99]' : 'tracking-[.16em] text-[#8e8d99]')}>{children}</span>
  );
}
