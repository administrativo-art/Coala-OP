"use client";

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Check, ChevronsUpDown, Loader2, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEntities } from '@/hooks/use-entities';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { useProducts } from '@/hooks/use-products';
import { getDefaultPurchaseUnitType, getPurchaseUnitOptions } from '@/lib/purchasing-units';
import { type PaymentMethod, type PurchasePaymentCondition, type PurchaseReceiptMode, type PurchaseUnitType } from '@/types';
import { cn } from '@/lib/utils';

const schema = z.object({
  supplierId: z.string().min(1, 'Selecione um fornecedor.'),
  receiptMode: z.enum(['future_delivery', 'immediate_pickup'] as const),
  paymentMethod: z.enum(['pix', 'card_credit', 'card_debit', 'cash', 'boleto', 'term'] as const),
  paymentCondition: z.enum(['cash', 'installments'] as const),
  installmentsCount: z.coerce.number().min(2).optional(),
  paymentDueDate: z.string().min(1, 'Informe o vencimento.'),
  estimatedReceiptDate: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type DraftItem = {
  key: string;
  productId: string;
  baseItemId: string;
  unit: string;
  purchaseUnitType: PurchaseUnitType;
  quantityOrdered: number;
  unitPriceOrdered: number;
};

interface Props {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}

type PurchasableProductOption = {
  id: string;
  label: string;
  searchText: string;
  defaultPurchaseUnitType: PurchaseUnitType;
  purchaseUnitOptions: Array<{ type: PurchaseUnitType; label: string }>;
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  pix: 'Pix',
  card_credit: 'Cartão de crédito',
  card_debit: 'Cartão de débito',
  cash: 'Dinheiro',
  boleto: 'Boleto',
  term: 'A prazo',
};

const PAYMENT_CONDITION_LABELS: Record<PurchasePaymentCondition, string> = {
  cash: 'À vista',
  installments: 'Parcelado',
};

function newDraftItem(): DraftItem {
  return {
    key: Math.random().toString(36).slice(2),
    productId: '',
    baseItemId: '',
    unit: '',
    purchaseUnitType: 'content',
    quantityOrdered: 0,
    unitPriceOrdered: 0,
  };
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function DirectPurchaseProductCombobox({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: PurchasableProductOption[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selectedOption = options.find((option) => option.id === value);
  const searchTokens = normalizeSearchText(search).split(/\s+/).filter(Boolean);
  const filteredOptions =
    searchTokens.length === 0
      ? options
      : options.filter((option) => searchTokens.every((token) => option.searchText.includes(token)));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{selectedOption?.label ?? 'Selecione'}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
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
            <div className="py-6 text-center text-sm text-muted-foreground">
              Nenhum insumo encontrado.
            </div>
          ) : (
            filteredOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                  setSearch('');
                }}
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4',
                    value === option.id ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <span>{option.label}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CreateDirectPurchaseModal({ open, onOpenChange }: Props) {
  const router = useRouter();
  const { entities } = useEntities();
  const { purchasingDefaults } = useCompanySettings();
  const { products, getProductFullName } = useProducts();
  const { createPurchase } = usePurchaseOrders();
  const [items, setItems] = useState<DraftItem[]>([newDraftItem()]);
  const [submitting, setSubmitting] = useState(false);

  const today = format(new Date(), 'yyyy-MM-dd');
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      supplierId: '',
      receiptMode: 'immediate_pickup',
      paymentMethod: 'pix',
      paymentCondition: 'cash',
      installmentsCount: 2,
      paymentDueDate: today,
      estimatedReceiptDate: today,
      notes: '',
    },
  });

  const receiptMode = form.watch('receiptMode');
  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.quantityOrdered * item.unitPriceOrdered, 0),
    [items],
  );

  const updateItem = (key: string, patch: Partial<DraftItem>) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        const next = { ...item, ...patch };
        if (patch.productId) {
          const product = products.find((entry) => entry.id === patch.productId);
          if (product) {
            const purchaseUnitOptions = getPurchaseUnitOptions(product);
            const purchaseUnitType = getDefaultPurchaseUnitType(product);
            const purchaseUnitLabel =
              purchaseUnitOptions.find((option) => option.type === purchaseUnitType)?.label ??
              purchaseUnitOptions[0]?.label ??
              product.unit;
            next.baseItemId = product.baseProductId ?? '';
            next.purchaseUnitType = purchaseUnitType;
            next.unit = purchaseUnitLabel;
          }
        }
        return next;
      }),
    );
  };

  const validItems = items.filter(
    (item) => item.baseItemId && item.quantityOrdered > 0 && item.unitPriceOrdered > 0,
  );

  const purchasableProducts = useMemo<PurchasableProductOption[]>(
    () =>
      products
        .filter((product) => !product.isArchived && !!product.baseProductId)
        .sort((a, b) => getProductFullName(a).localeCompare(getProductFullName(b), 'pt-BR'))
        .map((product) => {
          const label = getProductFullName(product);
          return {
            id: product.id,
            label,
            defaultPurchaseUnitType: getDefaultPurchaseUnitType(product),
            purchaseUnitOptions: getPurchaseUnitOptions(product),
            searchText: normalizeSearchText(
              [product.baseName, product.brand, `${product.packageSize}${product.unit}`, product.packageType, label]
                .filter(Boolean)
                .join(' '),
            ),
          };
        }),
    [getProductFullName, products],
  );

  const onSubmit = async (values: FormValues) => {
    if (validItems.length !== items.length) return;
    setSubmitting(true);
    
    const supplier = entities.find(e => e.id === values.supplierId);

    try {
      const orderId = await createPurchase({
        supplierId: values.supplierId,
        supplierName: supplier?.fantasyName || supplier?.name || '',
        origin: 'direct',
        receiptMode: values.receiptMode as PurchaseReceiptMode,
        paymentMethod: values.paymentMethod,
        paymentCondition: values.paymentCondition,
        installmentsCount: values.paymentCondition === 'installments' ? values.installmentsCount : undefined,
        paymentDueDate: values.paymentDueDate,
        estimatedReceiptDate:
          values.receiptMode === 'immediate_pickup'
            ? new Date().toISOString()
            : values.estimatedReceiptDate || values.paymentDueDate,
        accountPlanId: purchasingDefaults.goodsAccountPlanId ?? undefined,
        freightAccountPlanId: purchasingDefaults.freightAccountPlanId ?? undefined,
        notes: values.notes || undefined,
        items: validItems.map(({ productId, baseItemId, unit, purchaseUnitType, quantityOrdered, unitPriceOrdered }) => ({
          productId,
          baseItemId,
          unit,
          purchaseUnitType,
          purchaseUnitLabel: unit,
          quantityOrdered,
          unitPriceOrdered,
        })),
      });
      if (orderId) {
        form.reset();
        setItems([newDraftItem()]);
        onOpenChange(false);
        router.push(`/dashboard/purchasing/orders/${orderId}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Compra direta</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form id="direct-purchase-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="supplierId"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Fornecedor</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione um fornecedor" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {entities.map((entity) => (
                          <SelectItem key={entity.id} value={entity.id}>
                            {entity.fantasyName ?? entity.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="receiptMode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recebimento</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="immediate_pickup">Retirada imediata</SelectItem>
                        <SelectItem value="future_delivery">Entrega futura</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />

              {receiptMode === 'future_delivery' && (
                <FormField
                  control={form.control}
                  name="estimatedReceiptDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Data estimada</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="paymentDueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vencimento</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="paymentMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Forma de pagamento</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(PAYMENT_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="paymentCondition"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Condição de pagamento</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(PAYMENT_CONDITION_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />

              {form.watch('paymentCondition') === 'installments' && (
                <FormField
                  control={form.control}
                  name="installmentsCount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Parcelas para análise</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={2}
                          value={field.value ?? 2}
                          onChange={(event) => field.onChange(Math.max(2, Number(event.target.value || 2)))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Itens</p>
                <Button type="button" variant="outline" size="sm" onClick={() => setItems((prev) => [...prev, newDraftItem()])}>
                  <Plus className="mr-2 h-4 w-4" />
                  Item
                </Button>
              </div>

              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.key} className="grid grid-cols-1 sm:grid-cols-[1fr_90px_120px_120px_36px] gap-2 items-end rounded-md border p-3">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Insumo</label>
                      <DirectPurchaseProductCombobox
                        value={item.productId}
                        onChange={(value) => updateItem(item.key, { productId: value })}
                        options={purchasableProducts}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Un.</label>
                      {(() => {
                        const selectedProduct = purchasableProducts.find((option) => option.id === item.productId);
                        if (selectedProduct && selectedProduct.purchaseUnitOptions.length > 1) {
                          return (
                            <Select
                              value={item.purchaseUnitType}
                              onValueChange={(value) => {
                                const nextType = value as PurchaseUnitType;
                                const nextOption = selectedProduct.purchaseUnitOptions.find((option) => option.type === nextType);
                                updateItem(item.key, {
                                  purchaseUnitType: nextType,
                                  unit: nextOption?.label ?? item.unit,
                                });
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {selectedProduct.purchaseUnitOptions.map((option) => (
                                  <SelectItem key={option.type} value={option.type}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          );
                        }

                        return (
                          <Input
                            value={item.unit}
                            onChange={(event) => updateItem(item.key, { unit: event.target.value })}
                            readOnly={!!selectedProduct}
                            className={selectedProduct ? 'bg-muted' : undefined}
                          />
                        );
                      })()}
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Qtd.</label>
                      <Input
                        type="number"
                        step="0.001"
                        placeholder="0,00"
                        value={item.quantityOrdered || ''}
                        onChange={(event) => updateItem(item.key, { quantityOrdered: parseFloat(event.target.value) || 0 })}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Preço unit.</label>
                      <CurrencyInput
                        value={item.unitPriceOrdered}
                        onChange={(value) => updateItem(item.key, { unitPriceOrdered: value })}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={items.length === 1}
                      onClick={() => setItems((prev) => prev.filter((current) => current.key !== item.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
          </form>
        </Form>

        <DialogFooter className="items-center sm:justify-between gap-3">
          <p className="text-sm font-medium">
            Total: {total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" form="direct-purchase-form" disabled={submitting || validItems.length !== items.length}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar compra
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
