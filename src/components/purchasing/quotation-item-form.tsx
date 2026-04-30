"use client";

import { useState, useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Check, ChevronsUpDown, Clock3, PlusCircle, Loader2, ScanBarcode, BarChart2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useEntities } from '@/hooks/use-entities';
import { usePurchase } from '@/hooks/use-purchase';
import { useProducts } from '@/hooks/use-products';
import { useQuotations } from '@/hooks/use-quotations';
import { BarcodeScanner } from './barcode-scanner';
import { PriceComparisonSheet } from './price-comparison-sheet';
import { cacheBaseProducts, lookupByBarcode } from '@/lib/purchasing-offline-cache';
import { getDefaultPurchaseUnitType, getPurchaseUnitOptions } from '@/lib/purchasing-units';
import { type PriceHistoryEntry, type PurchaseUnitType, type QuotationMode } from '@/types';

const schema = z.object({
  baseItemId: z.string().optional(),
  productId: z.string().optional(),
  freeText: z.string().optional(),
  unit: z.string().min(1, 'Informe a unidade.'),
  purchaseUnitType: z.enum(['content', 'logistic'] as const).optional(),
  quantity: z.coerce.number().min(0.001, 'Quantidade obrigatória.'),
  unitPrice: z.coerce.number().min(0.01, 'Preço obrigatório.'),
  discount: z.coerce.number().min(0).optional(),
  observation: z.string().optional(),
}).refine((v) => v.baseItemId || (v.freeText && v.freeText.length > 0), {
  message: 'Selecione um insumo ou informe a descrição.',
  path: ['freeText'],
}).refine((v) => (v.discount ?? 0) <= v.quantity * v.unitPrice, {
  message: 'O desconto não pode ser maior que o valor bruto do item.',
  path: ['discount'],
});

type FormValues = z.infer<typeof schema>;

function isScaleBarcode(barcode: string) {
  return /^2\d{7,12}$/.test(barcode);
}

interface Props {
  quotationId: string;
  mode?: QuotationMode;
  supplierId?: string;
  onAdded?: () => void;
}

