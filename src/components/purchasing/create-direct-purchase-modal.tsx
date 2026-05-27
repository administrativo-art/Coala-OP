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
import { useOperationalItemCategories } from '@/hooks/use-operational-item-categories';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { useProducts } from '@/hooks/use-products';
import { usePurchasingFinancialOptions } from '@/hooks/use-purchasing-financial-options';
import { getDefaultPurchaseUnitType, getPurchaseUnitOptions } from '@/lib/purchasing-units';
import {
  type PaymentMethod,
  type PurchasePaymentCondition,
  type PurchaseReceiptMode,
  type PurchaseStockEntryType,
  type PurchaseUnitType,
} from '@/types';
import { cn } from '@/lib/utils';

const schema = z.object({
  supplierId: z.string().min(1, 'Selecione um fornecedor.'),
  receiptMode: z.enum(['future_delivery', 'immediate_pickup'] as const),
  paymentMethod: z.enum(['pix', 'card_credit', 'card_debit', 'cash', 'boleto', 'term'] as const),
  paymentCondition: z.enum(['cash', 'installments'] as const),
  paymentCardKey: z.string().optional(),
  installmentsCount: z.coerce.number().min(2).optional(),
  paymentDueDate: z.string().min(1, 'Informe a data.'),
  estimatedReceiptDate: z.string().optional(),
  trackingInfo: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type DraftItem = {
  key: string;
  productId: string;
  baseItemId: string;
  itemName: string;
  operationalCategoryId: string;
  unit: string;
  purchaseUnitType: PurchaseUnitType;
  quantityOrdered: number;
  unitPriceOrdered: number;
  entryType: PurchaseStockEntryType;
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

function getPaymentDateLabel(paymentMethod?: PaymentMethod) {
  return paymentMethod === 'card_credit' || paymentMethod === 'card_debit' ? 'Data da compra' : 'Vencimento';
}

function isCardPayment(paymentMethod?: PaymentMethod) {
  return paymentMethod === 'card_credit' || paymentMethod === 'card_debit';
}

function getPaymentCardKey(accountId: string, methodId: string) {
  return `${accountId}::${methodId}`;
}

function newDraftItem(): DraftItem {
  return {
    key: Math.random().toString(36).slice(2),
    productId: '',
    baseItemId: '',
    itemName: '',
    operationalCategoryId: '',
    unit: '',
    purchaseUnitType: 'content',
    quantityOrdered: 0,
    unitPriceOrdered: 0,
    entryType: 'stock',
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
  const { activeCategories } = useOperationalItemCategories();
  const { products, getProductFullName } = useProducts();
  const { createPurchase } = usePurchaseOrders();
  const { paymentCards } = usePurchasingFinancialOptions();
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
      paymentCardKey: '',
      installmentsCount: 2,
      paymentDueDate: today,
      estimatedReceiptDate: today,
      trackingInfo: '',
      notes: '',
    },
  });

  const receiptMode = form.watch('receiptMode');
  const paymentMethod = form.watch('paymentMethod');
  const paymentCardKey = form.watch('paymentCardKey') ?? '';
  const selectedPaymentCard = useMemo(
    () => paymentCards.find((card) => getPaymentCardKey(card.accountId, card.methodId) === paymentCardKey) ?? null,
    [paymentCards, paymentCardKey],
  );
  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.quantityOrdered * item.unitPriceOrdered, 0),
    [items],
  );

  const updateItem = (key: string, patch: Partial<DraftItem>) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        const next = { ...item, ...patch };
        if (patch.operationalCategoryId) {
          const category = activeCategories.find((entry) => entry.id === patch.operationalCategoryId);
          next.entryType = category?.destination === 'asset' ? 'asset' : category?.destination === 'uniform' ? 'uniform' : 'stock';
          next.productId = '';
          next.baseItemId = '';
          next.itemName = '';
          next.unit = category?.destination === 'asset' ? 'un' : '';
          next.purchaseUnitType = 'content';
        }
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
    (item) => {
      const category = activeCategories.find((entry) => entry.id === item.operationalCategoryId);
      const hasItem = category?.destination === 'asset' ? item.itemName.trim().length > 0 : !!item.baseItemId;
      return !!category && hasItem && item.quantityOrdered > 0 && item.unitPriceOrdered > 0;
    },
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
                .concat(product.aliases ?? [])
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
        paymentAccountId: isCardPayment(values.paymentMethod) ? selectedPaymentCard?.accountId ?? null : null,
        paymentAccountName: isCardPayment(values.paymentMethod) ? selectedPaymentCard?.accountName ?? null : null,
        paymentMethodId: isCardPayment(values.paymentMethod) ? selectedPaymentCard?.methodId ?? null : null,
        paymentMethodLabel: isCardPayment(values.paymentMethod) ? selectedPaymentCard?.methodLabel ?? null : null,
        paymentCondition: values.paymentCondition,
        installmentsCount: values.paymentCondition === 'installments' ? values.installmentsCount : undefined,
        paymentDueDate: values.paymentDueDate,
        estimatedReceiptDate:
          values.receiptMode === 'immediate_pickup'
            ? new Date().toISOString()
            : values.estimatedReceiptDate || values.paymentDueDate,
        accountPlanId: purchasingDefaults.goodsAccountPlanId ?? undefined,
        freightAccountPlanId: purchasingDefaults.freightAccountPlanId ?? undefined,
        trackingInfo: values.trackingInfo || undefined,
        notes: values.notes || undefined,
        items: validItems.map(({ productId, baseItemId, itemName, operationalCategoryId, unit, purchaseUnitType, quantityOrdered, unitPriceOrdered, entryType }) => {
          const category = activeCategories.find((entry) => entry.id === operationalCategoryId);
          return {
          productId,
          baseItemId,
          itemName: itemName || undefined,
          operationalCategoryId,
          operationalCategoryName: category?.name,
          itemDestination: category?.destination,
          unit,
          purchaseUnitType,
          purchaseUnitLabel: unit,
          quantityOrdered,
          unitPriceOrdered,
          entryType,
        };
        }),
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
                    <Select
                      onValueChange={(value) => {
                        field.onChange(value);
                        if (!isCardPayment(value as PaymentMethod)) form.setValue('paymentCardKey', '');
                      }}
                      value={field.value}
                    >
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

              {isCardPayment(paymentMethod) && (
                <FormField
                  control={form.control}
                  name="paymentCardKey"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Cartão da compra</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className={!field.value ? 'border-amber-400' : ''}>
                            <SelectValue placeholder="Selecione o cartão" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {paymentCards.map((card) => (
                            <SelectItem key={getPaymentCardKey(card.accountId, card.methodId)} value={getPaymentCardKey(card.accountId, card.methodId)}>
                              {card.methodLabel}{card.lastDigits ? ` final ${card.lastDigits}` : ''} · {card.accountName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!field.value && <p className="text-xs text-amber-600">Obrigatório para compra no cartão.</p>}
                    </FormItem>
                  )}
                />
              )}

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
                    <FormLabel>{getPaymentDateLabel(paymentMethod)}</FormLabel>
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
                {items.map((item) => {
                  const selectedCategory = activeCategories.find((category) => category.id === item.operationalCategoryId);
                  const categoryDestination = selectedCategory?.destination;
                  const availableProducts = categoryDestination
                    ? purchasableProducts.filter((option) => {
                        const product = products.find((entry) => entry.id === option.id);
                        if (categoryDestination === 'uniform') return product?.operationalDestination === 'uniform';
                        return product?.operationalCategoryId === item.operationalCategoryId || (!product?.operationalCategoryId && categoryDestination === 'stock');
                      })
                    : [];
                  return (
                  <div key={item.key} className="grid grid-cols-1 sm:grid-cols-[130px_1fr_90px_120px_120px_36px] gap-2 items-end rounded-md border p-3">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Categoria</label>
                      <Select
                        value={item.operationalCategoryId}
                        onValueChange={(value) => updateItem(item.key, { operationalCategoryId: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeCategories.map((category) => (
                            <SelectItem key={category.id} value={category.id}>
                              {category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">{categoryDestination === 'asset' ? 'Patrimônio' : 'Insumo'}</label>
                      {categoryDestination === 'asset' ? (
                        <Input
                          placeholder="Ex: Máquina de sorvete"
                          value={item.itemName}
                          onChange={(event) => updateItem(item.key, { itemName: event.target.value })}
                        />
                      ) : (
                        <DirectPurchaseProductCombobox
                          value={item.productId}
                          onChange={(value) => updateItem(item.key, { productId: value })}
                          options={availableProducts}
                        />
                      )}
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Un.</label>
                      {(() => {
                        const selectedProduct = purchasableProducts.find((option) => option.id === item.productId);
                        if (categoryDestination === 'asset') {
                          return <Input value="un" readOnly className="bg-muted" />;
                        }
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
                        step={item.entryType === 'asset' ? '1' : '0.001'}
                        min={item.entryType === 'asset' ? 1 : undefined}
                        placeholder="0,00"
                        value={item.quantityOrdered || ''}
                        onChange={(event) => {
                          const nextQuantity = parseFloat(event.target.value) || 0;
                          updateItem(item.key, {
                            quantityOrdered: item.entryType === 'asset' ? Math.floor(nextQuantity) : nextQuantity,
                          });
                        }}
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
                    {categoryDestination === 'asset' && (
                      <p className="sm:col-span-5 sm:col-start-2 text-xs text-muted-foreground">
                        No recebimento, cada unidade vira um patrimônio individual com etiqueta.
                      </p>
                    )}
                  </div>
                );
                })}
              </div>
            </div>

            <FormField
              control={form.control}
              name="trackingInfo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Informações de rastreio</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="Código, transportadora, prazo ou link de acompanhamento..."
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

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
            <Button
              type="submit"
              form="direct-purchase-form"
              disabled={submitting || validItems.length !== items.length || (isCardPayment(paymentMethod as PaymentMethod) && !selectedPaymentCard)}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar compra
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
