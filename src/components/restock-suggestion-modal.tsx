
"use client"

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, ArrowRight } from 'lucide-react';
import { convertValue, units } from '@/lib/conversion';
import { Label } from '@/components/ui/label';

import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { type LotEntry, type Kiosk, type BaseProduct, type RepositionItem, type UnitCategory, type RepositionSuggestedLot } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

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
  quantity: z.coerce.number().min(0, "A quantidade não pode ser negativa"),
});

const moveFormSchema = z.object({
  items: z.array(moveItemSchema)
});
type MoveFormValues = z.infer<typeof moveFormSchema>;

export function RestockSuggestionModal({ suggestionResult, targetKiosk, onOpenChange, onStage }: RestockSuggestionModalProps) {
  const { lots } = useExpiryProducts();
  const { products, getProductFullName } = useProducts();
  const [isProcessing, setIsProcessing] = useState(false);

  const form = useForm<MoveFormValues>({
    resolver: zodResolver(moveFormSchema),
    defaultValues: {
      items: suggestionResult.suggestion?.map(s => ({
        lotId: s.lot.id,
        quantity: s.quantityToMove,
      })) || [],
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
    return matrizLots.filter(l => !selectedLotIds.has(l.id) && l.quantity > 0)
        .sort((a,b) => (a.expiryDate && b.expiryDate) ? new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime() : 0);
  }, [matrizLots, fields]);

  const watchedItems = useWatch({ control: form.control, name: 'items' });

  const totalSuggestedInBaseUnit = useMemo(() => {
    return watchedItems.reduce((total, currentItem) => {
        const lot = lots.find(l => l.id === currentItem.lotId);
        if (!lot) return total;
        
        const product = products.find(p => p.id === lot.productId);
        if (!product) return total;

        const quantityToMove = currentItem.quantity || 0;
        
        try {
            let valueOfOnePackageInBase = 0;
            if (product.secondaryUnit && typeof product.secondaryUnitValue === 'number' && product.secondaryUnitValue > 0) {
                 let secondaryUnitCategory: UnitCategory | undefined;
                 for (const category in units) {
                    if (Object.keys(units[category as UnitCategory]).includes(product.secondaryUnit)) {
                        secondaryUnitCategory = category as UnitCategory;
                        break;
                    }
                 }
                if (!secondaryUnitCategory) return total;
                valueOfOnePackageInBase = convertValue(product.secondaryUnitValue, product.secondaryUnit, suggestionResult.baseProduct.unit, secondaryUnitCategory);
            } else if (suggestionResult.baseProduct.category === 'Unidade') {
                valueOfOnePackageInBase = product.packageSize;
            }
            else {
                valueOfOnePackageInBase = convertValue(product.packageSize, product.unit, suggestionResult.baseProduct.unit, product.category);
            }
            
            return total + (quantityToMove * valueOfOnePackageInBase);

        } catch {
            return total; // Ignore if conversion fails
        }
    }, 0);
  }, [watchedItems, lots, products, suggestionResult.baseProduct]);

  const onSubmit = (values: MoveFormValues) => {
    setIsProcessing(true);

    const repositionItem: RepositionItem = {
      baseProductId: suggestionResult.baseProduct.id,
      productName: suggestionResult.baseProduct.name,
      quantityNeeded: suggestionResult.restockNeeded,
      suggestedLots: values.items.map(item => {
        const lot = lots.find(l => l.id === item.lotId)!;
        const product = products.find(p => p.id === lot.productId)!;
        return {
          lotId: item.lotId,
          productId: lot.productId,
          productName: getProductFullName(product),
          lotNumber: lot.lotNumber,
          quantityToMove: item.quantity,
        };
      })
    };
    
    onStage(repositionItem);
    setIsProcessing(false);
  };
  
  const formatQuantity = (quantity: number, product: any): string => {
    if (product.multiplo_caixa && product.multiplo_caixa > 0 && product.rotulo_caixa) {
        const boxes = Math.floor(quantity / product.multiplo_caixa);
        const units = quantity % product.multiplo_caixa;
        let result = '';
        if (boxes > 0) result += `${boxes} ${product.rotulo_caixa}(s)`;
        if (units > 0) result += `${result ? ' + ' : ''}${units} un`;
        return result.trim() || `${quantity} un`;
    }
    return `${quantity} un`;
  };
  
  const formatAvailableStock = (quantity: number, product: any): string => {
      if (product.multiplo_caixa && product.multiplo_caixa > 0 && product.rotulo_caixa) {
        const boxes = Math.floor(quantity / product.multiplo_caixa);
        return `${quantity} unidades (${boxes} ${product.rotulo_caixa}(s))`;
    }
    return `${quantity} unidades`;
  }

  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">Sugestão de reposição</DialogTitle>
          <DialogDescription>
            Reposição de <strong>{suggestionResult.baseProduct.name}</strong> para o quiosque <strong>{targetKiosk.name}</strong>. Necessidade: {suggestionResult.restockNeeded.toLocaleString()} {suggestionResult.baseProduct.unit}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-auto pr-2">
              <ScrollArea className="h-full">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Insumo vinculado</TableHead>
                            <TableHead>Lote</TableHead>
                            <TableHead className="text-right">Quant. Estoque</TableHead>
                            <TableHead>Qtd. Mover (Pct)</TableHead>
                            <TableHead></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {fields.map((field, index) => {
                            const lot = lots.find(l => l.id === field.lotId);
                            if (!lot) return null;
                            const product = products.find(p => p.id === lot.productId);
                            if (!product) return null;
                            
                            let stockInBaseUnit = 0;
                            try {
                                stockInBaseUnit = convertValue(lot.quantity, product.unit, suggestionResult.baseProduct.unit, product.category);
                            } catch {}

                            return (
                                <TableRow key={field.id}>
                                    <TableCell>
                                        <p className="font-semibold">{getProductFullName(product)}</p>
                                    </TableCell>
                                    <TableCell>{lot.lotNumber}</TableCell>
                                    <TableCell className="text-right">{stockInBaseUnit.toLocaleString()} {suggestionResult.baseProduct.unit}</TableCell>
                                    <TableCell>
                                        <FormField
                                            control={form.control}
                                            name={`items.${index}.quantity`}
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormControl>
                                                        <Input 
                                                            type="number" {...field} 
                                                            max={lot.quantity - (lot.reservedQuantity || 0)} 
                                                            className="bg-background w-24"
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </TableCell>
                                    <TableCell>
                                         <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => remove(index)}><Trash2 className="h-4 w-4"/></Button>
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>

                <div className="mt-4 pt-4 border-t border-dashed">
                  <p className="font-semibold mb-2">Adicionar outro lote</p>
                  <div className="flex gap-2">
                      <Select onValueChange={(lotId) => append({ lotId, quantity: 1 })} disabled={availableLotsToAdd.length === 0}>
                          <SelectTrigger>
                              <SelectValue placeholder={availableLotsToAdd.length > 0 ? "Selecione um lote..." : "Nenhum outro lote disponível"} />
                          </SelectTrigger>
                          <SelectContent>
                              {availableLotsToAdd.map(lot => {
                                  const product = products.find(p => p.id === lot.productId);
                                  return (
                                  <SelectItem key={lot.id} value={lot.id}>
                                      {product ? getProductFullName(product) : 'Produto desconhecido'} (Lote: {lot.lotNumber}, Qtd: {lot.quantity})
                                  </SelectItem>
                              )})}
                          </SelectContent>
                      </Select>
                  </div>
                </div>
              </ScrollArea>
            </div>
            <DialogFooter className="pt-4 border-t flex-col sm:flex-row sm:justify-between items-center shrink-0">
                <div className="text-sm font-semibold">
                    Total a ser movido:
                    <span className="text-primary ml-2">{totalSuggestedInBaseUnit.toLocaleString(undefined, { maximumFractionDigits: 2 })} / {suggestionResult.restockNeeded.toLocaleString()} {suggestionResult.baseProduct.unit}</span>
                </div>
                <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button type="submit" disabled={isProcessing}>{isProcessing ? "Adicionando..." : "Adicionar à reposição"}</Button>
                </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
