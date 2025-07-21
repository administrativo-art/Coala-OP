
"use client";

import { useState, useMemo, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
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
import { type LotEntry, type StockAuditItem, type StockAuditSession } from '@/types';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Save, ListOrdered, Inbox, ShieldCheck, Check, X, Trash2, Loader2 } from 'lucide-react';
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { cn } from '@/lib/utils';

const auditItemSchema = z.object({
  countedQuantity: z.coerce.number().min(0, "A quantidade não pode ser negativa."),
  notes: z.string().optional(),
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
  
  const form = useForm<AuditFormValues>({
    resolver: zodResolver(zod.object({ items: z.array(auditItemSchema) })),
    defaultValues: { items: session.items.map(i => ({ countedQuantity: i.countedQuantity, notes: i.notes || '' })) }
  });

  const { fields } = useFieldArray({ control: form.control, name: 'items' });

  const handleSave = async (values: AuditFormValues) => {
    setIsSaving(true);
    const updatedItems = session.items.map((item, index) => ({
      ...item,
      countedQuantity: values.items[index].countedQuantity,
      notes: values.items[index].notes,
      difference: values.items[index].countedQuantity - item.systemQuantity,
    }));
    await onSave(updatedItems);
    setIsSaving(false);
  };
  
  const handleFinalizeClick = async () => {
    setIsFinalizing(true);
    const values = form.getValues();
    const updatedItems = session.items.map((item, index) => ({
      ...item,
      countedQuantity: values.items[index].countedQuantity,
      notes: values.items[index].notes,
      difference: values.items[index].countedQuantity - item.systemQuantity,
    }));
    await onFinalize(updatedItems);
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
                        <div className="space-y-4">
                            {fields.map((field, index) => {
                                const item = session.items[index];
                                const product = products.find(p => p.id === item.productId);
                                const watchedItem = watchedItems[index];
                                const hasDivergence = watchedItem.countedQuantity !== item.systemQuantity;

                                return (
                                    <div key={item.lotId} className="space-y-2 p-3 border rounded-lg bg-muted/30">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {/* Card 1: Product Info */}
                                            <Card className="p-4 flex gap-4 items-center">
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
                                            </Card>

                                            {/* Card 2: Count Info */}
                                            <Card className="p-4 space-y-3">
                                                <div className="flex items-end gap-4">
                                                    <div className="flex-1">
                                                        <Label>Sistema</Label>
                                                        <p className="text-2xl font-bold">{item.systemQuantity}</p>
                                                    </div>
                                                    <div className="flex-1">
                                                        <FormField control={form.control} name={`items.${index}.countedQuantity`} render={({ field }) => (
                                                            <FormItem>
                                                                <Label>Contado</Label>
                                                                <FormControl><Input type="number" {...field} className="text-lg font-bold h-11" /></FormControl>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}/>
                                                    </div>
                                                </div>
                                                <div>
                                                    {hasDivergence ? (
                                                         <FormField control={form.control} name={`items.${index}.notes`} render={({ field }) => (
                                                            <FormItem>
                                                                <Label>Observação (Obrigatório)</Label>
                                                                <FormControl><Textarea placeholder="Descreva o motivo da divergência..." {...field} /></FormControl>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}/>
                                                    ) : (
                                                        <div className="flex items-center gap-2 text-green-600 font-semibold p-2 bg-green-50 rounded-md">
                                                            <Check/> Quantidade OK
                                                        </div>
                                                    )}
                                                </div>
                                            </Card>
                                        </div>
                                    </div>
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

export function StockAuditManagement() {
  const { user } = useAuth();
  const { kiosks } = useKiosks();
  const { lots } = useExpiryProducts();
  const { products } = useProducts();
  const { addAuditSession, auditSessions, updateAuditSession, deleteAuditSession } = useStockAudit();
  const { adjustLotQuantity } = useExpiryProducts();
  const { toast } = useToast();
  
  const [activeSession, setActiveSession] = useState<StockAuditSession | null>(null);

  useEffect(() => {
    // Se uma sessão ativa for atualizada em outro lugar (ex: por outro admin),
    // atualizamos o estado local para refletir as mudanças.
    if (activeSession) {
      const updatedSession = auditSessions.find(s => s.id === activeSession.id);
      if (updatedSession) {
        setActiveSession(updatedSession);
      } else {
        // A sessão foi removida
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
      countedQuantity: lot.quantity,
      difference: 0,
      notes: '',
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
        // Imediatamente define a sessão ativa para renderizar o formulário
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
        if (item.difference !== 0) {
            await adjustLotQuantity(item.lotId, item.countedQuantity, activeSession.auditedBy);
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
                  {auditSessions.filter(s => s.status === 'pending_review').length === 0 ? (
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

    
