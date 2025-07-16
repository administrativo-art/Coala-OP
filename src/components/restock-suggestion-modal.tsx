
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
import { Separator } from '@/components/ui/separator';
import { Trash2, PlusCircle, Wand2, ArrowRight } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useToast } from '@/hooks/use-toast';
import { type LotEntry, type Kiosk, type BaseProduct } from '@/types';
import { type MoveLotParams } from './expiry-products-provider';

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
  const { lots, moveMultipleLots } = useExpiryProducts();
  const { getProductFullName } = useProducts();
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
  
  const matrizLots = useMemo(() => lots.filter(l => l.kioskId === 'matriz' && l.productId.startsWith(suggestionResult.baseProduct.id)), [lots, suggestionResult.baseProduct.id]);
  const availableLotsToAdd = useMemo(() => {
    const selectedLotIds = new Set(fields.map(f => f.lotId));
    return matrizLots.filter(l => !selectedLotIds.has(l.id) && l.quantity > 0)
        .sort((a,b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  }, [matrizLots, fields]);


  const onSubmit = async (values: MoveFormValues) => {
    if (!user) return;
    setIsProcessing(true);

    const moveParams: MoveLotParams[] = [];
    for (const item of values.items) {
      if (item.quantity > 0) {
        const lot = lots.find(l => l.id === item.lotId);
        if (lot) {
          moveParams.push({
            lotId: lot.id,
            productId: lot.productId,
            toKioskId: targetKiosk.id,
            fromKioskId: 'matriz',
            quantityToMove: item.quantity,
            fromKioskName: "Centro de distribuição - Matriz",
            toKioskName: targetKiosk.name,
            movedByUserId: user.id,
            movedByUsername: user.username,
            productName: getProductFullName(lot as any), // Assuming lot has product info
            lotNumber: lot.lotNumber
          });
        }
      }
    }

    try {
        await moveMultipleLots(moveParams);
        toast({ title: "Transferência confirmada!", description: "O estoque foi movimentado com sucesso." });
        onOpenChange(false);
    } catch (error: any) {
        toast({ variant: "destructive", title: "Erro na transferência", description: error.message || "Não foi possível mover o estoque." });
    } finally {
        setIsProcessing(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wand2/> Sugestão de Reposição</DialogTitle>
          <DialogDescription>
            Reposição de <strong>{suggestionResult.baseProduct.name}</strong> para o quiosque <strong>{targetKiosk.name}</strong>.
            Necessidade: {suggestionResult.restockNeeded.toLocaleString()} {suggestionResult.baseProduct.unit}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 overflow-hidden flex flex-col">
            <ScrollArea className="flex-1 pr-4">
              <div className="space-y-3">
                {fields.map((field, index) => {
                  const lot = lots.find(l => l.id === field.lotId);
                  if (!lot) return null;
                  return (
                    <div key={field.id} className="grid grid-cols-[1fr_auto_120px_auto] items-center gap-4 p-3 border rounded-lg bg-muted/50">
                      <div>
                        <p className="font-semibold">{getProductFullName(lot as any)}</p>
                        <p className="text-sm text-muted-foreground">Lote: {lot.lotNumber} | Val: {format(new Date(lot.expiryDate), 'dd/MM/yyyy', {locale: ptBR})}</p>
                         <p className="text-xs text-muted-foreground">Disponível na Matriz: {lot.quantity}</p>
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
                            {availableLotsToAdd.map(lot => (
                                <SelectItem key={lot.id} value={lot.id}>
                                    {getProductFullName(lot as any)} (Lote: {lot.lotNumber}, Qtd: {lot.quantity})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
              </div>
            </ScrollArea>
            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={isProcessing}>{isProcessing ? "Processando..." : "Confirmar e Mover Estoque"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
