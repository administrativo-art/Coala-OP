

"use client";

import { useState, useMemo, useEffect } from 'react';
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Image from 'next/image';
import { format, parseISO } from 'date-fns';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useProducts } from '@/hooks/use-products';
import { useStockAudit } from '@/hooks/use-stock-audit';
import { useToast } from '@/hooks/use-toast';
import { type StockAuditItem, type StockAuditSession, type StockAuditDivergence } from '@/types';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Save, ListOrdered, Inbox, ShieldCheck, Check, Trash2, Loader2, PlusCircle } from 'lucide-react';
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { cn } from '@/lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Separator } from './ui/separator';

const DIVERGENCE_REASONS = [
    "Contagem errada",
    "Avariado",
    "Vencido",
    "Outros"
];

const divergenceSchema = z.object({
    id: z.string(),
    reason: z.string().min(1, "Selecione um motivo."),
    quantity: z.coerce.number().min(0.01, "A quantidade deve ser maior que 0."),
    notes: z.string().optional(),
}).refine(data => {
    if (data.reason === 'Outros' && (!data.notes || data.notes.trim() === '')) {
        return false;
    }
    return true;
}, {
    message: "A observação é obrigatória para 'Outros'.",
    path: ["notes"],
});

const auditItemSchema = z.object({
    productId: z.string(),
    lotId: z.string(),
    systemQuantity: z.number(),
    divergences: z.array(divergenceSchema),
});

const auditFormSchema = z.object({
  items: z.array(auditItemSchema)
});

type AuditFormValues = z.infer<typeof auditFormSchema>;

function AuditForm({
  session,
  onSave,
  onFinalize,
  onCancel,
}: {
  session: StockAuditSession,
  onSave: (items: StockAuditItem[]) => Promise<void>,
  onFinalize: (items: StockAuditItem[]) => Promise<void>,
  onCancel: () => Promise<void>,
}) {
  const { products } = useProducts();
  const [isCancelling, setIsCancelling] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const { toast } = useToast();
  
  const form = useForm<AuditFormValues>({
    resolver: zodResolver(auditFormSchema),
    defaultValues: {
      items: session.items.map(i => ({
        productId: i.productId,
        lotId: i.lotId,
        systemQuantity: i.systemQuantity,
        divergences: i.divergences || [],
      })),
    },
  });

  const { fields } = useFieldArray({ control: form.control, name: 'items' });

  const getUpdatedItems = (values: AuditFormValues): StockAuditItem[] => {
    return session.items.map((originalItem, index) => ({
      ...originalItem,
      divergences: values.items[index].divergences,
    }));
  };

  const handleSave = async (values: AuditFormValues) => {
    setIsSaving(true);
    await onSave(getUpdatedItems(values));
    setIsSaving(false);
  };
  
  const handleFinalizeClick = async () => {
    const isValid = await form.trigger();
    if (!isValid) {
      toast({
          variant: "destructive",
          title: "Campos obrigatórios",
          description: "Por favor, preencha o motivo e a quantidade de todas as divergências."
      });
      return;
    }
    
    setIsFinalizing(true);
    await onFinalize(getUpdatedItems(form.getValues()));
    setIsFinalizing(false);
  };

  const handleCancelClick = async () => {
      setIsCancelling(true);
      await onCancel();
      setIsCancelling(false);
  }

  const watchedItems = form.watch('items');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auditoria em {session.kioskName}</CardTitle>
        <CardDescription>Auditoria iniciada por {session.auditedBy.username} em {format(parseISO(session.startedAt), 'dd/MM/yyyy HH:mm')}</CardDescription>
      </CardHeader>
        <Form {...form}>
            <form>
                <CardContent>
                    <ScrollArea className="h-[calc(80vh-250px)] pr-2">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {fields.map((field, index) => {
                                const item = session.items[index];
                                const product = products.find(p => p.id === item.productId);
                                const watchedDivergences = watchedItems[index]?.divergences || [];
                                const totalDivergenceQty = watchedDivergences.reduce((sum, div) => sum + (div.quantity || 0), 0);
                                const finalQuantity = item.systemQuantity - totalDivergenceQty;

                                return (
                                    <Card key={item.lotId} className="flex flex-col">
                                        <div className="p-4 flex gap-4 items-center">
                                            <div className="w-20 h-20 shrink-0">
                                                {product?.imageUrl ? (
                                                    <Image src={product.imageUrl} alt={item.productName} width={80} height={80} className="w-20 h-20 rounded-md object-cover" />
                                                ) : (
                                                    <div className="w-20 h-20 rounded-md bg-muted flex items-center justify-center"><ListOrdered className="h-8 w-8 text-muted-foreground" /></div>
                                                )}
                                            </div>
                                            <div className="space-y-1">
                                                <p className="font-semibold">{item.productName}</p>
                                                <p className="text-sm text-muted-foreground">Lote: {item.lotNumber}</p>
                                                <p className="text-sm text-muted-foreground">Val: {format(parseISO(item.expiryDate), 'dd/MM/yyyy')}</p>
                                            </div>
                                        </div>
                                        <Separator />
                                        <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                                            <div className="flex justify-between items-center bg-muted p-2 rounded-md">
                                                <span className="font-medium">Quantidade no sistema:</span>
                                                <span className="text-lg font-bold">{item.systemQuantity}</span>
                                            </div>
                                            
                                            <DivergenceSubForm
                                                itemIndex={index}
                                                control={form.control}
                                            />
                                            
                                            <div className="flex justify-between items-center bg-primary/10 text-primary font-bold p-2 rounded-md">
                                                <span>Saldo Final:</span>
                                                <span className="text-lg">{finalQuantity}</span>
                                            </div>
                                        </div>
                                    </Card>
                                );
                            })}
                        </div>
                    </ScrollArea>
                </CardContent>
                <CardContent>
                    <div className="flex justify-between items-center pt-4 border-t">
                    <Button type="button" variant="destructive" onClick={handleCancelClick} disabled={isCancelling || isSaving || isFinalizing}>
                        <Trash2 className="mr-2 h-4 w-4"/> {isCancelling ? 'Excluindo...' : 'Cancelar Auditoria'}
                    </Button>
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={form.handleSubmit(handleSave)} disabled={isSaving || isCancelling || isFinalizing}>
                            <Save className="mr-2 h-4 w-4"/> {isSaving ? 'Salvando...' : 'Salvar'}
                        </Button>
                        <DeleteConfirmationDialog 
                        open={false}
                        onOpenChange={() => {}}
                        onConfirm={handleFinalizeClick}
                        isDeleting={isFinalizing}
                        title="Tem certeza que quer efetivar?"
                        description="Esta ação é irreversível. O estoque será atualizado com as quantidades contadas. Deseja continuar?"
                        confirmButtonText={isFinalizing ? 'Efetivando...' : 'Sim, efetivar auditoria'}
                        triggerButton={<Button type="button"><Check className="mr-2 h-4 w-4"/> Efetivar Auditoria</Button>}
                        />
                    </div>
                    </div>
                </CardContent>
            </form>
        </Form>
    </Card>
  )
}

