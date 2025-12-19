
"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Image from 'next/image';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useProducts } from '@/hooks/use-products';
import { useStockAudit } from '@/hooks/use-stock-audit';
import { useToast } from '@/hooks/use-toast';
import { type StockAuditItem, type StockAuditSession, type MovementType, type LotEntry } from '@/types';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from './ui/skeleton';
import { ListOrdered, Inbox, ShieldCheck, Check, Trash2, Loader2, PlusCircle, AlertTriangle, Download, PackagePlus } from 'lucide-react';
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Separator } from './ui/separator';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RequestItemAdditionModal } from './request-item-addition-modal';

// --- Esquemas de Validação ---
const DIVERGENCE_REASONS: { value: MovementType, label: string }[] = [
    { value: 'SAIDA_CONSUMO', label: 'Consumo / Venda' },
    { value: 'SAIDA_DESCARTE_VENCIMENTO', label: 'Descarte por Vencimento' },
    { value: 'SAIDA_DESCARTE_AVARIA', label: 'Descarte por Avaria/Quebra' },
    { value: 'SAIDA_DESCARTE_PERDA', label: 'Descarte por Perda/Extravio' },
    { value: 'SAIDA_DESCARTE_OUTROS', label: 'Outros (especificar)'},
];

const divergenceSchema = z.object({
    id: z.string(),
    reason: z.string().min(1, "Selecione um motivo."),
    quantity: z.coerce.number().min(0.01, "A quantidade deve ser maior que 0."),
    notes: z.string().optional(),
});

const auditItemSchema = z.object({
    productId: z.string(),
    lotId: z.string(),
    systemQuantity: z.number(),
    finalQuantity: z.number(),
    adjustment: z.object({
        type: z.enum(['positive', 'negative']),
        quantity: z.coerce.number().min(0),
        notes: z.string().optional()
    }).optional(),
    divergences: z.array(divergenceSchema),
});

const auditFormSchema = z.object({
  items: z.array(auditItemSchema)
}).refine(data => {
    for (const item of data.items) {
        const adjQty = item.adjustment?.type === 'negative' ? -(Number(item.adjustment?.quantity) || 0) : (Number(item.adjustment?.quantity) || 0);
        const totalDiv = item.divergences.reduce((sum, div) => sum + (Number(div.quantity) || 0), 0);
        const calcFinal = item.systemQuantity + adjQty - totalDiv;
        if (Math.abs(calcFinal - item.finalQuantity) > 0.001) return false;
    }
    return true;
}, { message: 'O cálculo do estoque final não corresponde às saídas e ajustes.' });

type AuditFormValues = z.infer<typeof auditFormSchema>;

// --- Componentes Internos do Formulário ---

function JustificationSection({ itemIndex, control }: { itemIndex: number, control: any }) {
  const { fields, append, remove } = useFieldArray({ control, name: `items.${itemIndex}.divergences` });
  return (
    <div className="mt-3 p-3 space-y-3 bg-red-500/5 rounded-lg border border-red-500/10">
        <h4 className="font-semibold text-destructive/80 flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4"/>Registrar Saídas do Turno</h4>
        <div className="space-y-2">
            {fields.map((field, divIndex) => (
                <div key={field.id} className="p-3 border rounded-md space-y-2 bg-background relative shadow-sm">
                    <Button type="button" variant="ghost" size="icon" className="absolute top-1 right-1 text-destructive h-7 w-7" onClick={() => remove(divIndex)}><Trash2 className="h-4 w-4"/></Button>
                    <div className="grid grid-cols-2 gap-2">
                        <FormField control={control} name={`items.${itemIndex}.divergences.${divIndex}.quantity`} render={({ field }) => (
                            <FormItem><FormLabel className="text-[10px] uppercase font-bold text-muted-foreground">Qtd</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem>
                        )}/>
                        <FormField control={control} name={`items.${itemIndex}.divergences.${divIndex}.reason`} render={({ field }) => (
                            <FormItem><FormLabel className="text-[10px] uppercase font-bold text-muted-foreground">Motivo</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="..." /></SelectTrigger></FormControl>
                                    <SelectContent>{DIVERGENCE_REASONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                                </Select>
                            </FormItem>
                        )}/>
                    </div>
                     <FormField control={control} name={`items.${itemIndex}.divergences.${divIndex}.notes`} render={({ field }) => (
                        <FormItem><FormControl><Textarea {...field} placeholder="Observação (opcional)" rows={1} className="text-sm min-h-[38px]" /></FormControl></FormItem>
                    )}/>
                </div>
            ))}
        </div>
        <Button type="button" variant="outline" size="sm" className="w-full text-xs h-8" onClick={() => append({ id: `div-${Date.now()}`, reason: '', quantity: 0, notes: '' })}>
            <PlusCircle className="mr-2 h-3 w-3"/> Adicionar Saída
        </Button>
    </div>
  );
}

function ReconciliationSection({ itemIndex, control, form }: { itemIndex: number, control: any, form: any }) {
    const [showForm, setShowForm] = useState(!!form.getValues(`items.${itemIndex}.adjustment`));
    if (showForm) {
        return (
             <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/20 space-y-3">
                 <h4 className="font-semibold text-amber-800 text-sm">Reconciliação de Turno Anterior</h4>
                <div className="grid grid-cols-2 gap-4">
                     <FormField control={control} name={`items.${itemIndex}.adjustment.quantity`} render={({ field }) => (
                        <FormItem><FormLabel className="text-[10px] uppercase font-bold">Quantidade</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))} /></FormControl></FormItem>
                    )}/>
                     <FormField control={control} name={`items.${itemIndex}.adjustment.type`} render={({ field }) => (
                        <FormItem><FormLabel className="text-[10px] uppercase font-bold">Tipo</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="..." /></SelectTrigger></FormControl><SelectContent><SelectItem value="positive">Acréscimo</SelectItem><SelectItem value="negative">Decréscimo</SelectItem></SelectContent></Select></FormItem>
                    )}/>
                </div>
                <FormField control={control} name={`items.${itemIndex}.adjustment.notes`} render={({ field }) => (
                    <FormItem><FormControl><Textarea {...field} placeholder="Ex: Encontrado no freezer" rows={1} className="text-sm min-h-[38px]" /></FormControl></FormItem>
                )}/>
                <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => { form.setValue(`items.${itemIndex}.adjustment`, undefined); setShowForm(false); }}>Remover ajuste</Button>
            </div>
        )
    }
    return <div className="text-center p-2"><Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => setShowForm(true)}>Identificou divergência do turno anterior?</Button></div>
}

