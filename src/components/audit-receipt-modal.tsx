
"use client";

import { useState } from 'react';
import { useReposition } from '@/hooks/use-reposition';
import { type RepositionActivity, type RepositionItem, type RepositionSuggestedLot } from '@/types';
import { useForm, useFieldArray } from 'react-hook-form';
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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Loader2, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const auditLotSchema = z.object({
  lotId: z.string(),
  productId: z.string(),
  productName: z.string(),
  quantityToMove: z.number(),
  receivedQuantity: z.coerce.number().min(0, "A quantidade deve ser positiva."),
});

const auditItemSchema = z.object({
  baseProductId: z.string(),
  productName: z.string(),
  suggestedLots: z.array(auditLotSchema),
});

const auditFormSchema = z.object({
  items: z.array(auditItemSchema),
  notes: z.string().optional(),
});

type AuditFormValues = z.infer<typeof auditFormSchema>;

interface AuditReceiptModalProps {
  activity: RepositionActivity;
  onOpenChange: (open: boolean) => void;
}

export function AuditReceiptModal({ activity, onOpenChange }: AuditReceiptModalProps) {
  const { updateRepositionActivity } = useReposition();
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
          receivedQuantity: lot.quantityToMove, // Default to expected quantity
        })),
      })),
      notes: '',
    },
  });

  const { fields } = useFieldArray({
    control: form.control,
    name: "items"
  });

  const handleConfirmReceipt = async (values: AuditFormValues) => {
    setIsLoading(true);

    let hasDivergence = false;
    const receivedItems: RepositionItem[] = values.items.map((item, itemIndex) => {
        const originalItem = activity.items[itemIndex];
        const receivedLots = item.suggestedLots.map((lot, lotIndex) => {
            if (lot.receivedQuantity !== lot.quantityToMove) {
                hasDivergence = true;
            }
            return {
                ...originalItem.suggestedLots[lotIndex], // Keep original data
                receivedQuantity: lot.receivedQuantity
            }
        })
        return {
            ...originalItem,
            receivedLots,
        };
    });
    
    if (hasDivergence && !values.notes?.trim()) {
        form.setError("notes", { message: "As notas são obrigatórias em caso de divergência." });
        setIsLoading(false);
        return;
    }
    
    const newStatus = hasDivergence ? 'Recebido com divergência' : 'Recebido sem divergência';
    
    await updateRepositionActivity(activity.id, {
        status: newStatus,
        receiptNotes: values.notes,
        items: receivedItems, // Save the received quantities
    });

    toast({
        title: "Recebimento confirmado!",
        description: `O status da atividade foi atualizado para: ${newStatus}.`,
    });

    setIsLoading(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Auditar Recebimento de Reposição</DialogTitle>
          <DialogDescription>
            Confirme as quantidades recebidas de {activity.kioskOriginName} para {activity.kioskDestinationName}.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form id="audit-form" onSubmit={form.handleSubmit(handleConfirmReceipt)} className="flex-1 overflow-hidden flex flex-col">
            <ScrollArea className="flex-1 pr-4">
              <div className="space-y-4">
                {fields.map((item, itemIndex) => (
                  <div key={item.id} className="p-4 border rounded-lg">
                    <h3 className="font-semibold text-lg mb-2">{item.productName}</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Lote</TableHead>
                          <TableHead className="text-center w-[120px]">Qtd. Enviada</TableHead>
                          <TableHead className="text-center w-[120px]">Qtd. Recebida</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {item.suggestedLots.map((lot, lotIndex) => (
                          <TableRow key={lot.lotId}>
                            <TableCell>
                              <p className="font-medium">{lot.productName}</p>
                              <p className="text-xs text-muted-foreground">Lote: {lot.lotId.slice(-8)}</p>
                            </TableCell>
                            <TableCell className="text-center">{lot.quantityToMove}</TableCell>
                            <TableCell>
                              <FormField
                                control={form.control}
                                name={`items.${itemIndex}.suggestedLots.${lotIndex}.receivedQuantity`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormControl>
                                      <Input type="number" {...field} className="text-center" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
                
                <div className="pt-4">
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <Label htmlFor="notes">Notas de Divergência (obrigatório se houver diferença)</Label>
                        <FormControl>
                          <Textarea id="notes" placeholder="Descreva o que está faltando, sobrando ou danificado." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </ScrollArea>
            <DialogFooter className="pt-4 border-t mt-auto">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                Cancelar
              </Button>
              <Button type="submit" form="audit-form" disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                {isLoading ? "Confirmando..." : "Confirmar Recebimento"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
