
"use client"

import { useState, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, ArrowRight } from 'lucide-react';
import { convertValue } from '@/lib/conversion';

import { useAuth } from '@/hooks/use-auth';
import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useToast } from '@/hooks/use-toast';
import { type LotEntry, type Kiosk, type BaseProduct } from '@/types';
import { type MoveLotParams } from './expiry-products-provider';
import { useReposition } from '@/hooks/use-reposition';

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
}

const moveItemSchema = z.object({
  lotId: z.string(),
  quantity: z.coerce.number().min(0, "A quantidade não pode ser negativa"),
});

const moveFormSchema = z.object({
  items: z.array(moveItemSchema)
});
type MoveFormValues = z.infer<typeof moveFormSchema>;

export function RestockSuggestionModal({ suggestionResult, targetKiosk, onOpenChange }: RestockSuggestionModalProps) {
  const { user } = useAuth();
  const { lots } = useExpiryProducts();
  const { products, getProductFullName } = useProducts();
  const { createRepositionActivity, loading } = useReposition();
  const { toast } = useToast();
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
        .sort((a,b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  }, [matrizLots, fields]);

  const watchedItems = form.watch('items');

  const totalSuggestedInBaseUnit = useMemo(() => {
    return watchedItems.reduce((total, currentItem) => {
        const lot = lots.find(l => l.id === currentItem.lotId);
        if (!lot) return total;
        
        const product = products.find(p => p.id === lot.productId);
        if (!product) return total;

        const quantityToMove = currentItem.quantity || 0;
        
        try {
            if (product.secondaryUnit && typeof product.secondaryUnitValue === 'number' && product.secondaryUnitValue > 0) {
                const secondaryUnitCategory = product.category === 'Unidade' ? 'Massa' : product.category === 'Embalagem' ? 'Unidade' : product.category;
                const valueOfOnePackageInBase = convertValue(product.secondaryUnitValue, product.secondaryUnit, suggestionResult.baseProduct.unit, secondaryUnitCategory);
                return total + (quantityToMove * valueOfOnePackageInBase);
            } 
            else if (product.category === suggestionResult.baseProduct.category) {
                 const valueOfOnePackageInBase = convertValue(product.packageSize, product.unit, suggestionResult.baseProduct.unit, product.category);
                 return total + (quantityToMove * valueOfOnePackageInBase);
            }
        } catch {
            return total; // Ignore if conversion fails
        }

        return total;
    }, 0);
  }, [watchedItems, lots, products, suggestionResult.baseProduct]);

  const onSubmit = async (values: MoveFormValues) => {
    if (!user) return;
    setIsProcessing(true);

    const repositionItem = {
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
          quantityToMove: item.quantity,
        };
      })
    };
    
    await createRepositionActivity({
      kioskOriginId: 'matriz',
      kioskOriginName: 'Centro de distribuição - Matriz',
      kioskDestinationId: targetKiosk.id,
      kioskDestinationName: targetKiosk.name,
      items: [repositionItem]
    });
    
    setIsProcessing(false);
    onOpenChange(false);
    toast({ title: "Atividade de Reposição Criada", description: "A solicitação foi salva e está aguardando despacho." });
  };

  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">Sugestão de Reposição</DialogTitle>
          <DialogDescription>
            Reposição de <strong>{suggestionResult.baseProduct.name}</strong> para o quiosque <strong>{targetKiosk.name}</strong>. Necessidade: {suggestionResult.restockNeeded.toLocaleString()} {suggestionResult.baseProduct.unit}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 overflow-hidden flex flex-col">
            <ScrollArea className="flex-1 pr-4">
              <div className="space-y-3">
                {fields.map((field, index) => {
                  const lot = lots.find(l => l.id === field.lotId);
                  if (!lot) return null;
                  const product = products.find(p => p.id === lot.productId);
                  if (!product) return null;
                  
                  return (
                    <div key={field.id} className="grid grid-cols-[1fr_auto_120px_auto] items-center gap-4 p-3 border rounded-lg bg-muted/50">
                      <div>
                        <p className="font-semibold">{getProductFullName(product)}</p>
                        <p className="text-sm text-muted-foreground">Lote: {lot.lotNumber} | Val: {format(new Date(lot.expiryDate), 'dd/MM/yyyy', {locale: ptBR})}</p>
                         <p className="text-xs text-muted-foreground">Disponível na Matriz: {lot.quantity} {product.unit}(s)</p>
                      </div>
                       <ArrowRight className="h-4 w-4 text-muted-foreground"/>
                      <FormField
                        control={form.control}
                        name={`items.${index}.quantity`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl><Input type="number" {...field} max={lot.quantity} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => remove(index)}><Trash2 className="h-4 w-4"/></Button>
                    </div>
                  );
                })}
              </div>

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
            <DialogFooter className="pt-4 border-t flex-col sm:flex-row sm:justify-between items-center">
                <div className="text-sm font-semibold">
                    Total a ser movido:
                    <span className="text-primary ml-2">{totalSuggestedInBaseUnit.toLocaleString()} / {suggestionResult.restockNeeded.toLocaleString()} {suggestionResult.baseProduct.unit}</span>
                </div>
                <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button type="submit" disabled={isProcessing || loading}>{isProcessing || loading ? "Salvando..." : "Salvar Reposição"}</Button>
                </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
