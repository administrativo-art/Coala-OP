
"use client";

import { useState } from 'react';
import { useReposition } from '@/hooks/use-reposition';
import { type RepositionActivity } from '@/types';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FileText, Loader2, Send, AlertTriangle } from 'lucide-react';

const receiptSchema = z.object({
  status: z.enum(['ok', 'divergence'], { required_error: "Selecione uma opção." }),
  notes: z.string().optional(),
}).refine(data => {
  if (data.status === 'divergence' && (!data.notes || data.notes.trim() === '')) {
    return false;
  }
  return true;
}, {
  message: 'As notas são obrigatórias em caso de divergência.',
  path: ['notes'],
});

type ReceiptFormValues = z.infer<typeof receiptSchema>;

interface ReceiptModalProps {
  activity: RepositionActivity;
  onOpenChange: (open: boolean) => void;
}

export function ReceiptModal({ activity, onOpenChange }: ReceiptModalProps) {
    const { updateRepositionActivity } = useReposition();
    const [isLoading, setIsLoading] = useState(false);

    const form = useForm<ReceiptFormValues>({
        resolver: zodResolver(receiptSchema),
        defaultValues: { status: undefined, notes: '' },
    });
    
    const watchStatus = form.watch('status');

    const handleConfirmReceipt = async (values: ReceiptFormValues) => {
        setIsLoading(true);
        const newStatus = values.status === 'ok' ? 'Recebido sem divergência' : 'Recebido com divergência';
        
        await updateRepositionActivity(activity.id, {
            status: newStatus,
            receiptNotes: values.notes,
        });

        setIsLoading(false);
        onOpenChange(false);
    }

    return (
        <Dialog open={true} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Confirmar recebimento</DialogTitle>
                    <DialogDescription>
                        Confirme o recebimento dos itens de {activity.kioskOriginName}.
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh] p-1">
                    <div className="py-4 space-y-4 pr-4">
                        <div className="space-y-2">
                             {activity.items.map((item, index) => (
                                <div key={index} className="p-3 border rounded-md bg-muted/50">
                                    <p className="font-semibold">{item.productName}</p>
                                    <ul className="list-disc pl-5 mt-1 text-sm">
                                        {item.suggestedLots.map(lot => (
                                            <li key={lot.lotId}>
                                                {lot.quantityToMove}x {lot.productName} (Lote: {lot.lotId.slice(-6)})
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                        <Form {...form}>
                            <form id="receipt-form" onSubmit={form.handleSubmit(handleConfirmReceipt)} className="space-y-4 pt-4 border-t">
                                <FormField
                                    control={form.control}
                                    name="status"
                                    render={({ field }) => (
                                        <FormItem className="space-y-3">
                                            <Label>O recebimento está correto?</Label>
                                            <FormControl>
                                                <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex gap-4">
                                                    <FormItem className="flex items-center space-x-3 space-y-0">
                                                        <FormControl><RadioGroupItem value="ok" /></FormControl>
                                                        <Label className="font-normal">Sim, tudo correto</Label>
                                                    </FormItem>
                                                    <FormItem className="flex items-center space-x-3 space-y-0">
                                                        <FormControl><RadioGroupItem value="divergence" /></FormControl>
                                                        <Label className="font-normal">Não, há uma divergência</Label>
                                                    </FormItem>
                                                </RadioGroup>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                {watchStatus === 'divergence' && (
                                    <FormField
                                        control={form.control}
                                        name="notes"
                                        render={({ field }) => (
                                            <FormItem>
                                                <Label htmlFor="notes">Detalhes da Divergência</Label>
                                                <FormControl>
                                                    <Textarea id="notes" placeholder="Descreva o que está faltando, sobrando ou danificado." {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}
                            </form>
                        </Form>
                    </div>
                </ScrollArea>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                        Cancelar
                    </Button>
                    <Button type="submit" form="receipt-form" disabled={isLoading}>
                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                        {isLoading ? "Confirmando..." : "Confirmar recebimento"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
