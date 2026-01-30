"use client";

import { useState, useRef, useEffect, useMemo } from 'react';
import { useReposition } from '@/hooks/use-reposition';
import { useAuth } from '@/hooks/use-auth';
import { type RepositionActivity, type RepositionItem, type SignatureData } from '@/types';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Loader2, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from './ui/textarea';
import { useProducts } from '@/hooks/use-products';
import Image from 'next/image';

const auditLotSchema = z.object({
  lotId: z.string(),
  productId: z.string(),
  productName: z.string(),
  lotNumber: z.string(),
  quantityToMove: z.number(),
  receivedQuantity: z.coerce.number().min(0, "A quantidade deve ser positiva."),
  receiptNotes: z.string().optional(),
}).refine((data) => {
    if (data.receivedQuantity !== data.quantityToMove && (!data.receiptNotes || data.receiptNotes.trim() === '')) {
        return false;
    }
    return true;
}, {
    message: "A nota é obrigatória se a quantidade for diferente.",
    path: ["receiptNotes"],
});

const auditItemSchema = z.object({
  baseProductId: z.string(),
  productName: z.string(),
  suggestedLots: z.array(auditLotSchema),
});

const auditFormSchema = z.object({
  items: z.array(auditItemSchema),
});

type AuditFormValues = z.infer<typeof auditFormSchema>;

interface AuditReceiptModalProps {
  activity: RepositionActivity;
  onOpenChange: (open: boolean) => void;
}

