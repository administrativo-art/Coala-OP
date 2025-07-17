
"use client";

import { useState, useRef } from 'react';
import SignatureCanvas from 'react-signature-canvas';
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
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Loader2, Send, Eraser, Signature } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from './ui/textarea';

const auditLotSchema = z.object({
  lotId: z.string(),
  productId: z.string(),
  productName: z.string(),
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
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const sigCanvas = useRef<SignatureCanvas>(null);

  const form = useForm<AuditFormValues>({
    resolver: zodResolver(auditFormSchema),
    defaultValues: {
      items: activity.items.map(item => ({
        baseProductId: item.baseProductId,
        productName: item.productName,
        suggestedLots: item.suggestedLots.map(lot => ({
          ...lot,
          receivedQuantity: '' as any, // Start with an empty field
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
    if (!user || sigCanvas.current?.isEmpty()) {
        toast({ variant: 'destructive', title: 'Assinatura obrigatória', description: 'Por favor, assine para confirmar o recebimento.' });
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
        dataUrl: sigCanvas.current.toDataURL('image/png'),
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
  
  const clearSignature = () => {
    sigCanvas.current?.clear();
  };
  
  const LotRow = ({ itemIndex, lotIndex }: { itemIndex: number, lotIndex: number }) => {
    const item = form.getValues().items[itemIndex];
    const lot = item.suggestedLots[lotIndex];
    const watchedReceivedQuantity = useWatch({
      control: form.control,
      name: `items.${itemIndex}.suggestedLots.${lotIndex}.receivedQuantity`
    });

    const hasDivergence = watchedReceivedQuantity !== '' && watchedReceivedQuantity !== undefined && parseFloat(watchedReceivedQuantity) !== lot.quantityToMove;

    return (
        <>
            <TableRow>
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
                        <Input type="number" {...field} className="text-center" placeholder="0" />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                    )}
                />
                </TableCell>
            </TableRow>
            {hasDivergence && (
                <TableRow>
                    <TableCell colSpan={3}>
                         <FormField
                            control={form.control}
                            name={`items.${itemIndex}.suggestedLots.${lotIndex}.receiptNotes`}
                            render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                <Textarea placeholder="Descreva a divergência aqui (ex: 1 item quebrado, 1 faltando...)" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                            )}
                        />
                    </TableCell>
                </TableRow>
            )}
        </>
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
            <ScrollArea className="flex-1 pr-4">
              <div className="space-y-4">
                {fields.map((item, itemIndex) => (
                  <div key={item.id} className="p-4 border rounded-lg">
                    <h3 className="font-semibold text-lg mb-2">{item.productName}</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Lote</TableHead>
                          <TableHead className="text-center w-[120px]">Qtd. enviada</TableHead>
                          <TableHead className="text-center w-[120px]">Qtd. recebida</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {item.suggestedLots.map((lot, lotIndex) => (
                           <LotRow key={lot.lotId} itemIndex={itemIndex} lotIndex={lotIndex} />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
                 <div className="p-4 border rounded-lg space-y-2">
                    <Label className="flex items-center gap-2 font-semibold text-lg"><Signature/> Assinatura do recebedor</Label>
                    <div className="rounded-md border bg-background">
                        <SignatureCanvas
                        ref={sigCanvas}
                        penColor="black"
                        canvasProps={{ className: "w-full h-[150px]" }}
                        />
                    </div>
                     <Button variant="ghost" size="sm" onClick={clearSignature} className="text-xs -mt-1">
                        <Eraser className="mr-1 h-3 w-3" /> Limpar
                    </Button>
                </div>
              </div>
            </ScrollArea>
            <DialogFooter className="pt-4 border-t mt-auto">
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
