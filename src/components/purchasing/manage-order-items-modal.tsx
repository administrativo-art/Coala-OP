"use client";

import { useMemo, useState, useEffect } from 'react';
import { Check, ChevronsUpDown, Loader2, Plus, Trash2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { useProducts } from '@/hooks/use-products';
import { useOperationalItemCategories } from '@/hooks/use-operational-item-categories';
import { getDefaultPurchaseUnitType, getPurchaseUnitOptions } from '@/lib/purchasing-units';
import { type Product, type PurchaseOrderItem, type PurchaseStockEntryType, type PurchaseUnitType } from '@/types';
import { cn } from '@/lib/utils';

type DraftItem = {
  key: string;
  id?: string;
  isRegistered: boolean;
  productId: string;
  baseItemId: string;
  itemName: string;
  operationalCategoryId: string;
  operationalCategoryName?: string;
  unit: string;
  purchaseUnitType: PurchaseUnitType;
  quantityOrdered: number;
  unitPriceOrdered: number;
  discountOrdered: number;
  entryType: PurchaseStockEntryType;
  notes: string;
  aliasCandidate: string;
  linkAlias: boolean;
};

interface Props {
  orderId: string;
  initialItems: PurchaseOrderItem[];
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onSuccess?: () => void;
}

type PurchasableProductOption = {
  id: string;
  label: string;
  searchText: string;
  defaultPurchaseUnitType: PurchaseUnitType;
  purchaseUnitOptions: Array<{ type: PurchaseUnitType; label: string }>;
};

function newDraftItem(): DraftItem {
  return {
    key: Math.random().toString(36).slice(2),
    isRegistered: true,
    productId: '',
    baseItemId: '',
    itemName: '',
    operationalCategoryId: '',
    operationalCategoryName: undefined,
    unit: '',
    purchaseUnitType: 'content',
    quantityOrdered: 0,
    unitPriceOrdered: 0,
    discountOrdered: 0,
    entryType: 'stock',
    notes: '',
    aliasCandidate: '',
    linkAlias: false,
  };
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function shouldLinkAlias(candidate: string, product: Product | undefined, productLabel: string) {
  if (!product) return false;
  const normalizedCandidate = normalizeSearchText(candidate);
  if (!normalizedCandidate) return false;
  const existingNames = [
    product.baseName,
    product.brand,
    `${product.packageSize}${product.unit}`,
    product.packageType,
    productLabel,
    ...(product.aliases ?? []),
  ].map((value) => normalizeSearchText(String(value ?? '')));

  return !existingNames.includes(normalizedCandidate);
}

function ProductCombobox({
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

export function ManageOrderItemsModal({ orderId, initialItems, open, onOpenChange, onSuccess }: Props) {
  const { products, getProductFullName, updateProduct } = useProducts();
  const { activeCategories } = useOperationalItemCategories();
  const { updateOrder } = usePurchaseOrders();
  const [items, setItems] = useState<DraftItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setItems(
        initialItems.map((item) => {
          const product = item.productId ? products.find((entry) => entry.id === item.productId) : undefined;
          const productLabel = product ? getProductFullName(product) : '';
          const aliasCandidate = item.itemName?.trim() ?? '';
          const entryType = item.entryType === 'asset' || item.entryType === 'uniform' ? item.entryType : 'stock';
          const inferredCategory =
            activeCategories.find((category) => category.id === item.operationalCategoryId) ??
            activeCategories.find((category) => product?.operationalCategoryId && category.id === product.operationalCategoryId) ??
            activeCategories.find((category) => category.destination === entryType);

          return {
            key: item.id,
            id: item.id,
            isRegistered: !!(item.productId || item.baseItemId),
            productId: item.productId ?? '',
            baseItemId: item.baseItemId,
            itemName: item.itemName ?? '',
            operationalCategoryId: inferredCategory?.id ?? '',
            operationalCategoryName: inferredCategory?.name ?? item.operationalCategoryName,
            unit: item.unit,
            purchaseUnitType: item.purchaseUnitType ?? 'content',
            quantityOrdered: item.quantityOrdered,
            unitPriceOrdered: item.unitPriceOrdered,
            discountOrdered: item.discountOrdered ?? 0,
            entryType,
            notes: item.notes ?? '',
            aliasCandidate,
            linkAlias: !!aliasCandidate && shouldLinkAlias(aliasCandidate, product, productLabel),
          };
        }),
      );
    }
  }, [activeCategories, open, initialItems, products]);

  const updateItem = (key: string, patch: Partial<DraftItem>) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        const next = { ...item, ...patch };
        if (patch.operationalCategoryId) {
          const category = activeCategories.find((entry) => entry.id === patch.operationalCategoryId);
          next.entryType = category?.destination === 'asset' ? 'asset' : category?.destination === 'uniform' ? 'uniform' : 'stock';
          next.operationalCategoryName = category?.name;
          next.productId = '';
          next.baseItemId = '';
          next.itemName = '';
          next.isRegistered = category?.destination !== 'asset';
          next.unit = category?.destination === 'asset' ? 'un' : '';
          next.purchaseUnitType = 'content';
        }
        if (patch.isRegistered != null) {
          next.productId = '';
          next.baseItemId = '';
          next.itemName = '';
          next.unit = patch.isRegistered ? '' : 'un';
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
            next.itemName = getProductFullName(product);
            next.purchaseUnitType = purchaseUnitType;
            next.unit = purchaseUnitLabel;
            next.linkAlias = shouldLinkAlias(next.aliasCandidate, product, next.itemName);
          }
        }
        return next;
      }),
    );
  };

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

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.quantityOrdered * item.unitPriceOrdered - item.discountOrdered, 0),
    [items],
  );

  const validItems = items.filter((item) => {
    const category = activeCategories.find((entry) => entry.id === item.operationalCategoryId);
    const hasItem =
      category?.destination === 'asset'
        ? item.itemName.trim().length > 0
        : item.isRegistered
          ? !!item.baseItemId
          : item.itemName.trim().length > 0 && item.unit.trim().length > 0;
    return !!category && hasItem && item.quantityOrdered > 0 && item.unitPriceOrdered > 0;
  });

  const handleSave = async () => {
    if (validItems.length === 0) return;
    setSubmitting(true);
    try {
      const aliasUpdates = new Map<string, { product: Product; aliases: string[] }>();
      validItems
        .filter((item) => item.linkAlias && item.productId && item.aliasCandidate.trim())
        .forEach((item) => {
          const product = products.find((entry) => entry.id === item.productId);
          if (!product || !shouldLinkAlias(item.aliasCandidate, product, getProductFullName(product))) return;
          const current = aliasUpdates.get(product.id) ?? { product, aliases: [] };
          const alias = item.aliasCandidate.trim();
          if (!current.aliases.some((existing) => normalizeSearchText(existing) === normalizeSearchText(alias))) {
            current.aliases.push(alias);
          }
          aliasUpdates.set(product.id, current);
        });

      await updateOrder(orderId, {
        items: validItems.map((item) => ({
          baseItemId: item.baseItemId,
          productId: item.productId || undefined,
          itemName: item.itemName || undefined,
          operationalCategoryId: item.operationalCategoryId,
          operationalCategoryName: item.operationalCategoryName,
          itemDestination: item.entryType,
          unit: item.unit,
          purchaseUnitType: item.purchaseUnitType,
          purchaseUnitLabel: item.unit,
          quantityOrdered: item.quantityOrdered,
          unitPriceOrdered: item.unitPriceOrdered,
          discountOrdered: item.discountOrdered,
          entryType: item.entryType,
          notes: item.notes || undefined,
        })),
      });
      await Promise.all(
        [...aliasUpdates.values()].map(({ product, aliases }) =>
          updateProduct({
            ...product,
            aliases: [...(product.aliases ?? []), ...aliases],
          }),
        ),
      );
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error('Error updating items:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gerenciar itens do pedido</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">
              Apenas itens com quantidade e preço serão salvos.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => setItems((prev) => [...prev, newDraftItem()])}>
              <Plus className="mr-2 h-4 w-4" />
              Adicionar item
            </Button>
          </div>

          <div className="space-y-3">
            {items.map((item) => {
              const selectedCategory = activeCategories.find((category) => category.id === item.operationalCategoryId);
              const categoryDestination = selectedCategory?.destination;
              const availableProducts = categoryDestination
                ? purchasableProducts.filter((option) => {
                    const product = products.find((entry) => entry.id === option.id);
                    if (categoryDestination === 'uniform') return product?.operationalDestination === 'uniform';
                    return product?.operationalCategoryId === selectedCategory.id || (!product?.operationalCategoryId && categoryDestination === 'stock');
                  })
                : [];

              return (
              <div key={item.key} className="grid grid-cols-1 md:grid-cols-[150px_1fr_90px_100px_110px_90px_36px] gap-2 items-end rounded-md border p-3 bg-muted/20">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-semibold text-muted-foreground">Categoria</label>
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
                  <label className="text-[10px] uppercase font-semibold text-muted-foreground">
                    {categoryDestination === 'asset' ? 'Patrimônio' : 'Insumo'}
                  </label>
                  {categoryDestination === 'asset' ? (
                    <Input
                      placeholder="Ex: Máquina de sorvete"
                      value={item.itemName}
                      onChange={(event) => updateItem(item.key, { itemName: event.target.value })}
                    />
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 rounded-md border bg-background p-0.5">
                        <Button
                          type="button"
                          variant={item.isRegistered ? 'default' : 'ghost'}
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => updateItem(item.key, { isRegistered: true })}
                        >
                          Cadastrado
                        </Button>
                        <Button
                          type="button"
                          variant={!item.isRegistered ? 'default' : 'ghost'}
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => updateItem(item.key, { isRegistered: false })}
                        >
                          Não cadastrado
                        </Button>
                      </div>
                      {item.isRegistered ? (
                        <ProductCombobox
                          value={item.productId}
                          onChange={(value) => updateItem(item.key, { productId: value })}
                          options={availableProducts}
                        />
                      ) : (
                        <Input
                          placeholder="Digite o nome do item"
                          value={item.itemName}
                          onChange={(event) => updateItem(item.key, { itemName: event.target.value })}
                        />
                      )}
                      {item.isRegistered && item.productId && item.aliasCandidate.trim() && (
                        <label className="flex items-start gap-2 rounded-md border bg-background/70 p-2 text-xs text-muted-foreground">
                          <Checkbox
                            checked={item.linkAlias}
                            onCheckedChange={(checked) => updateItem(item.key, { linkAlias: checked === true })}
                          />
                          <span>
                            Salvar <span className="font-medium text-foreground">{item.aliasCandidate}</span> como alias deste cadastro.
                          </span>
                        </label>
                      )}
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-semibold text-muted-foreground">Un.</label>
                  {(() => {
                    const selectedProduct = purchasableProducts.find((option) => option.id === item.productId);
                    if (categoryDestination === 'asset') {
                      return <Input value="un" readOnly className="bg-muted" />;
                    }
                    if (!item.isRegistered) {
                      return (
                        <Input
                          placeholder="un"
                          value={item.unit}
                          onChange={(event) => updateItem(item.key, { unit: event.target.value, purchaseUnitType: 'content' })}
                        />
                      );
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
                    return <Input value={item.unit} readOnly className="bg-muted" />;
                  })()}
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-semibold text-muted-foreground">Qtd.</label>
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
                  <label className="text-[10px] uppercase font-semibold text-muted-foreground">Preço unit.</label>
                  <CurrencyInput
                    value={item.unitPriceOrdered}
                    onChange={(value) => updateItem(item.key, { unitPriceOrdered: value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-semibold text-muted-foreground">Desc.</label>
                  <CurrencyInput
                    value={item.discountOrdered}
                    onChange={(value) => updateItem(item.key, { discountOrdered: value })}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setItems((prev) => prev.filter((current) => current.key !== item.key))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <div className="md:col-span-6 md:col-start-2 space-y-1">
                   <Input 
                     placeholder="Observações do item..." 
                     className="text-xs h-8"
                     value={item.notes}
                     onChange={(e) => updateItem(item.key, { notes: e.target.value })}
                   />
                   {categoryDestination === 'asset' && (
                     <p className="text-xs text-muted-foreground">
                       No recebimento, cada unidade vira um patrimônio individual com etiqueta.
                     </p>
                   )}
                </div>
              </div>
            );
            })}
          </div>
        </div>

        <DialogFooter className="items-center sm:justify-between gap-3 border-t pt-4">
          <p className="text-sm font-semibold">
            Subtotal estimado: {total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={submitting || validItems.length === 0}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar alterações
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
