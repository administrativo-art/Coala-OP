
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Image from 'next/image';
import { format, parseISO } from 'date-fns';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useProducts } from '@/hooks/use-products';
import { useToast } from '@/hooks/use-toast';
import { type StockAuditItem, type StockAuditSession, type MovementType, type LotEntry } from '@/types';
import { useStockAudit } from '@/hooks/use-stock-audit';

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from './ui/skeleton';
import { Save, ListOrdered, Inbox, ShieldCheck, Check, Trash2, Loader2, PlusCircle, AlertTriangle, Download, History, PackagePlus, ChevronRight, Store, ClipboardList } from 'lucide-react';
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { RequestItemAdditionModal } from './request-item-addition-modal';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useItemAddition } from '@/hooks/use-item-addition';
import { formatStockExpiryDate, getStockExpiryAlert, getStockExpirySummary, type StockExpiryAlertLevel } from '@/lib/stock-expiry-alert';


const DIVERGENCE_REASONS: { value: MovementType, label: string }[] = [
    { value: 'SAIDA_CONSUMO', label: 'Venda/Consumo' },
    { value: 'Divergência na contagem do turno - decréscimo', label: 'Divergência na contagem do turno - decréscimo' },
    { value: 'SAIDA_DESCARTE_VENCIMENTO', label: 'Descarte por Vencimento' },
    { value: 'SAIDA_DESCARTE_AVARIA', label: 'Descarte por Avaria/Quebra' },
    { value: 'SAIDA_DESCARTE_PERDA', label: 'Extravio de mercadoria' },
    { value: 'SAIDA_DESCARTE_OUTROS', label: 'Outros (especificar)'},
];

const ADJUSTMENT_REASONS: { value: 'ENTRADA_CORRECAO', label: string }[] = [
    { value: 'ENTRADA_CORRECAO', label: 'Divergência na contagem do turno - acréscimo' },
];

const divergenceSchema = z.object({
    id: z.string(),
    reason: z.custom<MovementType>(val => typeof val === 'string' && DIVERGENCE_REASONS.some(r => r.value === val), "Selecione um motivo válido."),
    quantity: z.coerce.number().min(0.01, "A quantidade deve ser maior que 0.").optional().or(z.literal(undefined)),
    notes: z.string().optional(),
});

const adjustmentSchema = z.object({
    id: z.string(),
    reason: z.literal('ENTRADA_CORRECAO'),
    quantity: z.coerce.number().min(0.01, "A quantidade deve ser maior que 0.").optional().or(z.literal(undefined)),
    notes: z.string().optional(),
});

const auditItemSchema = z.object({
    productId: z.string(),
    lotId: z.string(),
    systemQuantity: z.number(),
    divergences: z.array(divergenceSchema),
    adjustments: z.array(adjustmentSchema), // New field for positive adjustments
});

const auditFormSchema = z.object({
  items: z.array(auditItemSchema)
});

type AuditFormValues = z.infer<typeof auditFormSchema>;

function expiryAlertClass(level: StockExpiryAlertLevel) {
  switch (level) {
    case 'expired':
    case 'today':
    case 'invalid':
      return 'border-red-200 bg-red-50 text-red-700';
    case 'urgent':
      return 'border-orange-200 bg-orange-50 text-orange-700';
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'ok':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'none':
    default:
      return 'border-slate-200 bg-slate-50 text-slate-600';
  }
}

