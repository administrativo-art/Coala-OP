
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, RotateCcw, CornerDownLeft, Box, Check, Copy, AlertTriangle } from 'lucide-react';
import { convertValue, units, type UnitCategory } from '@/lib/conversion';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';

import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { type LotEntry, type Kiosk, type BaseProduct, type RepositionItem } from '@/types';
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

export function RestockSuggestionModal({ suggestionResult, targetKiosk, onOpenChange, onStage }: RestockSuggestionModalProps) {
  const { lots } = useExpiryProducts();
  const { products, getProductFullName } = useProducts();
  const [isProcessing, setIsProcessing] = useState(false);

  const getUnitsPerPackage = (product: Product, baseProduct: BaseProduct): number => {
    try {
        if (product.secondaryUnit && typeof product.secondaryUnitValue === 'number' && product.secondaryUnitValue > 0) {
            let secondaryUnitCategory: UnitCategory | undefined;
            for (const category in units) {
                if (Object.keys(units[category as UnitCategory]).includes(product.secondaryUnit)) {
                    secondaryUnitCategory = category as UnitCategory;
                    break;
                }
            }
            if (!secondaryUnitCategory) return 0;
            return convertValue(product.secondaryUnitValue, product.secondaryUnit, baseProduct.unit, secondaryUnitCategory);
        }
        return convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
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
      quantityNeeded: suggestionResult.restockNeeded,
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
  
  const handleQuickAction = (index: number, action: 'fill' | 'max') => {
    const lotId = form.getValues(`items.${index}.lotId`);
    const lot = lots.find(l => l.id === lotId);
    if (!lot) return;
    const product = products.find(p => p.id === lot.productId);
    if (!product) return;
    
    const unitsPerPackage = getUnitsPerPackage(product, suggestionResult.baseProduct);
    if (unitsPerPackage === 0) return;

    const availablePackages = lot.quantity - (lot.reservedQuantity || 0);
    const availableInBase = availablePackages * unitsPerPackage;

    if (action === 'max') {
        form.setValue(`items.${index}.quantityInBaseUnit`, availableInBase);
    } else if (action === 'fill') {
        const currentFieldValue = form.getValues(`items.${index}.quantityInBaseUnit`) || 0;
        const currentTotalMinusThisField = totalSuggestedInBaseUnit - currentFieldValue;
        const currentRemaining = Math.max(0, suggestionResult.restockNeeded - currentTotalMinusThisField);
        const amountToFill = Math.min(availableInBase, currentRemaining);
        form.setValue(`items.${index}.quantityInBaseUnit`, amountToFill);
    }
  };

  const progress = suggestionResult.restockNeeded > 0 ? (totalSuggestedInBaseUnit / suggestionResult.restockNeeded) * 100 : 0;
  
  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Sugestão de reposição para {targetKiosk.name}</DialogTitle>
          <DialogDescription>
            Ajuste a sugestão para <strong>{suggestionResult.baseProduct.name}</strong> antes de adicionar à atividade de reposição.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 text-center text-sm py-2">
            <div className="p-2 bg-muted rounded-md"><p className="text-muted-foreground">Necessário</p><p className="font-bold text-lg">{formatNumberDisplay(suggestionResult.restockNeeded)} {suggestionResult.baseProduct.unit}</p></div>
            <div className="p-2 bg-muted rounded-md"><p className="text-muted-foreground">Selecionado</p><p className="font-bold text-lg">{formatNumberDisplay(totalSuggestedInBaseUnit)} {suggestionResult.baseProduct.unit}</p></div>
            <div className={cn("p-2 rounded-md", remainingNeeded > 0 ? "bg-red-500/10" : "bg-green-500/10")}>
                <p className={cn(remainingNeeded > 0 ? "text-red-600" : "text-green-600")}>Falta</p>
                <p className={cn("font-bold text-lg", remainingNeeded > 0 ? "text-red-600" : "text-green-600")}>{formatNumberDisplay(remainingNeeded)} {suggestionResult.baseProduct.unit}</p>
            </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-auto pr-2">
              <ScrollArea className="h-full">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Lote da Matriz</TableHead>
                            <TableHead className="w-[250px]">Qtd. a Mover ({suggestionResult.baseProduct.unit})</TableHead>
                            <TableHead className="w-20 text-right"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {fields.map((field, index) => {
                            const lot = lots.find(l => l.id === field.lotId);
                            if (!lot) return null;
                            const product = products.find(p => p.id === lot.productId);
                            if (!product) return null;
                            
                            const unitsPerPackage = getUnitsPerPackage(product, suggestionResult.baseProduct);
                            const quantityInPackages = unitsPerPackage > 0 ? (watchedItems[index]?.quantityInBaseUnit || 0) / unitsPerPackage : 0;
                            const logisticQty = (product.multiplo_caixa && product.multiplo_caixa > 0)
                                ? quantityInPackages / product.multiplo_caixa
                                : null;
                            
                            return (
                                <TableRow key={field.id}>
                                    <TableCell>
                                        <p className="font-semibold">{product.baseName} - {lot.lotNumber}</p>
                                        <p className="text-xs text-muted-foreground">Validade: {lot.expiryDate ? format(new Date(lot.expiryDate), 'dd/MM/yyyy') : 'N/A'}</p>
                                        <p className="text-xs text-muted-foreground">Disponível (lote): {formatNumberDisplay(lot.quantity - (lot.reservedQuantity || 0))} {product.packageType || 'pct'}</p>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                        <FormField
                                            control={form.control}
                                            name={`items.${index}.quantityInBaseUnit`}
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormControl>
                                                        <Input 
                                                            type="number" {...field} 
                                                            className="bg-background w-32"
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                         <div className="flex flex-col text-xs text-muted-foreground">
                                            <span>≈ {formatNumberDisplay(quantityInPackages)} {product.packageType || 'pct'}</span>
                                            {logisticQty !== null && product.rotulo_caixa && (
                                                <span>≈ {formatNumberDisplay(logisticQty)} {product.rotulo_caixa}(s)</span>
                                            )}
                                            <span className="italic">({formatNumberDisplay(unitsPerPackage)} {suggestionResult.baseProduct.unit}/{product.packageType || 'pct'})</span>
                                         </div>
                                        </div>
                                         <div className="flex gap-1 mt-1">
                                            <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={() => handleQuickAction(index, 'fill')}>Preencher</Button>
                                            <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={() => handleQuickAction(index, 'max')}>Máx</Button>
                                            <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={() => form.setValue(`items.${index}.quantityInBaseUnit`, 0)}>Limpar</Button>
                                         </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                         <Button type="button" variant="outline" size="sm" onClick={() => remove(index)}>Remover</Button>
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>

                {availableLotsToAdd.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-dashed">
                    <h4 className="font-semibold mb-2">Adicionar outro lote</h4>
                    <Table>
                       <TableHeader>
                           <TableRow>
                               <TableHead>Lote</TableHead>
                               <TableHead>Validade</TableHead>
                               <TableHead>Disponível (lote)</TableHead>
                               <TableHead></TableHead>
                           </TableRow>
                       </TableHeader>
                       <TableBody>
                           {availableLotsToAdd.map(lot => {
                             const product = products.find(p => p.id === lot.productId)!;
                             return (
                               <TableRow key={lot.id}>
                                   <TableCell>{getProductFullName(product)} - {lot.lotNumber}</TableCell>
                                   <TableCell>{lot.expiryDate ? format(new Date(lot.expiryDate), 'dd/MM/yyyy') : 'N/A'}</TableCell>
                                   <TableCell>{lot.quantity - (lot.reservedQuantity || 0)} {product.packageType || 'pct'}</TableCell>
                                   <TableCell>
                                       <Button type="button" size="sm" variant="secondary" onClick={() => append({lotId: lot.id, quantityInBaseUnit: 0})}>Adicionar</Button>
                                   </TableCell>
                               </TableRow>
                             )
                           })}
                       </TableBody>
                    </Table>
                  </div>
                )}
              </ScrollArea>
            </div>
            <DialogFooter className="pt-4 border-t flex-col sm:flex-row sm:justify-between items-center shrink-0">
                <div className="w-full sm:w-1/2">
                    <Progress value={progress} indicatorClassName={progress > 100 ? 'bg-destructive' : 'bg-primary'} />
                    <p className="text-xs text-center mt-1 text-muted-foreground">{formatNumberDisplay(totalSuggestedInBaseUnit)} de {formatNumberDisplay(suggestionResult.restockNeeded)} {suggestionResult.baseProduct.unit} selecionados.</p>
                    {progress > 100 && <p className="text-xs text-center text-destructive font-semibold">A quantidade selecionada excede a necessidade.</p>}
                </div>
                <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button type="submit" disabled={isProcessing || remainingNeeded > 0}>
                        {isProcessing ? "Adicionando..." : "Adicionar à reposição"}
                    </Button>
                </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