type ProductOption = {
  id: string;
  label: string;
  unit: string;
  baseItemId: string;
  searchText: string;
  purchaseUnitOptions: Array<{ type: PurchaseUnitType; label: string }>;
  defaultPurchaseUnitType: PurchaseUnitType;
};

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function formatCurrency(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }

  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function QuotationItemForm({ quotationId, mode, supplierId, onAdded }: Props) {
  const { baseProducts } = useBaseProducts();
  const { entities } = useEntities();
  const { priceHistory, loading: purchaseLoading } = usePurchase();
  const { products, getProductFullName } = useProducts();
  const { addItem } = useQuotations();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isFreeText, setIsFreeText] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);
  const [comparisonOpen, setComparisonOpen] = useState(false);

  // Warm up offline cache whenever base products load
  useEffect(() => {
    if (baseProducts.length > 0) {
      cacheBaseProducts(baseProducts as Array<{ id: string; name: string; unit: string; barcode?: string }>);
    }
  }, [baseProducts]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      baseItemId: '',
      productId: '',
      freeText: '',
      unit: '',
      purchaseUnitType: 'content',
      quantity: undefined,
      unitPrice: undefined,
      discount: 0,
      observation: '',
    },
  });

  const selectedBaseItemId = form.watch('baseItemId');
  const selectedProductId = form.watch('productId');
  const unitPrice = form.watch('unitPrice') ?? 0;
  const quantity = form.watch('quantity') ?? 0;
  const discount = form.watch('discount') ?? 0;
  const total = Math.max(unitPrice * quantity - discount, 0);

  const productOptions = useMemo<ProductOption[]>(
    () =>
      products
        .filter((product) => !product.isArchived && !!product.baseProductId)
        .sort((a, b) => getProductFullName(a).localeCompare(getProductFullName(b), 'pt-BR'))
        .map((product) => {
          const label = getProductFullName(product);
          const purchaseUnitOptions = getPurchaseUnitOptions(product);
          const defaultPurchaseUnitType = getDefaultPurchaseUnitType(product);
          return {
            id: product.id,
            label,
            unit:
              purchaseUnitOptions.find((option) => option.type === defaultPurchaseUnitType)?.label ??
              purchaseUnitOptions[0]?.label ??
              product.unit,
            baseItemId: product.baseProductId!,
            searchText: normalizeSearchText(
              [
                product.baseName,
                product.brand,
                `${product.packageSize}${product.unit}`,
                product.packageType,
                label,
              ]
                .filter(Boolean)
                .join(' '),
            ),
            purchaseUnitOptions,
            defaultPurchaseUnitType,
          };
        }),
    [getProductFullName, products],
  );

  const selectedProduct = useMemo(
    () =>
      productOptions.find((option) => option.id === selectedProductId) ??
      productOptions.find((option) => option.baseItemId === selectedBaseItemId),
    [productOptions, selectedBaseItemId, selectedProductId],
  );

  const recentPriceHistory = useMemo<
    Array<
      PriceHistoryEntry & {
        entityName: string;
        productLabel: string;
        isCurrentSupplier: boolean;
      }
    >
  >(() => {
    if (!selectedBaseItemId) return [];

    return priceHistory
      .filter((entry) => entry.baseProductId === selectedBaseItemId)
      .slice(0, 3)
      .map((entry) => {
        const entity = entities.find((item) => item.id === entry.entityId);
        const product = products.find((item) => item.id === entry.productId);

        return {
          ...entry,
          entityName: entity?.fantasyName || entity?.name || 'Fornecedor não encontrado',
          productLabel: product ? getProductFullName(product) : 'Insumo não encontrado',
          isCurrentSupplier: !!supplierId && entry.entityId === supplierId,
        };
      });
  }, [entities, getProductFullName, priceHistory, products, selectedBaseItemId, supplierId]);

  const filteredOptions = useMemo(() => {
    const tokens = normalizeSearchText(search).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return productOptions;
    return productOptions.filter((option) => tokens.every((token) => option.searchText.includes(token)));
  }, [productOptions, search]);

  const handleSelectProduct = (option: ProductOption) => {
    form.setValue('baseItemId', option.baseItemId);
    form.setValue('productId', option.id);
    form.setValue('freeText', '');
    form.setValue('purchaseUnitType', option.defaultPurchaseUnitType);
    const defaultOption =
      option.purchaseUnitOptions.find((unitOption) => unitOption.type === option.defaultPurchaseUnitType) ??
      option.purchaseUnitOptions[0];
    form.setValue('unit', defaultOption?.label ?? option.unit);
    setIsFreeText(false);
    setOpen(false);
    setSearch('');
  };

  const handleFreeTextToggle = () => {
    setIsFreeText(true);
    form.setValue('baseItemId', '');
    form.setValue('productId', '');
    form.setValue('unit', '');
    form.setValue('purchaseUnitType', 'content');
  };

  const handleBarcodeDetected = async (barcode: string) => {
    setShowScanner(false);
    setLastScannedBarcode(barcode);

    if (isScaleBarcode(barcode)) {
      setIsFreeText(true);
      form.setValue('baseItemId', '');
      form.setValue('productId', '');
      form.setValue('freeText', `Código de balança ${barcode}`);
      form.setValue('unit', '');
      form.setValue('purchaseUnitType', 'content');
      return;
    }

    // Try to resolve barcode → base product (offline cache first)
    const cached = await lookupByBarcode(barcode);
    if (cached) {
      form.setValue('baseItemId', cached.id);
      form.setValue('productId', '');
      form.setValue('freeText', '');
      form.setValue('unit', cached.unit);
      form.setValue('purchaseUnitType', 'content');
      setIsFreeText(false);
    } else {
      // Unknown barcode → free text item pre-filled with barcode
      setIsFreeText(true);
      form.setValue('baseItemId', '');
      form.setValue('freeText', barcode);
    }
  };

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      await addItem(quotationId, {
        baseItemId: values.baseItemId || undefined,
        productId: values.productId || undefined,
        freeText: values.freeText || undefined,
        barcode: lastScannedBarcode ?? undefined,
        unit: values.unit,
        purchaseUnitType: values.purchaseUnitType ?? 'content',
        purchaseUnitLabel: values.unit,
        quantity: values.quantity,
        unitPrice: values.unitPrice,
        discount: values.discount ?? 0,
        observation: values.observation || undefined,
      });
      setLastScannedBarcode(null);
      form.reset();
      setIsFreeText(false);
      onAdded?.();
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!selectedProduct) return;
    const nextType = form.getValues('purchaseUnitType') ?? selectedProduct.defaultPurchaseUnitType;
    const validType =
      nextType === 'logistic' && selectedProduct.purchaseUnitOptions.length === 1
        ? 'content'
        : nextType;
    form.setValue('purchaseUnitType', validType);
    const matchingOption =
      selectedProduct.purchaseUnitOptions.find((option) => option.type === validType) ??
      selectedProduct.purchaseUnitOptions[0];
    form.setValue('unit', matchingOption?.label ?? selectedProduct.unit);
  }, [form, selectedProduct]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        {/* Barcode scanner (in_loco mode) */}
        {mode === 'in_loco' && (
          <div className="space-y-2">
            {showScanner ? (
              <BarcodeScanner
                onDetected={handleBarcodeDetected}
                onClose={() => setShowScanner(false)}
              />
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setShowScanner(true)}
              >
                <ScanBarcode className="mr-2 h-4 w-4" />
                Escanear código de barras
                {lastScannedBarcode && (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    ({lastScannedBarcode})
                  </span>
                )}
              </Button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Insumo */}
          <div className="sm:col-span-2">
            {!isFreeText ? (
              <FormField
                control={form.control}
                name="baseItemId"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Insumo</FormLabel>
                    <Popover open={open} onOpenChange={setOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            className={cn(
                              'justify-between font-normal',
                              !field.value && 'text-muted-foreground',
                            )}
                          >
                            {selectedProduct?.label ?? 'Buscar insumo...'}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-96 p-0" align="start">
                        <div className="border-b p-2">
                          <Input
                            autoFocus
                            placeholder="Buscar insumo..."
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                          />
                        </div>
                        <div className="max-h-[300px] overflow-y-auto p-1">
                          {filteredOptions.length === 0 ? (
                            <div className="p-3 text-center space-y-2">
                              <p className="text-sm text-muted-foreground">Nenhum insumo encontrado.</p>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={handleFreeTextToggle}
                                type="button"
                              >
                                Adicionar como item livre
                              </Button>
                            </div>
                          ) : (
                            filteredOptions.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                                onClick={() => handleSelectProduct(option)}
                              >
                                <Check
                                  className={cn(
                                    'mr-2 h-4 w-4',
                                    field.value === option.baseItemId ? 'opacity-100' : 'opacity-0',
                                  )}
                                />
                                <span>{option.label}</span>
                                <span className="ml-auto text-xs text-muted-foreground">
                                  {option.unit}
                                </span>
                              </button>
                            ))
                          )}
                          <div className="p-2 border-t">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="w-full text-muted-foreground"
                              onClick={handleFreeTextToggle}
                              type="button"
                            >
                              + Item livre (sem insumo vinculado)
                            </Button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <FormField
                control={form.control}
                name="freeText"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Descrição do item{' '}
                      <span className="text-xs text-amber-600 font-normal">
                        (item livre — normalizar antes de comprar)
                      </span>
                    </FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input placeholder="Ex: Morango Vermelho Premium 500g" {...field} />
                      </FormControl>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsFreeText(false)}
                      >
                        Buscar insumo
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </div>

          {selectedBaseItemId && (
            <div className="sm:col-span-2 rounded-md border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock3 className="h-4 w-4 text-muted-foreground" />
                  Últimos 3 preços
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                  onClick={() => setComparisonOpen(true)}
                >
                  <BarChart2 className="h-3.5 w-3.5" />
                  Comparar produtos
                </Button>
              </div>

              {purchaseLoading ? (
                <p className="mt-2 text-sm text-muted-foreground">Carregando histórico...</p>
              ) : recentPriceHistory.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nenhum histórico efetivado encontrado para este insumo.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {recentPriceHistory.map((entry) => (
                    <div
                      key={entry.id}
                      className={cn(
                        'rounded-md border bg-background px-3 py-2 text-sm',
                        entry.isCurrentSupplier && 'border-primary/40',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium leading-none">{entry.entityName}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {entry.productLabel}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-primary">
                            {formatCurrency(entry.pricePerUnit)} / unidade base
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {format(parseISO(entry.confirmedAt), 'dd/MM/yyyy', { locale: ptBR })}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>Preço pago: {formatCurrency(entry.price)}</span>
                        {entry.isCurrentSupplier && <span>Mesmo fornecedor desta cotação</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedProduct && selectedProduct.purchaseUnitOptions.length > 1 ? (
            <FormField
              control={form.control}
              name="purchaseUnitType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Unidade de compra</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      const nextType = value as PurchaseUnitType;
                      field.onChange(nextType);
                      const nextOption = selectedProduct.purchaseUnitOptions.find((option) => option.type === nextType);
                      form.setValue('unit', nextOption?.label ?? selectedProduct.unit);
                    }}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {selectedProduct.purchaseUnitOptions.map((option) => (
                        <SelectItem key={option.type} value={option.type}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : (
            <FormField
              control={form.control}
              name="unit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Unidade</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="kg, un, L, cx..."
                      {...field}
                      readOnly={!!selectedProduct}
                      className={selectedProduct ? 'bg-muted' : ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {/* Quantidade */}
          <FormField
            control={form.control}
            name="quantity"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Quantidade</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.001"
                    placeholder="0"
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Preço unitário */}
          <FormField
            control={form.control}
            name="unitPrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Preço unitário (R$)</FormLabel>
                <FormControl>
                  <CurrencyInput value={field.value ?? 0} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="discount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Desconto (R$)</FormLabel>
                <FormControl>
                  <CurrencyInput value={field.value ?? 0} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Total calculado */}
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Total</span>
            <div className="h-10 flex items-center px-3 rounded-md border bg-muted text-sm font-mono">
              {total > 0
                ? total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                : '—'}
            </div>
          </div>

          {/* Observação */}
          <FormField
            control={form.control}
            name="observation"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Observação (opcional)</FormLabel>
                <FormControl>
                  <Input placeholder="Condição especial, marca observada..." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <PlusCircle className="mr-2 h-4 w-4" />
          )}
          Adicionar item
        </Button>
      </form>

      <PriceComparisonSheet
        open={comparisonOpen}
        onOpenChange={setComparisonOpen}
        products={productOptions}
        priceHistory={priceHistory}
        entities={entities}
        initialProductId={selectedProduct?.id}
      />
    </Form>
  );
}