// --- Formulário de Auditoria ---

function AuditForm({ session, onSave, onFinalize, onCancel }: { session: StockAuditSession, onSave: (items: StockAuditItem[]) => Promise<void>, onFinalize: (items: StockAuditItem[]) => Promise<void>, onCancel: () => Promise<void> }) {
  const { products, getProductFullName } = useProducts();
  const { toast } = useToast();
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const form = useForm<AuditFormValues>({
    resolver: zodResolver(auditFormSchema),
    defaultValues: { items: [] },
  });

  const { fields } = useFieldArray({ control: form.control, name: 'items' });
  const watchedItems = useWatch({ control: form.control, name: 'items' });

  const getUpdatedItems = useCallback((values: AuditFormValues): StockAuditItem[] => {
    return session.items.map((originalItem, index) => ({
      ...originalItem,
      finalQuantity: values.items[index]?.finalQuantity ?? originalItem.systemQuantity,
      adjustment: values.items[index]?.adjustment,
      divergences: values.items[index]?.divergences || [],
    }));
  }, [session]);

  // Reset apenas quando mudar a sessão (ID)
  useEffect(() => {
    if (session?.id) {
        form.reset({
            items: session.items.map(i => ({
                productId: i.productId, lotId: i.lotId, systemQuantity: i.systemQuantity,
                finalQuantity: i.finalQuantity, adjustment: i.adjustment, divergences: i.divergences || [],
            })),
        });
    }
  }, [session.id, form.reset]);
  
  // Lógica de Auto-save (Debounce 2s)
  useEffect(() => {
    const subscription = form.watch((values) => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      
      debounceTimerRef.current = setTimeout(async () => {
        setIsAutoSaving(true);
        try {
          const updatedItems = getUpdatedItems(values as AuditFormValues);
          await onSave(updatedItems); 
          setLastSaved(new Date());
        } finally { setIsAutoSaving(false); }
      }, 2000); 
    });

    return () => {
      subscription.unsubscribe();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [form, onSave, getUpdatedItems]);

  // Recálculo automático do Estoque Final
  useEffect(() => {
    if (!watchedItems) return;
    watchedItems.forEach((item, index) => {
        if (!item) return;
        const adj = item.adjustment?.type === 'negative' ? -(Number(item.adjustment?.quantity) || 0) : (Number(item.adjustment?.quantity) || 0);
        const divs = (item.divergences || []).reduce((sum, d) => sum + (Number(d.quantity) || 0), 0);
        const newFinal = item.systemQuantity + adj - divs;
        if (Math.abs(newFinal - (item.finalQuantity || 0)) > 0.001) {
            form.setValue(`items.${index}.finalQuantity`, newFinal, { shouldValidate: true });
        }
    });
  }, [watchedItems, form]);

  const handleFinalize = async () => {
    const isValid = await form.trigger();
    if (!isValid) return toast({ variant: "destructive", title: "Erro", description: "Verifique os cálculos e justificativas." });
    await onFinalize(getUpdatedItems(form.getValues()));
  };

  return (
    <Card className="border-none shadow-none lg:border lg:shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">Contagem em {session.kioskName}</CardTitle>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <span className="text-xs text-muted-foreground">Iniciada por {session.auditedBy.username}</span>
            <Separator orientation="vertical" className="h-3" />
            {isAutoSaving ? (
              <span className="flex items-center gap-1 text-[10px] text-amber-600 animate-pulse font-bold uppercase"><Loader2 className="h-3 w-3 animate-spin" /> Salvando...</span>
            ) : lastSaved ? (
              <span className="flex items-center gap-1 text-[10px] text-green-600 font-bold uppercase"><Check className="h-3 w-3" /> Salvo às {format(lastSaved, 'HH:mm:ss')}</span>
            ) : null}
          </div>
        </CardHeader>
        <Form {...form}><form>
            <CardContent className="space-y-4">
                <ScrollArea className="h-[calc(100vh-280px)] pr-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {fields.map((field, index) => {
                            const item = session.items[index];
                            const product = products.find(p => p.id === item.productId);
                            return (
                                <Card key={item.lotId} className="overflow-hidden">
                                    <div className="p-4 flex gap-4 bg-muted/30">
                                        <div className="w-16 h-16 shrink-0 bg-background rounded-md border flex items-center justify-center overflow-hidden">
                                            {product?.imageUrl ? <Image src={product.imageUrl} alt="" width={64} height={64} className="object-cover" /> : <ListOrdered className="text-muted-foreground/40" />}
                                        </div>
                                        <div className="space-y-0.5 overflow-hidden">
                                            <p className="font-bold text-sm truncate">{product ? getProductFullName(product) : item.productName}</p>
                                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Lote: {item.lotNumber} • Val: {item.expiryDate ? format(parseISO(item.expiryDate), 'dd/MM/yy') : 'N/A'}</p>
                                        </div>
                                    </div>
                                    <div className="p-4 space-y-4">
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="p-2 bg-muted/20 rounded border border-dashed flex flex-col items-center">
                                                <span className="text-[10px] uppercase text-muted-foreground font-bold">Sistema</span>
                                                <span className="text-xl font-black">{item.systemQuantity}</span>
                                            </div>
                                            <div className="p-2 bg-primary/5 rounded border border-primary/20 flex flex-col items-center">
                                                <span className="text-[10px] uppercase text-primary font-bold">Estoque Final</span>
                                                <span className="text-xl font-black text-primary">{watchedItems[index]?.finalQuantity ?? 0}</span>
                                            </div>
                                        </div>
                                        <ReconciliationSection itemIndex={index} control={form.control} form={form} />
                                        <JustificationSection itemIndex={index} control={form.control} />
                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                </ScrollArea>
            </CardContent>
            <CardContent className="border-t pt-4 flex justify-between">
                <Button type="button" variant="ghost" onClick={onCancel} className="text-destructive">Cancelar</Button>
                <Button type="button" onClick={handleFinalize} className="bg-pink-600 hover:bg-pink-700">Concluir contagem</Button>
            </CardContent>
        </form></Form>
    </Card>
  )
}

function AuditHistory() {
    const { auditSessions, deleteAuditSession, loading } = useStockAudit();
    const { permissions } = useAuth();
    const [sessionToDelete, setSessionToDelete] = useState<StockAuditSession | null>(null);

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
                <CardTitle>Histórico de contagens</CardTitle>
                <CardDescription>Visualize todas as contagens que foram concluídas.</CardDescription>
            </CardHeader>
            <CardContent>
                {loading ? <Skeleton className="h-40 w-full" /> : completedAudits.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                        <Inbox className="h-12 w-12 mx-auto mb-4" />
                        <p className="font-semibold">Nenhuma contagem concluída.</p>
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
                                    {permissions.stock.audit.approve && (
                                        <DeleteConfirmationDialog 
                                            open={false}
                                            onOpenChange={() => {}}
                                            onConfirm={handleDeleteConfirm}
                                            itemName={`a contagem de "${session.kioskName}"`}
                                            triggerButton={
                                                <Button variant="ghost" size="icon" className="text-destructive h-7 w-7" onClick={() => setSessionToDelete(session)}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            }
                                        />
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function KioskSelectionModal({ open, onOpenChange, kiosks, onSelectKiosk }: { open: boolean, onOpenChange: (open: boolean) => void, kiosks: any[], onSelectKiosk: (kioskId: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Iniciar nova contagem</DialogTitle>
          <DialogDescription>Selecione o quiosque que você deseja contar.</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-2">
          {kiosks.map((kiosk) => (
            <DialogClose key={kiosk.id} asChild>
                <Button variant="outline" className="w-full justify-start text-base py-6" onClick={() => onSelectKiosk(kiosk.id)}>
                    {kiosk.name}
                </Button>
            </DialogClose>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Componente Principal ---

export function StockCountManagement({ showExportButton = false }: { showExportButton?: boolean }) {
  const { user, permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { lots } = useExpiryProducts();
  const { products, getProductFullName } = useProducts();
  const { auditSessions, activeSession, setActiveSession, addAuditSession, updateAuditSession, deleteAuditSession, loading } = useStockAudit();
  const { adjustLotQuantity } = useExpiryProducts();
  const { toast } = useToast();
  
  const [isKioskSelectionOpen, setIsKioskSelectionOpen] = useState(false);

  const pendingAudits = useMemo(() => auditSessions.filter(s => s.status === 'pending_review'), [auditSessions]);

  const handleStartSession = async (kioskId: string) => {
    if (!user) return;
    const kiosk = kiosks.find(k => k.id === kioskId);
    if (!kiosk) return;

    const activeLots = lots.filter(lot => lot.kioskId === kioskId && lot.quantity > 0);
    const auditItems: StockAuditItem[] = activeLots.map(lot => ({
        productId: lot.productId, productName: getProductFullName(products.find(p => p.id === lot.productId)!),
        lotId: lot.id, lotNumber: lot.lotNumber, expiryDate: lot.expiryDate || '',
        systemQuantity: lot.quantity, finalQuantity: lot.quantity, divergences: [],
    }));
    
    if (auditItems.length === 0) return toast({ variant: "destructive", title: "Quiosque Vazio" });

    const newId = await addAuditSession({
      kioskId: kiosk.id, kioskName: kiosk.name, status: 'pending_review',
      auditedBy: { userId: user.id, username: user.username },
      startedAt: new Date().toISOString(), items: auditItems,
    });
    if (newId) setActiveSession({ id: newId, items: auditItems, kioskId: kiosk.id, kioskName: kiosk.name, status: 'pending_review', auditedBy: { userId: user.id, username: user.username }, startedAt: new Date().toISOString() } as StockAuditSession);
  };

  const handleFinalize = async (items: StockAuditItem[]) => {
    if (!activeSession || !user) return;
    await adjustLotQuantity({ ...activeSession, items }, user);
    await updateAuditSession(activeSession.id, { items, status: 'completed', completedAt: new Date().toISOString() });
    setActiveSession(null);
  };
  
  const handleCancelAudit = async () => {
    if (!activeSession) return;
    await deleteAuditSession(activeSession.id);
    toast({ variant: 'destructive', title: 'Contagem cancelada' });
    setActiveSession(null);
  }

  if (activeSession) {
    return <AuditForm session={activeSession} onSave={(items) => updateAuditSession(activeSession.id, { items })} onFinalize={handleFinalize} onCancel={handleCancelAudit} />;
  }

  return (
    <Tabs defaultValue="active">
        <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="active">Contagem</TabsTrigger><TabsTrigger value="history">Histórico</TabsTrigger></TabsList>
        <TabsContent value="active" className="mt-4">
            <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck/> Contagem de estoque</CardTitle></CardHeader>
                <CardContent className="space-y-6">
                    <Button onClick={() => setIsKioskSelectionOpen(true)} className="w-full md:w-auto">Nova contagem</Button>
                    <div className="space-y-3 pt-4 border-t">
                        <h3 className="text-sm font-bold uppercase text-muted-foreground">Contagens em aberto</h3>
                        {loading ? <Skeleton className="h-24 w-full" /> : pendingAudits.length === 0 ? <p className="text-sm text-muted-foreground italic">Nada pendente.</p> : 
                            pendingAudits.map(s => (
                                <div key={s.id} className="p-3 border rounded-lg flex justify-between items-center bg-muted/10">
                                    <div className="space-y-0.5"><p className="font-bold text-sm">{s.kioskName}</p><p className="text-[10px] text-muted-foreground uppercase">{s.auditedBy.username} • {format(parseISO(s.startedAt), 'dd/MM HH:mm')}</p></div>
                                    <Button size="sm" variant="outline" onClick={() => setActiveSession(s)}>Continuar</Button>
                                </div>
                            ))
                        }
                    </div>
                </CardContent>
            </Card>
        </TabsContent>
        <TabsContent value="history" className="mt-4">
            <AuditHistory />
        </TabsContent>
        <KioskSelectionModal open={isKioskSelectionOpen} onOpenChange={setIsKioskSelectionOpen} kiosks={kiosks} onSelectKiosk={handleStartSession} />
    </Tabs>
  );
}