function JustificationSection({ itemIndex, control, type, unit }: { itemIndex: number, control: any, type: 'divergence' | 'adjustment', unit: string }) {
  const name = type === 'divergence' ? `items.${itemIndex}.divergences` : `items.${itemIndex}.adjustments`;
  const { fields, append, remove } = useFieldArray({ control, name });
  
  const reasons = type === 'divergence' ? DIVERGENCE_REASONS : ADJUSTMENT_REASONS;
  const cardClass = type === 'divergence' ? "bg-red-500/5 text-red-800/80" : "bg-green-500/5 text-green-800/80";
  const title = type === 'divergence' ? "Registrar saídas do turno" : "Registrar entrada";
  const buttonLabel = type === 'divergence' ? "Adicionar saída" : "Adicionar entrada";
  const defaultReason = type === 'divergence' ? 'SAIDA_CONSUMO' : 'ENTRADA_CORRECAO';


  return (
    <Card className={cn("p-3 space-y-3", cardClass)}>
        <h4 className="font-semibold flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4"/>{title}</h4>
        <div className="space-y-2">
            {fields.map((field, divIndex) => (
                <div key={field.id} className="p-3 border rounded-md space-y-2 bg-background/50 relative shadow-sm">
                    <Button type="button" variant="ghost" size="icon" className="absolute top-1 right-1 text-destructive h-7 w-7" onClick={() => remove(divIndex)}><Trash2 className="h-4 w-4"/></Button>
                    <div className="grid grid-cols-2 gap-2 items-start">
                        <FormField control={control} name={`${name}.${divIndex}.quantity`} render={({ field: qtyField }) => (
                            <FormItem><FormLabel className="text-xs">Quantidade ({unit})</FormLabel>
                                <FormControl>
                                    <Input
                                        type="number"
                                        {...qtyField}
                                        value={qtyField.value ?? ''}
                                        onWheel={(e) => (e.target as HTMLElement).blur()}
                                        onKeyDown={(e) => { if (['ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); } }}
                                        onFocus={(e) => e.target.select()}
                                        placeholder=""
                                    />
                                </FormControl>
                            </FormItem>
                        )}/>
                        <FormField control={control} name={`${name}.${divIndex}.reason`} render={({ field: reasonField }) => (
                            <FormItem><FormLabel className="text-xs">Motivo</FormLabel>
                                <Select onValueChange={reasonField.onChange} value={reasonField.value}>
                                    <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="..." /></SelectTrigger></FormControl>
                                    <SelectContent>{reasons.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                                </Select>
                            </FormItem>
                        )}/>
                    </div>
                     <FormField control={control} name={`${name}.${divIndex}.notes`} render={({ field: notesField }) => (
                        <FormItem><FormControl><Textarea {...notesField} placeholder="Observação (opcional)" rows={1} className="text-sm min-h-[38px]" /></FormControl></FormItem>
                    )}/>
                </div>
            ))}
        </div>
        <Button type="button" variant="outline" size="sm" className="w-full text-xs h-8" onClick={() => append({ id: `div-${Date.now()}`, reason: defaultReason, quantity: undefined, notes: '' })}>
            <PlusCircle className="mr-2 h-3 w-3"/> {buttonLabel}
        </Button>
    </Card>
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
  const { user } = useAuth();
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
        productId: i.productId, lotId: i.lotId, systemQuantity: i.systemQuantity,
        divergences: i.divergences || [],
        adjustments: i.adjustments || [], // Initialize new field
      })),
    },
  });

  const { fields } = useFieldArray({ control: form.control, name: 'items' });
  const watchedItems = useWatch({ control: form.control, name: 'items' });
  const expirySummary = useMemo(() => getStockExpirySummary(session.items), [session.items]);

  const getUpdatedItems = (values: AuditFormValues): StockAuditItem[] => {
    return session.items.map((originalItem, index) => {
      const formItem = values.items[index];
      const totalDivergence = (formItem?.divergences || []).reduce((sum, d) => sum + (Number(d.quantity) || 0), 0);
      const totalAdjustment = (formItem?.adjustments || []).reduce((sum, d) => sum + (Number(d.quantity) || 0), 0);
      const finalQuantity = originalItem.systemQuantity - totalDivergence + totalAdjustment;
      
      return {
        ...originalItem,
        finalQuantity: finalQuantity,
        divergences: formItem?.divergences || [],
        adjustments: formItem?.adjustments || [],
      };
    });
  };

  const handleSaveAndExit = async () => {
    setIsSaving(true);
    await onSave(getUpdatedItems(form.getValues()));
    setIsSaving(false);
  };
  
  const handleFinalizeClick = async () => {
    const isValid = await form.trigger();
    if (!isValid) {
      toast({
          variant: "destructive",
          title: "Dados inválidos",
          description: "Verifique os itens com erros antes de continuar.",
      });
      return;
    }
    setIsConfirmFinalizeOpen(true);
  };

  const handleFinalizeConfirm = async () => {
    setIsConfirmFinalizeOpen(false);
    setIsFinalizing(true);
    try {
        await onFinalize(getUpdatedItems(form.getValues()));
    } finally {
        setIsFinalizing(false);
    }
  };

  const handleCancelClick = async () => {
      if (form.formState.isDirty) {
          setIsConfirmCancelOpen(true);
      } else {
          await onCancel();
      }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Contagem em {session.kioskName}</CardTitle>
          <CardDescription>Contagem iniciada por {session.auditedBy.username} em {format(parseISO(session.startedAt), 'dd/MM/yyyy HH:mm')}</CardDescription>
        </CardHeader>
          <Form {...form}><form>
              <CardContent>
                  {expirySummary.attention > 0 ? (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <div className="flex flex-wrap items-center gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                        <span className="font-semibold">Atenção de validade</span>
                        {expirySummary.expired > 0 ? <Badge variant="outline" className={expiryAlertClass('expired')}>{expirySummary.expired} vencido(s)</Badge> : null}
                        {expirySummary.today > 0 ? <Badge variant="outline" className={expiryAlertClass('today')}>{expirySummary.today} vence(m) hoje</Badge> : null}
                        {expirySummary.urgent > 0 ? <Badge variant="outline" className={expiryAlertClass('urgent')}>{expirySummary.urgent} em até 7 dias</Badge> : null}
                        {expirySummary.warning > 0 ? <Badge variant="outline" className={expiryAlertClass('warning')}>{expirySummary.warning} em até 30 dias</Badge> : null}
                        {expirySummary.invalid > 0 ? <Badge variant="outline" className={expiryAlertClass('invalid')}>{expirySummary.invalid} data(s) inválida(s)</Badge> : null}
                      </div>
                      <p className="mt-1 text-xs text-amber-800/80">
                        Esse aviso é apenas visual; a contagem e os ajustes continuam seguindo a quantidade informada.
                      </p>
                    </div>
                  ) : null}
                  <ScrollArea className="h-[calc(80vh-280px)] pr-2">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {fields.map((field, index) => {
                              const item = session.items[index];
                              const product = products.find(p => p.id === item.productId);
                              const expiryAlert = getStockExpiryAlert(
                                item.expiryDate,
                                product?.urgentThreshold ?? 7,
                                product?.alertThreshold ?? 30,
                              );
                              
                              const formItem = watchedItems?.[index];
                              const totalDivergence = (formItem?.divergences || []).reduce((sum, d) => sum + (Number(d.quantity) || 0), 0);
                              const totalAdjustment = (formItem?.adjustments || []).reduce((sum, d) => sum + (Number(d.quantity) || 0), 0);
                              const adjustedQuantity = item.systemQuantity - totalDivergence + totalAdjustment;
                              
                              const displayUnit = item.displayUnit || 'un';

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
                                              <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-sm text-muted-foreground">Val: {formatStockExpiryDate(item.expiryDate)}</p>
                                                <Badge variant="outline" className={cn('w-fit', expiryAlertClass(expiryAlert.level))}>
                                                  {expiryAlert.label}
                                                </Badge>
                                              </div>
                                          </div>
                                      </div>
                                      <Separator />
                                      <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                                          <div className="grid grid-cols-2 gap-4">
                                              <div className="p-2 border rounded-md">
                                                  <Label className="text-xs text-muted-foreground">Estoque sistema</Label>
                                                  <p className="text-lg font-bold">{item.systemQuantity} <span className="text-sm font-normal text-muted-foreground">{displayUnit}</span></p>
                                              </div>
                                                <div className="p-2 border rounded-md bg-muted/30">
                                                  <Label className="text-xs text-muted-foreground">Estoque ajustado</Label>
                                                  <p className="text-lg font-bold text-primary">{adjustedQuantity} <span className="text-sm font-normal text-muted-foreground">{displayUnit}</span></p>
                                                </div>
                                          </div>
                                          <JustificationSection itemIndex={index} control={form.control} type="divergence" unit={displayUnit} />
                                          <JustificationSection itemIndex={index} control={form.control} type="adjustment" unit={displayUnit} />
                                      </div>
                                  </Card>
                              );
                          })}
                      </div>
                       <Button variant="outline" size="sm" className="mt-4" onClick={() => setIsRequestModalOpen(true)}>
                            <PackagePlus className="mr-2 h-4 w-4"/> Insumo não encontrado
                        </Button>
                  </ScrollArea>
              </CardContent>
              <CardFooter>
                  <div className="flex justify-between items-center pt-4 border-t w-full">
                  <Button type="button" variant="outline" onClick={handleCancelClick} disabled={isFinalizing || isSaving}>Cancelar contagem</Button>
                  <div className="flex gap-2">
                       <Button type="button" variant="secondary" onClick={handleSaveAndExit} disabled={isSaving || isFinalizing}>
                           {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Salvar e sair
                       </Button>
                       <Button type="button" onClick={handleFinalizeClick} disabled={isFinalizing || isSaving}><Check className="mr-2 h-4 w-4"/> Concluir contagem</Button>
                  </div>
                  </div>
              </CardFooter>
          </form></Form>
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
            description="Esta ação é irreversível. O estoque será atualizado com base nas justificativas de saída e entrada. Deseja continuar?"
            confirmButtonText={isFinalizing ? 'Concluindo...' : 'Sim, concluir contagem'}
        />
        <DeleteConfirmationDialog 
            open={isConfirmCancelOpen}
            onOpenChange={setIsConfirmCancelOpen}
            title="Sair sem salvar?"
            description="Você tem alterações não salvas que serão perdidas ao sair. Deseja continuar?"
            confirmButtonText="Sair sem salvar"
            onConfirm={onCancel}
        />
    </>
  )
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
                className="w-full justify-start text-base py-6 transition-all duration-200 hover:border-primary hover:shadow-lg hover:-translate-y-px"
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

interface StockSessionManagementProps {
  showExportButton?: boolean;
}

export function StockSessionManagement({ showExportButton = false }: StockSessionManagementProps) {
  const { user, permissions } = useAuth();
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { products, getProductFullName, loading: productsLoading } = useProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { auditSessions, activeSession, setActiveSession, addAuditSession, updateAuditSession, deleteAuditSession, loading: auditLoading } = useStockAudit();
  const { adjustLotQuantity } = useExpiryProducts();
  const { requests: itemAdditionRequests } = useItemAddition();
  const { toast } = useToast();

  const [isKioskSelectionOpen, setIsKioskSelectionOpen] = useState(false);
  const stockDataLoading = kiosksLoading || lotsLoading || productsLoading || baseProductsLoading;
  const loading = auditLoading || stockDataLoading;

  const isAdmin = permissions.settings.manageUsers; // admin vê tudo
  const pendingAudits = useMemo(() => auditSessions.filter(s =>
    s.status === 'pending_review' &&
    (isAdmin || user?.assignedKioskIds?.includes(s.kioskId))
  ), [auditSessions, isAdmin, user]);

  const countableKiosks = useMemo(
    () => (isAdmin ? kiosks : kiosks.filter((k) => user?.assignedKioskIds?.includes(k.id))),
    [isAdmin, kiosks, user],
  );
  const pendingRequests = useMemo(
    () => itemAdditionRequests.filter((r) => r.status === 'pending' && (isAdmin || user?.assignedKioskIds?.includes(r.kioskId))),
    [itemAdditionRequests, isAdmin, user],
  );
  
  const handleStartSession = async (kioskId: string) => {
    if (!user) return;
    if (stockDataLoading) {
        toast({
            title: "Carregando estoque",
            description: "Aguarde produtos e lotes carregarem antes de iniciar a contagem.",
        });
        return;
    }

    const kiosk = kiosks.find(k => k.id === kioskId);
    if (!kiosk) return;

    const productMap = new Map(products.map(p => [p.id, p]));
    const baseProductMap = new Map(baseProducts.map(bp => [bp.id, bp]));
    const activeLots = lots.filter(lot => lot.kioskId === kioskId && lot.quantity > 0);
    
    const groupedLots: { [key: string]: LotEntry } = {};

    activeLots.forEach(lot => {
        const product = productMap.get(lot.productId);
        if (!product || product.isArchived || product.operationalDestination === 'uniform' || product.category === 'Vestimenta') return;

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
        
        const countingUnitOption = product.defaultCountingUnit || 'package';
        let displayUnit = 'un';
        if (countingUnitOption === 'package') {
            displayUnit = product.packageType || product.unit || 'un';
        } else if (countingUnitOption === 'base') {
            const baseProduct = product.baseProductId ? baseProductMap.get(product.baseProductId) : null;
            displayUnit = baseProduct?.unit || 'un';
        } else if (countingUnitOption === 'content') {
            displayUnit = product.unit || 'un';
        }
        
        let systemQuantity = lot.quantity;
        
        return {
            productId: lot.productId,
            productName: getProductFullName(product),
            lotId: lot.id, 
            lotNumber: lot.lotNumber,
            expiryDate: lot.expiryDate || '',
            systemQuantity: systemQuantity,
            displayUnit: displayUnit,
            finalQuantity: systemQuantity,
            divergences: [],
            adjustments: [],
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

    const newSessionData: Omit<StockAuditSession, 'id'> = {
      kioskId: kiosk.id, kioskName: kiosk.name, status: 'pending_review',
      auditedBy: { userId: user.id, username: user.username },
      startedAt: new Date().toISOString(), items: auditItems,
    };

    const newId = await addAuditSession(newSessionData);
    if (newId) {
        setActiveSession({ id: newId, ...newSessionData });
    }
  };
  
  const handleFinalize = async (items: StockAuditItem[]) => {
    if (!activeSession || !user) return;
    try {
        await adjustLotQuantity({ ...activeSession, items }, user);
        await updateAuditSession(activeSession.id, {
            items, status: 'completed', completedAt: new Date().toISOString(),
        });
        setActiveSession(null);
        toast({ title: 'Sucesso!', description: 'Contagem finalizada e estoque ajustado.' });
    } catch (error: any) {
        toast({ variant: "destructive", title: "Erro ao finalizar", description: error.message || "Não foi possível salvar a conclusão no servidor." });
    }
  };
  
  const handleCancelAudit = async () => {
    if (!activeSession) return;
    await deleteAuditSession(activeSession.id);
    setActiveSession(null);
  };
  
   const handleSaveAndExit = async (items: StockAuditItem[]) => {
    if (!activeSession) return;
    await updateAuditSession(activeSession.id, { items });
    toast({ title: 'Progresso salvo!', description: 'Sua contagem foi salva para continuar depois.' });
    setActiveSession(null);
  };

  const handleExport = () => {
    alert('Função de exportação a ser implementada.');
  };

  if (activeSession) {
    return <AuditForm session={activeSession} onSave={handleSaveAndExit} onFinalize={handleFinalize} onCancel={handleCancelAudit} />;
  }

  const canPerform = permissions.stock.stockCount.perform;
  const canReview = permissions.stock.stockCount.perform || permissions.stock.stockCount.approve;

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Contagem de estoque</h1>
            <p className="text-sm text-muted-foreground">Inicie uma nova contagem ou conclua uma sessão salva para revisão.</p>
          </div>
          <div className="flex gap-2">
            {showExportButton && (
              <Button onClick={handleExport} variant="outline"><Download className="mr-2 h-4 w-4" /> Exportar</Button>
            )}
            {canPerform && (
              <Button onClick={() => setIsKioskSelectionOpen(true)} className="bg-indigo-500 hover:bg-indigo-600" disabled={stockDataLoading}>
                {stockDataLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                {stockDataLoading ? 'Carregando estoque' : 'Realizar contagem'}
              </Button>
            )}
          </div>
        </div>

        {/* Metric cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: ClipboardList, value: pendingAudits.length, label: 'Sessões em aberto', detail: `${pendingAudits.length} aguardando revisão`, tone: 'text-indigo-600 bg-indigo-50' },
            { icon: PackagePlus, value: pendingRequests.length, label: 'Solicitações de insumo', detail: 'Aguardando o administrador', tone: 'text-amber-600 bg-amber-50' },
            { icon: Store, value: countableKiosks.length, label: 'Quiosques ativos', detail: 'Disponíveis para contar', tone: 'text-emerald-600 bg-emerald-50' },
          ].map((m) => (
            <Card key={m.label} className="p-4">
              <div className="flex items-start gap-3">
                <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', m.tone)}>
                  {React.createElement(m.icon, { className: 'h-5 w-5' })}
                </div>
                <div>
                  <p className="text-2xl font-bold leading-none">{loading ? '—' : m.value}</p>
                  <p className="mt-1 text-sm font-medium">{m.label}</p>
                  <p className="text-xs text-muted-foreground">{m.detail}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Two columns */}
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          {/* Concluir contagem */}
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold"><ListOrdered className="h-4 w-4" /> Concluir contagem</h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">{pendingAudits.length}</span>
            </div>
            <div className="space-y-2">
              {loading ? (
                <Skeleton className="h-20 w-full" />
              ) : pendingAudits.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                  <Inbox className="h-8 w-8" />
                  <p className="text-sm">Nenhuma sessão em aberto.</p>
                </div>
              ) : (
                pendingAudits.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 rounded-lg border p-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Store className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold">{s.kioskName}</p>
                        <Badge variant="outline" className="border-emerald-300 text-emerald-700">Pronta p/ revisão</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{s.auditedBy.username} · {format(parseISO(s.startedAt), 'dd/MM · HH:mm')}</p>
                    </div>
                    {canReview && (
                      <Button size="sm" className="bg-indigo-500 hover:bg-indigo-600" onClick={() => setActiveSession(s)}>Revisar</Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Right column */}
          <div className="space-y-4">
            <Card className="p-4">
              <h3 className="flex items-center gap-2 font-semibold"><PlusCircle className="h-4 w-4" /> Nova contagem</h3>
              <p className="mt-1 text-sm text-muted-foreground">Escolha um quiosque e o sistema lista todos os lotes em estoque para conferência.</p>
              {canPerform && (
                <Button onClick={() => setIsKioskSelectionOpen(true)} variant="outline" className="mt-3 w-full" disabled={stockDataLoading}>
                  {stockDataLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                  {stockDataLoading ? 'Carregando estoque' : 'Iniciar contagem'}
                </Button>
              )}
            </Card>

            <Link href="/dashboard/stock/item-requests" className="block">
              <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/50">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                  <PackagePlus className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold">Solicitações de cadastro
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">{pendingRequests.length}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">Insumos encontrados na contagem, sem cadastro.</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Card>
            </Link>

            <p className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
              Contagens com divergência seguem para <span className="font-medium text-foreground">aprovação do administrador</span>, que ajusta o estoque ao concluir.
            </p>
          </div>
        </div>
      </div>

      <KioskSelectionModal
        open={isKioskSelectionOpen}
        onOpenChange={setIsKioskSelectionOpen}
        kiosks={countableKiosks}
        onSelectKiosk={handleStartSession}
      />
    </>
  );
}
