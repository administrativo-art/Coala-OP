

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
import { type StockAuditItem, type StockAuditSession, type StockAuditDivergence, type LotEntry, type MovementType } from '@/types';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Save, ListOrdered, Inbox, ShieldCheck, Check, Trash2, Loader2, PlusCircle, AlertTriangle, Download, History, PackagePlus } from 'lucide-react';
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { cn } from '@/lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { RequestItemAdditionModal } from './request-item-addition-modal';


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
        const adjustmentQty = item.adjustment?.type === 'negative' ? -(Number(item.adjustment?.quantity) || 0) : (Number(item.adjustment?.quantity) || 0);
        const totalDivergenceQty = item.divergences.reduce((sum, div) => sum + (Number(div.quantity) || 0), 0);
        const calculatedFinal = item.systemQuantity + adjustmentQty - totalDivergenceQty;
        
        if (Math.abs(calculatedFinal - item.finalQuantity) > 0.001) {
            return false;
        }
    }
    return true;
}, {
    message: 'O cálculo do estoque final não corresponde às saídas e ajustes.',
});

type AuditFormValues = z.infer<typeof auditFormSchema>;

function JustificationSection({ itemIndex, control, difference }: { itemIndex: number, control: any, difference: number }) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `items.${itemIndex}.divergences`,
  });

  const addNewDivergence = () => {
    append({ id: `div-${Date.now()}`, reason: '', quantity: 0, notes: '' });
  };
  
  const totalJustified = useWatch({ control, name: `items.${itemIndex}.divergences` }).reduce((sum: number, div: any) => sum + (Number(div.quantity) || 0), 0);
  
  return (
    <div className="mt-3 p-3 space-y-3 bg-red-500/5 rounded-lg border border-red-500/10">
        <h4 className="font-semibold text-destructive/80 flex items-center gap-2"><AlertTriangle className="h-4 w-4"/>Registrar Saídas do Turno</h4>
        <div className="space-y-2">
            {fields.map((field, divIndex) => (
                <div key={field.id} className="p-3 border rounded-md space-y-2 bg-background relative">
                    <Button type="button" variant="ghost" size="icon" className="absolute top-1 right-1 text-destructive h-7 w-7" onClick={() => remove(divIndex)}><Trash2 className="h-4 w-4"/></Button>
                    <div className="grid grid-cols-2 gap-2 items-start">
                        <FormField control={control} name={`items.${itemIndex}.divergences.${divIndex}.quantity`} render={({ field: qtyField }) => (
                            <FormItem><FormLabel className="text-xs">Quantidade</FormLabel><FormControl><Input type="number" {...qtyField} /></FormControl><FormMessage /></FormItem>
                        )}/>
                        <FormField control={control} name={`items.${itemIndex}.divergences.${divIndex}.reason`} render={({ field: reasonField }) => (
                            <FormItem><FormLabel className="text-xs">Motivo</FormLabel>
                                <Select onValueChange={reasonField.onChange} value={reasonField.value}>
                                    <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                                    <SelectContent>{DIVERGENCE_REASONS.map(reason => <SelectItem key={reason.value} value={reason.value}>{reason.label}</SelectItem>)}</SelectContent>
                                </Select><FormMessage />
                            </FormItem>
                        )}/>
                    </div>
                     <FormField control={control} name={`items.${itemIndex}.divergences.${divIndex}.notes`} render={({ field: notesField }) => (
                        <FormItem><FormLabel className="text-xs">Observação</FormLabel><FormControl><Textarea {...notesField} placeholder="Opcional, exceto para 'Outros'" rows={1} /></FormControl><FormMessage /></FormItem>
                    )}/>
                </div>
            ))}
        </div>
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={addNewDivergence}>
            <PlusCircle className="mr-2 h-4 w-4"/> Adicionar Saída
        </Button>
    </div>
  );
}