function DivergenceItem({ itemIndex, divIndex, control, onRemove }: { itemIndex: number; divIndex: number; control: any; onRemove: () => void; }) {
    const watchedReason = useWatch({ control, name: `items.${itemIndex}.divergences.${divIndex}.reason` });
  
    return (
      <div className="p-3 border rounded-md space-y-2">
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-start">
          <FormField control={control} name={`items.${itemIndex}.divergences.${divIndex}.quantity`} render={({ field: qtyField }) => (
            <FormItem><FormLabel className="text-xs">Quantidade</FormLabel><FormControl><Input type="number" {...qtyField} /></FormControl><FormMessage /></FormItem>
          )}/>
          <FormField control={control} name={`items.${itemIndex}.divergences.${divIndex}.reason`} render={({ field: reasonField }) => (
            <FormItem><FormLabel className="text-xs">Motivo</FormLabel>
                <Select onValueChange={reasonField.onChange} value={reasonField.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                    <SelectContent>{DIVERGENCE_REASONS.map(reason => <SelectItem key={reason} value={reason}>{reason}</SelectItem>)}</SelectContent>
                </Select><FormMessage />
            </FormItem>
          )}/>
          <div className="pt-7">
            <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={onRemove}><Trash2 className="h-4 w-4"/></Button>
          </div>
        </div>
        {watchedReason === 'Outros' && (
          <FormField control={control} name={`items.${itemIndex}.divergences.${divIndex}.notes`} render={({ field: notesField }) => (
            <FormItem><FormLabel className="text-xs">Observação para "Outros"</FormLabel><FormControl><Textarea {...notesField} /></FormControl><FormMessage /></FormItem>
          )}/>
        )}
      </div>
    );
}
  

function DivergenceSubForm({ itemIndex, control }: { itemIndex: number, control: any }) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `items.${itemIndex}.divergences`,
  });

  const addNewDivergence = () => {
    append({ id: `div-${Date.now()}`, reason: '', quantity: 0, notes: '' });
  };

  return (
    <div className="space-y-2">
      <Label>Contagens / Divergências</Label>
      {fields.map((field, divIndex) => (
        <DivergenceItem
          key={field.id}
          itemIndex={itemIndex}
          divIndex={divIndex}
          control={control}
          onRemove={() => remove(divIndex)}
        />
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addNewDivergence} className="w-full">
        <PlusCircle className="mr-2 h-4 w-4"/> Adicionar contagem/divergência
      </Button>
    </div>
  );
}

export function StockAuditManagement() {
  const { user } = useAuth();
  const { kiosks } = useKiosks();
  const { lots } = useExpiryProducts();
  const { products } = useProducts();
  const { addAuditSession, auditSessions, updateAuditSession, deleteAuditSession, loading } = useStockAudit();
  const { adjustLotQuantity } = useExpiryProducts();
  const { toast } = useToast();
  
  const [activeSession, setActiveSession] = useState<StockAuditSession | null>(null);

  useEffect(() => {
    if (activeSession) {
      const updatedSession = auditSessions.find(s => s.id === activeSession.id);
      if (updatedSession) {
        setActiveSession(updatedSession);
      } else {
        setActiveSession(null);
      }
    }
  }, [auditSessions, activeSession]);


  const handleStartSession = async (kioskId: string) => {
    if (!user) return;
    
    const kiosk = kiosks.find(k => k.id === kioskId);
    if(!kiosk) return;
    
    const productMap = new Map(products.map(p => [p.id, p]));

    const kioskLots = lots.filter(l => {
        const product = productMap.get(l.productId);
        return l.kioskId === kioskId && l.quantity > 0 && product && !product.isArchived;
    });

    const auditItems: StockAuditItem[] = kioskLots.map(lot => ({
      productId: lot.productId,
      productName: lot.productName,
      lotId: lot.id,
      lotNumber: lot.lotNumber,
      expiryDate: lot.expiryDate,
      systemQuantity: lot.quantity,
      divergences: [],
    }));

    const newSessionId = await addAuditSession({
      kioskId: kiosk.id,
      kioskName: kiosk.name,
      status: 'pending_review',
      auditedBy: { userId: user.id, username: user.username },
      startedAt: new Date().toISOString(),
      items: auditItems,
    });

    if (newSessionId) {
        const createdSession = {
            id: newSessionId,
            kioskId: kiosk.id,
            kioskName: kiosk.name,
            status: 'pending_review' as const,
            auditedBy: { userId: user.id, username: user.username },
            startedAt: new Date().toISOString(),
            items: auditItems,
        };
        setActiveSession(createdSession);
    }
  };

  const handleSaveForReview = async (items: StockAuditItem[]) => {
    if(!activeSession) return;
    await updateAuditSession(activeSession.id, { items });
    toast({ title: 'Progresso salvo!', description: 'Sua auditoria foi salva. Você pode continuar depois.' });
    setActiveSession(null);
  }

  const handleFinalize = async (items: StockAuditItem[]) => {
    if(!activeSession) return;

    for (const item of items) {
        const totalDivergenceQty = item.divergences.reduce((sum, div) => sum + div.quantity, 0);
        const finalQuantity = item.systemQuantity - totalDivergenceQty;
        if (item.systemQuantity !== finalQuantity) {
            await adjustLotQuantity(item.lotId, finalQuantity, activeSession.auditedBy);
        }
    }
    
    await updateAuditSession(activeSession.id, {
        items,
        status: 'completed',
        completedAt: new Date().toISOString(),
    });
    
    toast({ title: 'Auditoria efetivada!', description: 'O estoque foi ajustado com sucesso.' });
    setActiveSession(null);
  };
  
  const handleCancelAudit = async () => {
    if (!activeSession) return;
    await deleteAuditSession(activeSession.id);
    toast({ variant: 'destructive', title: 'Auditoria cancelada', description: 'A sessão de auditoria pendente foi removida.' });
    setActiveSession(null);
  }

  if (activeSession) {
    return <AuditForm session={activeSession} onSave={handleSaveForReview} onFinalize={handleFinalize} onCancel={handleCancelAudit} />;
  }

  return (
      <Card>
          <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck/> Auditoria de Estoque</CardTitle>
              <CardDescription>Inicie uma nova auditoria ou continue uma sessão salva para revisão.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
              <div>
                  <h3 className="font-semibold mb-2">Iniciar Nova Auditoria</h3>
                  <div className="flex gap-2">
                      <Select onValueChange={handleStartSession}>
                          <SelectTrigger className="w-[250px]"><SelectValue placeholder="Selecione um quiosque..." /></SelectTrigger>
                          <SelectContent>{kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent>
                      </Select>
                  </div>
              </div>

              <div className="space-y-2 pt-4 border-t">
                  <h3 className="font-semibold">Auditorias Salvas para Revisão</h3>
                  {loading ? (
                       <Skeleton className="h-24 w-full" />
                  ) : auditSessions.filter(s => s.status === 'pending_review').length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhuma auditoria pendente.</p>
                  ) : (
                      auditSessions.filter(s => s.status === 'pending_review').map(session => (
                          <div key={session.id} className="p-3 border rounded-md flex justify-between items-center">
                              <div>
                                  <p className="font-medium">Auditoria em {session.kioskName}</p>
                                  <p className="text-xs text-muted-foreground">Iniciada por {session.auditedBy.username} em {format(parseISO(session.startedAt), 'dd/MM/yy HH:mm')}</p>
                              </div>
                              <Button variant="outline" onClick={() => setActiveSession(session)}>Continuar Auditoria</Button>
                          </div>
                      ))
                  )}
              </div>
          </CardContent>
      </Card>
  );
}