export function AuditReceiptModal({ activity, onOpenChange }: AuditReceiptModalProps) {
  const { updateRepositionActivity } = useReposition();
  const { user } = useAuth();
  const { products } = useProducts();
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<AuditFormValues>({
    resolver: zodResolver(auditFormSchema),
    defaultValues: {
      items: activity.items.map(item => ({
        baseProductId: item.baseProductId,
        productName: item.productName,
        suggestedLots: item.suggestedLots.map(lot => ({
          ...lot,
          receivedQuantity: lot.quantityToMove,
          receiptNotes: '',
        })),
      })),
    },
  });
  
  const { fields } = useFieldArray({
    control: form.control,
    name: "items"
  });

  const handleConfirmReceipt = async (values: AuditFormValues) => {
    if (!user) {
        toast({ variant: 'destructive', title: 'Erro de autenticação', description: 'É necessário estar logado.' });
        return;
    }
    setIsLoading(true);

    let hasDivergence = false;
    for (const item of values.items) {
        for (const lot of item.suggestedLots) {
            if (lot.receivedQuantity !== lot.quantityToMove) {
                hasDivergence = true;
                break;
            }
        }
        if (hasDivergence) break;
    }
    
    const receivedItems: RepositionItem[] = values.items.map((item, itemIndex) => {
        const originalItem = activity.items[itemIndex];
        const receivedLots = item.suggestedLots.map((lot, lotIndex) => {
            return {
                ...originalItem.suggestedLots[lotIndex],
                receivedQuantity: lot.receivedQuantity,
                receiptNotes: lot.receiptNotes,
            }
        })
        return {
            ...originalItem,
            receivedLots,
        };
    });
    
    const newStatus = hasDivergence ? 'Recebido com divergência' : 'Recebido sem divergência';
    
    const signature: SignatureData = {
        signedBy: user.username,
        signedAt: new Date().toISOString()
    };
    
    await updateRepositionActivity(activity.id, {
        status: newStatus,
        items: receivedItems,
        receiptSignature: signature,
    });

    toast({
        title: "Recebimento confirmado!",
        description: `O status da atividade foi atualizado para: ${newStatus}.`,
    });

    setIsLoading(false);
    onOpenChange(false);
  };
  
  function LotRow({ itemIndex, lotIndex }: { itemIndex: number; lotIndex: number; }) {
    const lot = useWatch({ control: form.control, name: `items.${itemIndex}.suggestedLots.${lotIndex}` });
    const product = useMemo(() => products.find(p => p.id === lot.productId), [products, lot.productId]);
  
    const receivedPackages = form.watch(`items.${itemIndex}.suggestedLots.${lotIndex}.receivedQuantity`) || 0;
  
    const logisticDisplay = (quantity: number) => {
      if (!product || !product.multiplo_caixa || product.multiplo_caixa <= 0 || !product.rotulo_caixa) return null;
  
      const fullBoxes = Math.floor(quantity / product.multiplo_caixa);
      const remainingItems = quantity % product.multiplo_caixa;
      
      let displayParts = [];
      if (fullBoxes > 0) displayParts.push(`${fullBoxes} ${product.rotulo_caixa}(s)`);
      if (remainingItems > 0 && product.packageType) displayParts.push(`${remainingItems} ${product.packageType}(s)`);
  
      return displayParts.join(' e ');
    };
    
    if (!product) {
        return (
            <TableRow>
                <TableCell colSpan={3}>
                    <p className="text-destructive">Produto não encontrado para lote {lot.lotNumber}</p>
                </TableCell>
            </TableRow>
        );
    }
  
    const sentLogistic = logisticDisplay(lot.quantityToMove);
    const receivedLogistic = logisticDisplay(receivedPackages);
  
    return (
      <TableRow>
          <TableCell colSpan={3}>
              <div className="flex gap-4 items-start">
                  {product.imageUrl && <Image src={product.imageUrl} alt={product.baseName} width={64} height={64} className="rounded-md object-cover"/>}
                  <div className="flex-grow space-y-3">
                      <div>
                          <p className="font-semibold">{lot.productName}</p>
                          <p className="text-xs text-muted-foreground">Lote: {lot.lotNumber}</p>
                      </div>
  
                      <div className="grid grid-cols-2 gap-4 items-start">
                          <div className="p-3 rounded-md border bg-muted/50">
                              <Label className="text-xs text-muted-foreground">Enviado</Label>
                              <p className="font-bold text-lg">{lot.quantityToMove} <span className="text-sm font-normal text-muted-foreground">{product.packageType}(s)</span></p>
                              {sentLogistic && <p className="text-xs text-muted-foreground">({sentLogistic})</p>}
                          </div>
                          
                          <div className="space-y-1">
                               <FormField
                                  control={form.control}
                                  name={`items.${itemIndex}.suggestedLots.${lotIndex}.receivedQuantity`}
                                  render={({ field }) => (
                                  <FormItem>
                                      <FormLabel className="text-xs">Recebido</FormLabel>
                                      <FormControl>
                                      <Input
                                          type="number"
                                          {...field}
                                          value={field.value ?? ''}
                                          className="text-center font-bold text-lg h-12"
                                          placeholder="0"
                                      />
                                      </FormControl>
                                      <FormMessage />
                                  </FormItem>
                                  )}
                              />
                              {receivedLogistic && <p className="text-xs text-muted-foreground text-center">({receivedLogistic})</p>}
                          </div>
                      </div>
  
                      <div className="mt-2">
                          <FormField
                              control={form.control}
                              name={`items.${itemIndex}.suggestedLots.${lotIndex}.receiptNotes`}
                              render={({ field }) => (
                              <FormItem>
                                  <FormControl>
                                  <Textarea placeholder="Observações de recebimento (obrigatório se houver divergência)" {...field} />
                                  </FormControl>
                                  <FormMessage />
                              </FormItem>
                              )}
                          />
                      </div>
                  </div>
              </div>
          </TableCell>
      </TableRow>
    )
  }

  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Auditar recebimento de reposição</DialogTitle>
          <DialogDescription>
            Confirme as quantidades recebidas de {activity.kioskOriginName} para {activity.kioskDestinationName}.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form id="audit-form" onSubmit={form.handleSubmit(handleConfirmReceipt)} className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-hidden">
                <ScrollArea className="h-full pr-4">
                <div className="space-y-4">
                    {fields.map((item, itemIndex) => (
                    <div key={item.id} className="p-4 border rounded-lg">
                        <h3 className="font-semibold text-lg mb-2">{item.productName}</h3>
                        <Table>
                          <TableBody>
                            {item.suggestedLots.map((lot, lotIndex) => (
                              <LotRow key={lot.lotId} itemIndex={itemIndex} lotIndex={lotIndex} />
                            ))}
                          </TableBody>
                        </Table>
                    </div>
                    ))}
                </div>
                </ScrollArea>
            </div>
            <DialogFooter className="pt-4 border-t shrink-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                Cancelar
              </Button>
              <Button type="submit" form="audit-form" disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                {isLoading ? "Confirmando..." : "Confirmar recebimento"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
