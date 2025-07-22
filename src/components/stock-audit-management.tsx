
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
import { Save, ListOrdered, Inbox, ShieldCheck, Check, Trash2, Loader2, PlusCircle, AlertTriangle, Download, History } from 'lucide-react';
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { cn } from '@/lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { ZeroedLotsAuditModal } from './zeroed-lots-audit-modal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Dialog, DialogClose } from './ui/dialog';


const DIVERGENCE_REASONS = [
    "Vencido",
    "Avariado",
    "Contagem errada",
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
    countedQuantity: z.coerce.number().min(0, "A contagem não pode ser negativa."),
    divergences: z.array(divergenceSchema),
});

const auditFormSchema = z.object({
  items: z.array(auditItemSchema)
}).refine(data => {
    // Check each item
    for (const item of data.items) {
        const difference = item.systemQuantity - item.countedQuantity;
        if (difference > 0) { // Only require justification if there's a shortfall
            const totalDivergenceQty = item.divergences.reduce((sum, div) => sum + (Number(div.quantity) || 0), 0);
            if (Math.abs(totalDivergenceQty - difference) > 0.001) { // Use a tolerance for float comparison
                return false; // The sum of divergences must match the total difference
            }
        }
    }
    return true;
}, {
    message: 'A soma das justificativas deve ser igual à diferença total.',
    // We can't specify a path here easily, so we'll handle showing a global error.
});

type AuditFormValues = z.infer<typeof auditFormSchema>;