function ReconciliationSection({ itemIndex, control, form }: { itemIndex: number, control: any, form: any }) {
    const [showForm, setShowForm] = useState(!!form.getValues(`items.${itemIndex}.adjustment`));
    const adjustment = useWatch({ control, name: `items.${itemIndex}.adjustment` });

    if (showForm) {
        return (
             <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/20 space-y-3">
                 <h4 className="font-semibold text-amber-800">Reconciliação de Turno</h4>
                <div className="grid grid-cols-2 gap-4">
                     <FormField control={control} name={`items.${itemIndex}.adjustment.quantity`} render={({ field }) => (
                        <FormItem><FormLabel className="text-xs">Quantidade</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                    )}/>
                     <FormField control={control} name={`items.${itemIndex}.adjustment.type`} render={({ field }) => (
                        <FormItem><FormLabel className="text-xs">Tipo</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="..." /></SelectTrigger></FormControl><SelectContent><SelectItem value="positive">Acréscimo</SelectItem><SelectItem value="negative">Decréscimo</SelectItem></SelectContent></Select><FormMessage /></FormItem>
                    )}/>
                </div>
                <FormField control={control} name={`items.${itemIndex}.adjustment.notes`} render={({ field }) => (
                    <FormItem><FormLabel className="text-xs">Observação</FormLabel><FormControl><Textarea {...field} placeholder="Ex: Encontrado no freezer" rows={1} /></FormControl><FormMessage /></FormItem>
                )}/>
                <Button type="button" variant="ghost" size="sm" onClick={() => {
                    form.setValue(`items.${itemIndex}.adjustment`, undefined);
                    setShowForm(false);
                }}>Remover ajuste</Button>
            </div>
        )
    }

    return (
        <div className="text-center p-2">
            <p className="text-sm text-muted-foreground mb-2">Identificou divergência do turno anterior?</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(true)}>Sim, ajustar</Button>
        </div>
    )
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
  const { user } = useAuth();
  const [isCancelling, setIsCancelling] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isConfirmFinalizeOpen, setIsConfirmFinalizeOpen] = useState(false);
  const [isConfirmCancelOpen, setIsConfirmCancelOpen] = useState(false);
  const { toast } = useToast();
  
  const form = useForm<AuditFormValues>({
    resolver: zodResolver(auditFormSchema),
    defaultValues: {
      items: session.items.map(i => ({
        productId: i.productId,
        lotId: i.lotId,
        systemQuantity: i.systemQuantity,
        finalQuantity: i.finalQuantity,
        adjustment: i.adjustment,
        divergences: i.divergences || [],
      })),
    },
  });

  const { fields } = useFieldArray({ control: form.control, name: 'items' });
  const watchedItems = useWatch({ control: form.control, name: 'items' });

  useEffect(() => {
    watchedItems.forEach((item, index) => {
        const adjustmentQty = item.adjustment?.type === 'negative'
            ? -(Number(item.adjustment?.quantity) || 0)
            : (Number(item.adjustment?.quantity) || 0);

        const totalDivergenceQty = item.divergences.reduce((sum, div) => sum + (Number(div.quantity) || 0), 0);
        const newFinalQuantity = item.systemQuantity + adjustmentQty - totalDivergenceQty;
        
        const currentFinalQuantity = form.getValues(`items.${index}.finalQuantity`);
        if (newFinalQuantity !== currentFinalQuantity) {
            form.setValue(`items.${index}.finalQuantity`, newFinalQuantity, { shouldValidate: true });
        }
    });
  }, [watchedItems, form]);


  const getUpdatedItems = (values: AuditFormValues): StockAuditItem[] => {
    return session.items.map((originalItem, index) => ({
      ...originalItem,
      finalQuantity: values.items[index].finalQuantity,
      adjustment: values.items[index].adjustment,
      divergences: values.items[index].divergences,
    }));
  };

  const handleSaveAndExit = async () => {
    setIsSaving(true);
    await onSave(getUpdatedItems(form.getValues()));
    setIsSaving(false);
  };
  
  const handleFinalizeClick = async () => {
    if (!user) return;
    const isValid = await form.trigger();
    if (!isValid) {
      toast({
          variant: "destructive",
          title: "Dados inválidos",
          description: "A soma das justificativas deve ser igual à diferença total para cada item divergente."
      });
      return;
    }
    setIsConfirmFinalizeOpen(true);
  };

  const handleFinalizeConfirm = async () => {
    setIsConfirmFinalizeOpen(false);
    setIsFinalizing(true);
    await onFinalize(getUpdatedItems(form.getValues()));
    setIsFinalizing(false);
  }

  const handleCancelClick = async () => {
      if (form.formState.isDirty) {
          setIsConfirmCancelOpen(true);
      } else {
          handleDiscardAndExit();
      }
  }

  const handleDiscardAndExit = async () => {
      setIsCancelling(true);
      await onCancel();
      setIsCancelling(false);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Contagem em {session.kioskName}</CardTitle>
          <CardDescription>Contagem iniciada por {session.auditedBy.username} em {format(parseISO(session.startedAt), 'dd/MM/yyyy HH:mm')}</CardDescription>
        </CardHeader>
          <Form {...form}>
              <form>
                  <CardContent>
                      <Button variant="outline" className="mb-4" onClick={() => setIsRequestModalOpen(true)}>
                          <PackagePlus className="mr-2 h-4 w-4" />
                          Solicitar Cadastro de Insumo
                      </Button>
                      <ScrollArea className="h-[calc(80vh-320px)] pr-2">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                              {fields.map((field, index) => {
                                  const item = session.items[index];
                                  const product = products.find(p => p.id === item.productId);
                                  const watchedItem = watchedItems[index];
                                  const systemQty = item.systemQuantity;
                                  const finalQty = watchedItem?.finalQuantity;

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
                                                  <p className="font-semibold leading-tight">{product ? getProductFullName(product) : item.productName}</p>
                                                  <p className="text-sm text-muted-foreground">Lote: {item.lotNumber}</p>
                                                  <p className="text-sm text-muted-foreground">Val: {item.expiryDate ? format(parseISO(item.expiryDate), 'dd/MM/yyyy') : 'N/A'}</p>
                                              </div>
                                          </div>
                                          <Separator />
                                          <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                                              <div className="grid grid-cols-2 gap-4">
                                                  <div className="p-2 border rounded-md">
                                                      <Label className="text-xs text-muted-foreground">Estoque Sistema</Label>
                                                      <p className="text-lg font-bold">{systemQty}</p>
                                                  </div>
                                                  <div className="p-2 border rounded-md">
                                                      <Label className="text-xs text-muted-foreground">Estoque Final</Label>
                                                      <p className="text-lg font-bold">{finalQty}</p>
                                                  </div>
                                              </div>
                                              
                                              <ReconciliationSection itemIndex={index} control={form.control} form={form} />

                                              <JustificationSection itemIndex={index} control={form.control} difference={systemQty - finalQty} />

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
                          <Trash2 className="mr-2 h-4 w-4"/> {isCancelling ? 'Cancelando...' : 'Cancelar Contagem'}
                      </Button>
                      <div className="flex gap-2">
                           <Button type="button" onClick={handleFinalizeClick} disabled={isFinalizing || isSaving}><Check className="mr-2 h-4 w-4"/> Concluir contagem</Button>
                      </div>
                      </div>
                  </CardContent>
              </form>
          </Form>
      </Card>
      <RequestItemAdditionModal
        open={isRequestModalOpen}
        onOpenChange={setIsRequestModalOpen}
        kioskId={session.kioskId}
      />
       <DeleteConfirmationDialog 
            open={isConfirmFinalizeOpen}
            onOpenChange={setIsConfirmFinalizeOpen}
            onConfirm={handleFinalizeConfirm}
            isDeleting={isFinalizing}
            title="Tem certeza que quer concluir?"
            description="Esta ação é irreversível. O estoque será atualizado com base nas justificativas de saída. Deseja continuar?"
            confirmButtonText={isFinalizing ? 'Concluindo...' : 'Sim, concluir contagem'}
        />
        <DeleteConfirmationDialog 
            open={isConfirmCancelOpen}
            onOpenChange={setIsConfirmCancelOpen}
            title="Sair da contagem?"
            description="Você tem alterações não salvas. O que você gostaria de fazer?"
            confirmButtonText="Salvar e sair"
            onConfirm={() => { setIsConfirmCancelOpen(false); handleSaveAndExit(); }}
            cancelButtonText="Descartar e sair"
            onCancel={() => { setIsConfirmCancelOpen(false); handleDiscardAndExit(); }}
        />
    </>
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
                itemName="esta contagem"
                description="Esta ação é irreversível e excluirá permanentemente o registro da contagem."
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
          <DialogTitle>Iniciar nova contagem</DialogTitle>
          <DialogDescription>Selecione o quiosque que você deseja contar.</DialogDescription>
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

export function StockCountManagement({ showExportButton = false }: { showExportButton?: boolean }) {
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
    if (!kiosk) return;

    const productMap = new Map(products.map(p => [p.id, p]));
    const activeLots = lots.filter(lot => lot.kioskId === kioskId && lot.quantity > 0);

    const groupedLots: { [key: string]: LotEntry } = {};

    activeLots.forEach(lot => {
        const product = productMap.get(lot.productId);
        if (!product || product.isArchived) return;

        const uniqueKey = `${lot.productId}-${lot.lotNumber}-${lot.expiryDate || 'no-expiry'}`;
        
        const existingLot = groupedLots[uniqueKey];
        if (existingLot) {
            existingLot.quantity += lot.quantity;
        } else {
            groupedLots[uniqueKey] = { ...lot };
        }
    });

    const auditItems: StockAuditItem[] = Object.values(groupedLots).map(lot => {
        const product = productMap.get(lot.productId)!;
        const systemQuantity = lot.quantity; 
        return {
            productId: lot.productId,
            productName: getProductFullName(product),
            lotId: lot.id, 
            lotNumber: lot.lotNumber,
            expiryDate: lot.expiryDate || '',
            systemQuantity: systemQuantity,
            finalQuantity: systemQuantity,
            divergences: [],
        };
    });
    
    if (auditItems.length === 0) {
        toast({
            variant: "destructive",
            title: "Quiosque Vazio",
            description: "Não há lotes em estoque para contar neste quiosque.",
        });
        return;
    }

    const newSessionId = await addAuditSession({
      kioskId: kiosk.id,
      kioskName: kiosk.name,
      status: 'pending_review',
      auditedBy: { userId: user.id, username: user.username },
      startedAt: new Date().toISOString(),
      items: auditItems,
    });

    if (newSessionId) {
        const createdSession = await new Promise<StockAuditSession | undefined>(resolve => {
            const check = () => {
                const session = auditSessions.find(s => s.id === newSessionId) || { id: newSessionId, items: auditItems, kioskId: kiosk.id, kioskName: kiosk.name, status: 'pending_review', auditedBy: { userId: user.id, username: user.username }, startedAt: new Date().toISOString() };
                if (session) {
                    resolve(session);
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
        if (createdSession) setActiveSession(createdSession);
    }
  };

  const handleSaveForReview = async (items: StockAuditItem[]) => {
    if(!activeSession) return;
    await updateAuditSession(activeSession.id, { items });
    toast({ title: 'Progresso salvo!', description: 'Sua contagem foi salva. Você pode continuar depois.' });
    setActiveSession(null);
  }

  const handleFinalize = async (items: StockAuditItem[]) => {
    if(!activeSession || !user) return;
    
    await adjustLotQuantity({
        ...activeSession,
        items: items,
    }, user);
    
    await updateAuditSession(activeSession.id, {
        items,
        status: 'completed',
        completedAt: new Date().toISOString(),
    });
    
    toast({ title: 'Contagem concluída!', description: 'O estoque foi ajustado com sucesso.' });
    setActiveSession(null);
  };
  
  const handleCancelAudit = async () => {
    if (!activeSession) return;
    await deleteAuditSession(activeSession.id);
    toast({ variant: 'destructive', title: 'Contagem cancelada', description: 'A sessão de contagem pendente foi removida.' });
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
                <TabsTrigger value="active">Contagem</TabsTrigger>
                <TabsTrigger value="history">Histórico</TabsTrigger>
            </TabsList>
            <TabsContent value="active" className="mt-4">
                <Card>
                    <CardHeader>
                        <div>
                            <CardTitle className="flex items-center gap-2"><ShieldCheck/> Contagem de estoque</CardTitle>
                            <CardDescription>Inicie uma nova contagem ou continue uma sessão salva para revisão.</CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <h3 className="font-semibold mb-2">Iniciar nova contagem</h3>
                             <Button onClick={() => setIsKioskSelectionOpen(true)}>Iniciar contagem</Button>
                        </div>

                        <div className="space-y-2 pt-4 border-t">
                            <h3 className="font-semibold">Contagens salvas para revisão</h3>
                            {loading ? (
                                <Skeleton className="h-24 w-full" />
                            ) : pendingAudits.length === 0 ? (
                                <p className="text-sm text-muted-foreground">Nenhuma contagem pendente.</p>
                            ) : (
                                pendingAudits.map(session => (
                                    <div key={session.id} className="p-3 border rounded-md flex justify-between items-center">
                                        <div>
                                            <p className="font-medium">Contagem em {session.kioskName}</p>
                                            <p className="text-xs text-muted-foreground">Iniciada por {session.auditedBy.username} em {format(parseISO(session.startedAt), 'dd/MM/yy HH:mm')}</p>
                                        </div>
                                        <Button variant="outline" onClick={() => setActiveSession(session)}>Continuar contagem</Button>
                                    </div>
                                ))
                            )}
                        </div>
                    </CardContent>
                    {showExportButton && (
                         <CardContent>
                             <div className="pt-4 border-t flex justify-end">
                                <Button variant="outline" onClick={() => {
                                    toast({ variant: 'destructive', title: "Funcionalidade não implementada." });
                                }}>
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
      <KioskSelectionModal
        open={isKioskSelectionOpen}
        onOpenChange={setIsKioskSelectionOpen}
        kiosks={kiosks}
        onSelectKiosk={handleStartSession}
      />
    </>
  );
}

