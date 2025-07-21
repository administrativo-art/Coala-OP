
"use client";

import { useState, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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
import { Save, ListOrdered, Inbox, PlusCircle, UserCheck, ShieldCheck, Check, Search } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog';

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
  onFinalize
}: {
  session: StockAuditSession,
  onSave: (items: StockAuditItem[]) => Promise<void>,
  onFinalize: (items: StockAuditItem[]) => Promise<void>
}) {
  const { products, getProductFullName } = useProducts();
  
  const form = useForm<AuditFormValues>({
    resolver: zodResolver(auditFormSchema),
    defaultValues: { items: session.items.map(i => ({ countedQuantity: i.countedQuantity, notes: i.notes })) }
  });

  const { fields } = useFieldArray({ control: form.control, name: 'items' });

  const onSubmit = async (values: AuditFormValues) => {
    const updatedItems = session.items.map((item, index) => ({
      ...item,
      countedQuantity: values.items[index].countedQuantity,
      notes: values.items[index].notes,
      difference: values.items[index].countedQuantity - item.systemQuantity,
    }));
    await onSave(updatedItems);
  };
  
  const handleFinalizeClick = async () => {
    const values = form.getValues();
    const updatedItems = session.items.map((item, index) => ({
      ...item,
      countedQuantity: values.items[index].countedQuantity,
      notes: values.items[index].notes,
      difference: values.items[index].countedQuantity - item.systemQuantity,
    }));
    await onFinalize(updatedItems);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auditoria em {session.kioskName}</CardTitle>
        <CardDescription>Auditoria iniciada por {session.auditedBy.username} em {format(parseISO(session.startedAt), 'dd/MM/yyyy HH:mm')}</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent>
            <ScrollArea className="h-[50vh] pr-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto/Lote</TableHead>
                    <TableHead className="text-center">Sistema</TableHead>
                    <TableHead className="w-[120px]">Contagem</TableHead>
                    <TableHead className="w-[150px]">Observações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {session.items.map((item, index) => (
                    <TableRow key={item.lotId}>
                      <TableCell>
                        <p className="font-semibold">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">Lote: {item.lotNumber} | Val: {format(parseISO(item.expiryDate), 'dd/MM/yy')}</p>
                      </TableCell>
                      <TableCell className="text-center">{item.systemQuantity}</TableCell>
                      <TableCell>
                        <FormField control={form.control} name={`items.${index}.countedQuantity`} render={({ field }) => (
                          <FormItem><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                        )}/>
                      </TableCell>
                      <TableCell>
                         <FormField control={form.control} name={`items.${index}.notes`} render={({ field }) => (
                          <FormItem><FormControl><Input placeholder="..." {...field} /></FormControl><FormMessage /></FormItem>
                        )}/>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
          <CardContent>
            <div className="flex justify-end gap-2">
              <Button type="submit" variant="outline"><Save className="mr-2 h-4 w-4"/> Salvar para revisar</Button>
              <DeleteConfirmationDialog 
                open={false}
                onOpenChange={() => {}}
                onConfirm={handleFinalizeClick}
                title="Efetivar Auditoria?"
                description="Esta ação é irreversível. O estoque será atualizado com as quantidades contadas. Deseja continuar?"
                confirmButtonText="Sim, efetivar auditoria"
                triggerButton={<Button><Check className="mr-2 h-4 w-4"/> Efetivar Auditoria</Button>}
              />
            </div>
          </CardContent>
        </form>
      </Form>
    </Card>
  )
}

export function StockAuditManagement() {
  const { user, permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { lots } = useExpiryProducts();
  const { addAuditSession, auditSessions, updateAuditSession } = useStockAudit();
  const { adjustLotQuantity } = useExpiryProducts();
  const { toast } = useToast();
  
  const [activeSession, setActiveSession] = useState<StockAuditSession | null>(null);

  const handleStartSession = async (kioskId: string) => {
    if (!user) return;
    
    const kiosk = kiosks.find(k => k.id === kioskId);
    if(!kiosk) return;
    
    const kioskLots = lots.filter(l => l.kioskId === kioskId && l.quantity > 0);

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
        // This is a bit of a hack to get the session object immediately.
        // A better solution would be for addAuditSession to return the full object.
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

  if (!activeSession) {
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
  
  return <AuditForm session={activeSession} onSave={handleSaveForReview} onFinalize={handleFinalize} />;
}