function DivergenceItem({ itemIndex, divIndex, control, onRemove }: { itemIndex: number; divIndex: number; control: any; onRemove: () => void; }) {
    const watchedReason = useWatch({ control, name: `items.${itemIndex}.divergences.${divIndex}.reason` });
  
    return (
      <div className="p-3 border rounded-md space-y-2 bg-background">
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


function JustificationSection({ itemIndex, control, difference }: { itemIndex: number, control: any, difference: number }) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `items.${itemIndex}.divergences`,
  });

  const addNewDivergence = () => {
    append({ id: `div-${Date.now()}`, reason: '', quantity: 0, notes: '' });
  };
  
  const totalJustified = useWatch({ control, name: `items.${itemIndex}.divergences` }).reduce((sum: number, div: any) => sum + (Number(div.quantity) || 0), 0);
  const remainingToJustify = difference - totalJustified;

  return (
    <div className="mt-3 p-3 space-y-3 bg-red-500/10 rounded-lg border border-red-500/20">
      <div className="flex justify-between items-center">
        <div>
            <h4 className="font-semibold text-destructive flex items-center gap-2"><AlertTriangle className="h-4 w-4"/>Justificar divergência</h4>
            <p className="text-sm text-destructive/80">A soma das quantidades deve ser igual à diferença de {difference}.</p>
        </div>
        <div className="text-right">
            <p className="font-bold text-destructive">{remainingToJustify.toLocaleString(undefined, {maximumFractionDigits: 2})}</p>
            <p className="text-xs text-destructive/80">restante</p>
        </div>
      </div>
      <div className="space-y-2">
        {fields.map((field, divIndex) => (
          <DivergenceItem
            key={field.id}
            itemIndex={itemIndex}
            divIndex={divIndex}
            control={control}
            onRemove={() => remove(divIndex)}
          />
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={addNewDivergence} className="w-full">
        <PlusCircle className="mr-2 h-4 w-4"/> Adicionar justificativa
      </Button>
    </div>
  );
}

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
  const { products, getProductFullName } = useProducts();
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
        countedQuantity: i.countedQuantity,
        divergences: i.divergences || [],
      })),
    },
  });

  const { fields } = useFieldArray({ control: form.control, name: 'items' });

  const getUpdatedItems = (values: AuditFormValues): StockAuditItem[] => {
    return session.items.map((originalItem, index) => ({
      ...originalItem,
      countedQuantity: values.items[index].countedQuantity,
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
          title: "Dados inválidos",
          description: "Verifique os campos. A soma das justificativas deve ser igual à diferença total para cada item divergente."
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
                                const watchedItem = watchedItems[index];
                                const systemQty = item.systemQuantity;
                                const countedQty = watchedItem?.countedQuantity;
                                const difference = systemQty - countedQty;
                                const hasDivergence = Math.abs(difference) > 0.001;

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
                                                <p className="font-semibold">{product ? getProductFullName(product) : item.productName}</p>
                                                <p className="text-sm text-muted-foreground">Lote: {item.lotNumber}</p>
                                                <p className="text-sm text-muted-foreground">Val: {format(parseISO(item.expiryDate), 'dd/MM/yyyy')}</p>
                                            </div>
                                        </div>
                                        <Separator />
                                        <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="p-2 border rounded-md">
                                                    <Label className="text-xs text-muted-foreground">Sistema</Label>
                                                    <p className="text-lg font-bold">{systemQty}</p>
                                                </div>
                                                <FormField
                                                  control={form.control}
                                                  name={`items.${index}.countedQuantity`}
                                                  render={({ field }) => (
                                                    <FormItem>
                                                      <Label className="text-xs">Contado</Label>
                                                      <FormControl>
                                                        <Input
                                                          type="number"
                                                          {...field}
                                                        />
                                                      </FormControl>
                                                      <FormMessage />
                                                    </FormItem>
                                                  )}
                                                />
                                            </div>
                                            
                                            {hasDivergence ? (
                                                <JustificationSection itemIndex={index} control={form.control} difference={difference} />
                                            ) : (
                                                <div className="p-3 text-center rounded-lg bg-green-500/10 text-green-700 font-medium flex items-center justify-center gap-2">
                                                    <Check className="h-4 w-4"/> Quantidade OK
                                                </div>
                                            )}
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
                        <Trash2 className="mr-2 h-4 w-4"/> {isCancelling ? 'Excluindo...' : 'Cancelar auditoria'}
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
                        triggerButton={<Button type="button"><Check className="mr-2 h-4 w-4"/> Efetivar auditoria</Button>}
                        />
                    </div>
                    </div>
                </CardContent>
            </form>
        </Form>
    </Card>
  )
}

function AuditHistory() {
    const { auditSessions, deleteAuditSession, loading } = useStockAudit();
    const [sessionToDelete, setSessionToDelete] = useState<StockAuditSession | null>(null);
    const { permissions } = useAuth();

    const completedAudits = useMemo(() => {
        return auditSessions.filter(s => s.status === 'completed');
    }, [auditSessions]);
    
    const handleDeleteConfirm = () => {
        if(sessionToDelete) {
            deleteAuditSession(sessionToDelete.id);
            setSessionToDelete(null);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Histórico de auditorias</CardTitle>
                <CardDescription>Visualize todas as auditorias que foram concluídas.</CardDescription>
            </CardHeader>
            <CardContent>
                {loading ? <Skeleton className="h-40 w-full" /> : completedAudits.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                        <Inbox className="h-12 w-12 mx-auto mb-4" />
                        <p className="font-semibold">Nenhuma auditoria concluída.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {completedAudits.map(session => (
                            <div key={session.id} className="p-3 border rounded-md flex justify-between items-center">
                                <div>
                                    <p className="font-medium">{session.kioskName}</p>
                                    <p className="text-xs text-muted-foreground">Concluída por {session.auditedBy.username} em {session.completedAt ? format(parseISO(session.completedAt), 'dd/MM/yy HH:mm') : '-'}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Badge>Concluída</Badge>
                                    {permissions.audit.approve && (
                                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setSessionToDelete(session)}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
            <DeleteConfirmationDialog 
                open={!!sessionToDelete}
                onOpenChange={() => setSessionToDelete(null)}
                onConfirm={handleDeleteConfirm}
                itemName="esta auditoria"
                description="Esta ação é irreversível e excluirá permanentemente o registro da auditoria."
            />
        </Card>
    );
}

function KioskSelectionModal({
  open,
  onOpenChange,
  kiosks,
  onSelectKiosk,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kiosks: any[];
  onSelectKiosk: (kioskId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Iniciar nova auditoria</DialogTitle>
          <DialogDescription>Selecione o quiosque que você deseja auditar.</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-2">
          {kiosks.map((kiosk) => (
            <DialogClose key={kiosk.id} asChild>
                <Button
                variant="outline"
                className="w-full justify-start text-base py-6"
                onClick={() => onSelectKiosk(kiosk.id)}
                >
                {kiosk.name}
                </Button>
            </DialogClose>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function StockAuditManagement({ showExportButton = false }: { showExportButton?: boolean }) {
  const { user, permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { lots } = useExpiryProducts();
  const { products, getProductFullName } = useProducts();
  const { auditSessions, activeSession, setActiveSession, addAuditSession, updateAuditSession, deleteAuditSession, loading } = useStockAudit();
  const { adjustLotQuantity } = useExpiryProducts();
  const { toast } = useToast();
  
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isKioskSelectionOpen, setIsKioskSelectionOpen] = useState(false);

  const handleStartSession = async (kioskId: string) => {
    if (!user) return;
    
    const kiosk = kiosks.find(k => k.id === kioskId);
    if(!kiosk) return;
    
    const productMap = new Map(products.map(p => [p.id, p]));

    const kioskLots = lots.filter(l => {
        const product = productMap.get(l.productId);
        return l.kioskId === kioskId && l.quantity > 0 && product && !product.isArchived;
    });

    const auditItems: StockAuditItem[] = kioskLots.map(lot => {
        const product = productMap.get(lot.productId)!;
        return {
            productId: lot.productId,
            productName: getProductFullName(product),
            lotId: lot.id,
            lotNumber: lot.lotNumber,
            expiryDate: lot.expiryDate,
            systemQuantity: lot.quantity,
            countedQuantity: 0,
            divergences: [],
        }
    });

    const newSessionId = await addAuditSession({
      kioskId: kiosk.id,
      kioskName: kiosk.name,
      status: 'pending_review',
      auditedBy: { userId: user.id, username: user.username },
      startedAt: new Date().toISOString(),
      items: auditItems,
    });

    if (newSessionId) {
        const createdSession = auditSessions.find(s => s.id === newSessionId)
        if (createdSession) setActiveSession(createdSession);
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
        if (item.systemQuantity !== item.countedQuantity) {
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
  
  const pendingAudits = auditSessions.filter(s => s.status === 'pending_review');

  return (
    <>
        <Tabs defaultValue="active">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="active">Auditoria</TabsTrigger>
                <TabsTrigger value="history">Histórico</TabsTrigger>
            </TabsList>
            <TabsContent value="active" className="mt-4">
                <Card>
                    <CardHeader>
                        <div>
                            <CardTitle className="flex items-center gap-2"><ShieldCheck/> Auditoria de estoque</CardTitle>
                            <CardDescription>Inicie uma nova auditoria ou continue uma sessão salva para revisão.</CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <h3 className="font-semibold mb-2">Iniciar nova auditoria</h3>
                             <Button onClick={() => setIsKioskSelectionOpen(true)}>Iniciar auditoria</Button>
                        </div>

                        <div className="space-y-2 pt-4 border-t">
                            <h3 className="font-semibold">Auditorias salvas para revisão</h3>
                            {loading ? (
                                <Skeleton className="h-24 w-full" />
                            ) : pendingAudits.length === 0 ? (
                                <p className="text-sm text-muted-foreground">Nenhuma auditoria pendente.</p>
                            ) : (
                                pendingAudits.map(session => (
                                    <div key={session.id} className="p-3 border rounded-md flex justify-between items-center">
                                        <div>
                                            <p className="font-medium">Auditoria em {session.kioskName}</p>
                                            <p className="text-xs text-muted-foreground">Iniciada por {session.auditedBy.username} em {format(parseISO(session.startedAt), 'dd/MM/yy HH:mm')}</p>
                                        </div>
                                        <Button variant="outline" onClick={() => setActiveSession(session)}>Continuar auditoria</Button>
                                    </div>
                                ))
                            )}
                        </div>
                    </CardContent>
                    {showExportButton && (
                         <CardContent>
                             <div className="pt-4 border-t flex justify-end">
                                <Button variant="outline" onClick={() => setIsHistoryModalOpen(true)}>
                                    <Download className="mr-2" />
                                    Relatório detalhado
                                </Button>
                             </div>
                        </CardContent>
                    )}
                </Card>
            </TabsContent>
            <TabsContent value="history" className="mt-4">
                <AuditHistory />
            </TabsContent>
        </Tabs>
      <ZeroedLotsAuditModal
        open={isHistoryModalOpen}
        onOpenChange={setIsHistoryModalOpen}
      />
      <KioskSelectionModal
        open={isKioskSelectionOpen}
        onOpenChange={setIsKioskSelectionOpen}
        kiosks={kiosks}
        onSelectKiosk={handleStartSession}
      />
    </>
  );
}
