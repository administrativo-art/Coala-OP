
"use client";

import { useState, useMemo } from 'react';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ImageIcon, Plus, Trash2 } from 'lucide-react';
import { convertValue, units, type UnitCategory } from '@/lib/conversion';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';

import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { type LotEntry, type Kiosk, type BaseProduct, type RepositionItem, type Product, type RepositionRequestedProduct } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

interface SuggestedLot {
    lot: LotEntry;
    quantityToMove: number;
}
interface AnalysisResult {
  baseProduct: BaseProduct;
  suggestion?: SuggestedLot[];
  restockNeeded: number;
}
interface RestockSuggestionModalProps {
  suggestionResult: AnalysisResult;
  targetKiosk: Kiosk;
  requestedProducts?: RepositionRequestedProduct[];
  onOpenChange: (open: boolean) => void;
  onStage: (item: RepositionItem) => void;
}

const moveItemSchema = z.object({
  lotId: z.string(),
  quantityInBaseUnit: z.coerce.number().min(0, "A quantidade não pode ser negativa."),
});

const moveFormSchema = z.object({
  items: z.array(moveItemSchema)
});
type MoveFormValues = z.infer<typeof moveFormSchema>;

const formatNumberDisplay = (value: number) => {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
};

export function RestockSuggestionModal({ suggestionResult, targetKiosk, requestedProducts, onOpenChange, onStage }: RestockSuggestionModalProps) {
  const { lots } = useExpiryProducts();
  const { products, getProductFullName } = useProducts();
  const [isProcessing, setIsProcessing] = useState(false);

  const getUnitsPerPackage = (product: Product, baseProduct: BaseProduct): number => {
    try {
        const packageSize = Number(product.packageSize);
        if (packageSize > 0) {
            return convertValue(packageSize, product.unit, baseProduct.unit, product.category);
        }

        if (product.unit?.toLowerCase() === baseProduct.unit?.toLowerCase()) {
            return 1;
        }

        if (["Unidade", "Embalagem", "Vestimenta"].includes(product.category)) {
            return 1;
        }

        return 0;
    } catch (e) {
        console.error(e);
        return 0;
    }
  };

  const form = useForm<MoveFormValues>({
    resolver: zodResolver(moveFormSchema),
    defaultValues: {
        items: suggestionResult.suggestion?.map(s => {
            const product = products.find(p => p.id === s.lot.productId);
            if (!product) return { lotId: s.lot.id, quantityInBaseUnit: 0 };
            
            const unitsPerPackage = getUnitsPerPackage(product, suggestionResult.baseProduct);
            const valueInBaseUnit = s.quantityToMove * unitsPerPackage;

            return { lotId: s.lot.id, quantityInBaseUnit: valueInBaseUnit };
        }) || [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'items',
  });
  
  const matrizLots = useMemo(() => {
    const productMap = new Map(products.map(p => [p.id, p]));
    return lots.filter(l => l.kioskId === 'matriz' && productMap.get(l.productId)?.baseProductId === suggestionResult.baseProduct.id);
  }, [lots, products, suggestionResult.baseProduct.id]);
  
  const availableLotsToAdd = useMemo(() => {
    const selectedLotIds = new Set(fields.map(f => f.lotId));
    return matrizLots.filter(l => !selectedLotIds.has(l.id) && l.quantity - (l.reservedQuantity || 0) > 0)
        .sort((a,b) => (a.expiryDate && b.expiryDate) ? new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime() : 0);
  }, [matrizLots, fields]);

  const watchedItems = useWatch({ control: form.control, name: 'items' });

  const totalSuggestedInBaseUnit = useMemo(() => {
    return watchedItems.reduce((total, currentItem) => total + (currentItem.quantityInBaseUnit || 0), 0);
  }, [watchedItems]);

  const remainingNeeded = useMemo(() => {
    return Math.max(0, suggestionResult.restockNeeded - totalSuggestedInBaseUnit);
  }, [suggestionResult.restockNeeded, totalSuggestedInBaseUnit]);

  const onSubmit = (values: MoveFormValues) => {
    setIsProcessing(true);

    const repositionItem: RepositionItem = {
      baseProductId: suggestionResult.baseProduct.id,
      productName: suggestionResult.baseProduct.name,
      quantityNeeded: values.items.reduce((total, item) => total + (item.quantityInBaseUnit || 0), 0),
      suggestedLots: values.items
        .filter(item => item.quantityInBaseUnit > 0)
        .map(item => {
            const lot = lots.find(l => l.id === item.lotId)!;
            const product = products.find(p => p.id === lot.productId)!;
            
            const unitsPerPackage = getUnitsPerPackage(product, suggestionResult.baseProduct);
            const packagesToMove = unitsPerPackage > 0 ? item.quantityInBaseUnit / unitsPerPackage : 0;
            
            return {
              lotId: item.lotId,
              productId: lot.productId,
              productName: getProductFullName(product),
              lotNumber: lot.lotNumber,
              quantityToMove: packagesToMove,
            };
        })
    };
    
    onStage(repositionItem);
  };
  
  const handleQuickAction = (index: number) => {
    const lotId = form.getValues(`items.${index}.lotId`);
    const lot = lots.find(l => l.id === lotId);
    if (!lot) return;
    const product = products.find(p => p.id === lot.productId);
    if (!product) return;
    
    const unitsPerPackage = getUnitsPerPackage(product, suggestionResult.baseProduct);
    if (unitsPerPackage === 0) return;

    const availablePackages = lot.quantity - (lot.reservedQuantity || 0);
    const availableInBase = availablePackages * unitsPerPackage;

    const currentFieldValue = form.getValues(`items.${index}.quantityInBaseUnit`) || 0;
    const currentTotalMinusThisField = totalSuggestedInBaseUnit - currentFieldValue;
    const currentRemaining = Math.max(0, suggestionResult.restockNeeded - currentTotalMinusThisField);
    const amountToFill = Math.min(availableInBase, currentRemaining);
    form.setValue(`items.${index}.quantityInBaseUnit`, amountToFill);
  };

  const progress = suggestionResult.restockNeeded > 0 ? (totalSuggestedInBaseUnit / suggestionResult.restockNeeded) * 100 : 0;
  
  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col overflow-hidden rounded-2xl p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-xl">Sugestão de reposição</DialogTitle>
          <DialogDescription>
            {targetKiosk.name.replace(/^Quiosque\s+/i, '')} · ajuste os lotes de <strong>{suggestionResult.baseProduct.name}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 px-5 py-4 text-center text-sm">
            <div className="rounded-xl border bg-muted/30 p-3">
                <p className="text-xs uppercase text-muted-foreground">Necessário</p>
                <p className="font-bold">{formatNumberDisplay(suggestionResult.restockNeeded)} {suggestionResult.baseProduct.unit}</p>
            </div>
            <div className="rounded-xl border bg-muted/30 p-3">
                <p className="text-xs uppercase text-muted-foreground">Selecionado</p>
                <p className="font-bold text-primary">{formatNumberDisplay(totalSuggestedInBaseUnit)} {suggestionResult.baseProduct.unit}</p>
            </div>
            <div className={cn("rounded-xl border p-3", remainingNeeded > 0 ? "border-destructive/20 bg-destructive/5" : "border-green-500/20 bg-green-500/10")}>
                <p className={cn("text-xs uppercase", remainingNeeded > 0 ? "text-destructive" : "text-green-700")}>Falta</p>
                <p className={cn("font-bold", remainingNeeded > 0 ? "text-destructive" : "text-green-700")}>{formatNumberDisplay(remainingNeeded)} {suggestionResult.baseProduct.unit}</p>
            </div>
        </div>

        {requestedProducts && requestedProducts.length > 0 && (() => {
          const withStock = requestedProducts.map((rp) => ({
            rp,
            hasStock: lots.some((l) => l.kioskId === 'matriz' && l.productId === rp.productId && (l.quantity - (l.reservedQuantity || 0)) > 0),
          }));
          const anyMissing = withStock.some((entry) => !entry.hasStock);
          return (
            <div className="border-t px-5 py-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Solicitado pela unidade</p>
              <ul className="space-y-1 text-sm">
                {withStock.map(({ rp, hasStock }) => (
                  <li key={rp.productId} className="flex items-center justify-between gap-2">
                    <span className="truncate">{rp.productName}</span>
                    <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                      {rp.packages.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} emb
                      {!hasStock && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">sem estoque</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {anyMissing && (
                <p className="mt-1.5 text-xs text-amber-700">
                  Sem estoque do solicitado — substitua por outro derivado do mesmo insumo base em “Outros lotes disponíveis”.
                </p>
              )}
            </div>
          );
        })()}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 overflow-hidden flex flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
                <div className="space-y-3">
                    {fields.map((field, index) => {
                        const lot = lots.find(l => l.id === field.lotId);
                        if (!lot) return null;
                        const product = products.find(p => p.id === lot.productId);
                        if (!product) return null;

                        const unitsPerPackage = getUnitsPerPackage(product, suggestionResult.baseProduct);
                        const quantityInPackages = unitsPerPackage > 0 ? (watchedItems[index]?.quantityInBaseUnit || 0) / unitsPerPackage : 0;
                        const availablePackages = lot.quantity - (lot.reservedQuantity || 0);
                        const imageUrl = lot.imageUrl || product.imageUrl;

                        const logisticQty = (product.multiplo_caixa && product.multiplo_caixa > 0)
                            ? quantityInPackages / product.multiplo_caixa
                            : null;

                        return (
                            <div key={field.id} className="rounded-xl border bg-background p-3">
                                <div className="grid gap-3 sm:grid-cols-[56px_1fr_auto] sm:items-center">
                                    <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-muted">
                                        {imageUrl ? (
                                            <img src={imageUrl} alt={getProductFullName(product)} className="h-full w-full object-cover" />
                                        ) : (
                                            <ImageIcon className="h-5 w-5 text-muted-foreground" />
                                        )}
                                    </div>

                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold">{getProductFullName(product)}</p>
                                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                            <span>Lote <strong className="text-foreground">{lot.lotNumber || "-"}</strong></span>
                                            <span>{lot.expiryDate ? `Vence em ${format(new Date(lot.expiryDate), 'dd/MM/yyyy')}` : "Validade indefinida"}</span>
                                            <span>Disponível: {formatNumberDisplay(availablePackages)} {product.packageType || 'un'}</span>
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-2 sm:w-48">
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="number"
                                                value={quantityInPackages % 1 !== 0 ? quantityInPackages.toFixed(2) : quantityInPackages}
                                                onChange={(e) => {
                                                    const newPackageQty = parseFloat(e.target.value) || 0;
                                                    const newBaseQty = newPackageQty * unitsPerPackage;
                                                    form.setValue(`items.${index}.quantityInBaseUnit`, newBaseQty, { shouldValidate: true });
                                                }}
                                                max={availablePackages}
                                                min={0}
                                                onWheel={(e) => (e.target as HTMLElement).blur()}
                                                onKeyDown={(e) => { if (['ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); } }}
                                                onFocus={(e) => e.target.select()}
                                                className="h-9 bg-background text-right font-semibold"
                                            />
                                            <Label className="w-16 text-xs font-semibold text-muted-foreground">{product.packageType || 'un'}</Label>
                                        </div>
                                        <div className="text-right text-xs text-muted-foreground">
                                            <p>= {formatNumberDisplay(watchedItems[index]?.quantityInBaseUnit || 0)} {suggestionResult.baseProduct.unit}</p>
                                            {logisticQty !== null && product.rotulo_caixa && (
                                                <p>= {formatNumberDisplay(logisticQty)} {product.rotulo_caixa}</p>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-3 flex flex-wrap justify-between gap-2 border-t pt-2">
                                    <div className="flex gap-1">
                                        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => handleQuickAction(index)}>Preencher</Button>
                                        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => form.setValue(`items.${index}.quantityInBaseUnit`, 0)}>Limpar</Button>
                                    </div>
                                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => remove(index)}>
                                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                                        Remover
                                    </Button>
                                </div>
                            </div>
                        )
                    })}
                </div>

                {availableLotsToAdd.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-dashed">
                    <h4 className="mb-2 text-sm font-semibold">Outros lotes disponíveis</h4>
                    <div className="space-y-2">
                        {availableLotsToAdd.map(lot => {
                            const product = products.find(p => p.id === lot.productId)!;
                            const imageUrl = lot.imageUrl || product.imageUrl;
                            return (
                                <div key={lot.id} className="flex items-center gap-3 rounded-xl border bg-muted/20 p-2">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background">
                                        {imageUrl ? (
                                            <img src={imageUrl} alt={getProductFullName(product)} className="h-full w-full object-cover" />
                                        ) : (
                                            <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">{getProductFullName(product)}</p>
                                        <p className="truncate text-xs text-muted-foreground">
                                            Lote {lot.lotNumber || "-"} · {lot.expiryDate ? format(new Date(lot.expiryDate), 'dd/MM/yyyy') : 'validade indefinida'} · {lot.quantity - (lot.reservedQuantity || 0)} {product.packageType || 'un'} disponíveis
                                        </p>
                                    </div>
                                    <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={() => append({lotId: lot.id, quantityInBaseUnit: 0})}>
                                        <Plus className="mr-1 h-3.5 w-3.5" />
                                        Adicionar
                                    </Button>
                                </div>
                            )
                        })}
                    </div>
                  </div>
                )}
            </div>
            <DialogFooter className="shrink-0 border-t bg-muted/20 px-5 py-4">
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="w-full sm:w-1/2">
                    <Progress value={progress} indicatorClassName={progress > 100 ? 'bg-destructive' : 'bg-primary'} />
                    <p className="mt-1 text-xs text-muted-foreground">{formatNumberDisplay(totalSuggestedInBaseUnit)} de {formatNumberDisplay(suggestionResult.restockNeeded)} {suggestionResult.baseProduct.unit} selecionados.</p>
                    {progress > 100 && <p className="text-xs text-center text-destructive font-semibold">A quantidade selecionada excede a necessidade.</p>}
                </div>
                <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button type="submit" disabled={isProcessing || totalSuggestedInBaseUnit <= 0}>
                        {isProcessing ? "Adicionando..." : "Adicionar à reposição"}
                    </Button>
                </div>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
