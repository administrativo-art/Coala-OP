
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
import { useStockCount } from '@/hooks/use-stock-count';
import { useToast } from '@/hooks/use-toast';
import { type LotEntry, type StockCountItem, type StockCount as StockCountType } from '@/types';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Save, ListOrdered, Inbox, PlusCircle, UserCheck, ShieldCheck, Check, X, HelpCircle } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { RequestItemAdditionModal } from '@/components/request-item-addition-modal';
import { ItemAdditionRequestManagement } from '@/components/item-addition-request-management';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';


const countItemSchema = z.object({
  countedQuantity: z.coerce.number().min(0, "A quantidade não pode ser negativa."),
  notes: z.string().optional(),
});

const countFormSchema = z.object({
  items: z.array(countItemSchema)
});

type CountFormValues = z.infer<typeof countFormSchema>;

function PendingApprovals() {
  const { counts, updateStockCount, loading: loadingCounts } = useStockCount();
  const { adjustLotQuantity } = useExpiryProducts();
  const { user } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);

  const pendingCounts = useMemo(() => {
    return counts.filter(c => c.status === 'pending');
  }, [counts]);

  const handleApprove = async (count: StockCountType) => {
    if (!user) return;
    setIsProcessing(true);
    
    for (const item of count.items) {
        if (item.difference !== 0) {
            await adjustLotQuantity(item.lotId, item.countedQuantity, count.countedBy, user);
        }
    }

    await updateStockCount(count.id, {
        status: 'approved',
        reviewedBy: { userId: user.id, username: user.username },
        reviewedAt: new Date().toISOString(),
    });
    setIsProcessing(false);
  };
  
  const handleReject = async (count: StockCountType) => {
      if (!user) return;
      setIsProcessing(true);
      await updateStockCount(count.id, {
          status: 'rejected',
          reviewedBy: { userId: user.id, username: user.username },
          reviewedAt: new Date().toISOString(),
      });
      setIsProcessing(false);
  };


  if (loadingCounts) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (pendingCounts.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
        <Inbox className="h-12 w-12 mx-auto mb-4" />
        <p className="font-semibold">Nenhuma contagem pendente</p>
        <p className="text-sm">Não há contagens de estoque aguardando sua aprovação.</p>
      </div>
    );
  }

  return (
    <Accordion type="multiple" className="w-full space-y-3">
      {pendingCounts.map(count => (
        <AccordionItem key={count.id} value={count.id} className="border rounded-lg">
          <AccordionTrigger className="p-4 hover:no-underline">
            <div className="flex justify-between items-center w-full">
              <div>
                <p className="font-semibold">Contagem de {count.kioskName}</p>
                <p className="text-sm text-muted-foreground">
                  Por {count.countedBy.username} em {format(new Date(count.countedAt), 'dd/MM/yyyy HH:mm')}
                </p>
              </div>
              <Badge variant="secondary">{count.items.length} itens com divergência</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-4 pt-0">
            <div className="rounded-md border mb-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Lote</TableHead>
                    <TableHead className="text-center">Qtd. sistema</TableHead>
                    <TableHead className="text-center">Qtd. contada</TableHead>
                    <TableHead className="text-center">Diferença</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {count.items.map(item => (
                    <TableRow key={item.lotId}>
                      <TableCell className="font-medium">{item.productName}</TableCell>
                      <TableCell>{item.lotNumber}</TableCell>
                      <TableCell className="text-center">{item.systemQuantity}</TableCell>
                      <TableCell className="text-center">{item.countedQuantity}</TableCell>
                      <TableCell className={`text-center font-bold ${item.difference > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {item.difference > 0 ? `+${item.difference}` : item.difference}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="destructive" onClick={() => handleReject(count)} disabled={isProcessing}>
                <X className="mr-2 h-4 w-4" /> Rejeitar
              </Button>
              <Button size="sm" onClick={() => handleApprove(count)} disabled={isProcessing}>
                <Check className="mr-2 h-4 w-4" /> Aprovar e ajustar estoque
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function HelpModal({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle /> Instruções de Contagem
          </DialogTitle>
          <DialogDescription>
            Siga estas regras para uma contagem de estoque precisa.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div>
            <h4 className="font-semibold">1. Como devo contar?</h4>
            <p className="text-sm text-muted-foreground">
             Só iremos contar as embalagens fechadas. As que já foram abertas, não iremos considerar como insumo para contagem do estoque.
            </p>
          </div>
          <div>
            <h4 className="font-semibold">2. Insumo não Encontrado?</h4>
            <p className="text-sm text-muted-foreground">
             Se você encontrar um item no estoque físico que não aparece na lista, utilize o botão "Solicitar Cadastro de Insumo" para notificar o administrador.
            </p>
          </div>
          <div>
            <h4 className="font-semibold">3. Encontrou um produto vencido, avariado ou com algum problema?</h4>
            <p className="text-sm text-muted-foreground">
             Use o campo "Observações" para descrever a situação. O administrador irá analisar e tomar a ação necessária.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


export function StockCount() {
  const { user, permissions } = useAuth();
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { products, getProductFullName, loading: productsLoading } = useProducts();
  const { addStockCount, loading: submitting } = useStockCount();
  const { toast } = useToast();

  const [selectedKioskId, setSelectedKioskId] = useState<string>('');
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);


  const kioskLots = useMemo(() => {
    if (!selectedKioskId) return [];
    
    const activeLots = lots.filter(lot => lot.kioskId === selectedKioskId && lot.quantity > 0);
    const productMap = new Map(products.map(p => [p.id, p]));

    const lotsByUniqueKey: Record<string, LotEntry> = {};

    activeLots.forEach(lot => {
        const product = productMap.get(lot.productId);
        if (!product || product.isArchived) return;

        const uniqueKey = `${lot.productId}-${lot.lotNumber}-${lot.expiryDate || 'no-expiry'}`;
        
        const existingLot = lotsByUniqueKey[uniqueKey];
        if (existingLot) {
            existingLot.quantity += lot.quantity;
        } else {
            lotsByUniqueKey[uniqueKey] = { ...lot };
        }
    });

    return Object.values(lotsByUniqueKey).sort((a, b) => {
        const productA = productMap.get(a.productId);
        const productB = productMap.get(b.productId);
        if (productA && productB) {
            const nameA = getProductFullName(productA);
            const nameB = getProductFullName(productB);
            if (nameA !== nameB) {
                return nameA.localeCompare(nameB);
            }
        }
        if (a.expiryDate && b.expiryDate) {
            return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
        }
        return 0;
    });
}, [selectedKioskId, lots, products, getProductFullName]);

  const form = useForm<CountFormValues>({
    resolver: zodResolver(countFormSchema),
    defaultValues: { items: [] }
  });

  const { fields, replace } = useFieldArray({
    control: form.control,
    name: 'items'
  });

  useEffect(() => {
    if (kioskLots.length > 0) {
      replace(kioskLots.map(lot => ({ countedQuantity: lot.quantity, notes: '' })));
    } else {
      replace([]);
    }
  }, [kioskLots, replace]);

  const onSubmit = (values: CountFormValues) => {
    if (!user || !selectedKioskId) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Usuário ou quiosque não selecionado.' });
      return;
    }
    const kiosk = kiosks.find(k => k.id === selectedKioskId);
    if (!kiosk) return;

    const itemsToSave: StockCountItem[] = values.items.map((item, index) => {
      const lot = kioskLots[index];
      const difference = item.countedQuantity - lot.quantity;
      return {
        productId: lot.productId,
        productName: lot.productName,
        lotId: lot.id,
        lotNumber: lot.lotNumber,
        expiryDate: lot.expiryDate || '',
        systemQuantity: lot.quantity,
        countedQuantity: item.countedQuantity,
        difference,
        notes: item.notes,
      };
    }).filter(item => item.difference !== 0 || (item.notes && item.notes.trim() !== ''));

    if (itemsToSave.length === 0) {
        toast({ title: 'Nenhuma alteração', description: 'Não há diferenças ou observações para salvar.' });
        return;
    }

    addStockCount({
      kioskId: selectedKioskId,
      kioskName: kiosk.name,
      status: 'pending',
      countedBy: { userId: user.id, username: user.username },
      countedAt: new Date().toISOString(),
      items: itemsToSave,
    });
    
    toast({ title: 'Contagem salva com sucesso!', description: 'A sua contagem foi enviada para aprovação.' });
    setSelectedKioskId('');
  };

  const loading = kiosksLoading || lotsLoading || productsLoading;
  const canManageRequests = permissions.itemRequests.approve;
  const canApproveCounts = permissions.stock.stockCount.approve;

  const showManagementTab = canManageRequests || canApproveCounts;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ListOrdered /> Contagem de estoque</CardTitle>
          <CardDescription>
            Realize a contagem de estoque e gerencie solicitações de cadastro e aprovações de ajuste.
          </CardDescription>
        </CardHeader>
        <CardContent>
           <Tabs defaultValue="count" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="count"><ListOrdered className="mr-2 h-4 w-4" /> Realizar contagem</TabsTrigger>
                    {showManagementTab && <TabsTrigger value="management"><ShieldCheck className="mr-2 h-4 w-4" /> Gerenciamento</TabsTrigger>}
                </TabsList>
                <TabsContent value="count" className="mt-4">
                     <div className="space-y-4">
                        <div className="flex flex-col sm:flex-row gap-2">
                            <Select value={selectedKioskId} onValueChange={(value) => { setSelectedKioskId(value); form.reset({ items: [] }); }}>
                                <SelectTrigger className="flex-grow"><SelectValue placeholder="Selecione um quiosque para iniciar..." /></SelectTrigger>
                                <SelectContent>
                                {kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <Button
                                variant="secondary"
                                onClick={() => setIsHelpModalOpen(true)}
                                className="bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-900"
                            >
                                <HelpCircle className="mr-2 h-4 w-4" />
                                Tá com dúvida? Clica aqui!
                            </Button>
                            <Button 
                                variant="outline" 
                                onClick={() => setIsRequestModalOpen(true)}
                                disabled={!selectedKioskId}
                            >
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Solicitar cadastro de insumo
                            </Button>
                        </div>
                        {selectedKioskId && (
                            loading ? (
                                <Skeleton className="h-64 w-full" />
                            ) : kioskLots.length === 0 ? (
                                <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                                    <Inbox className="h-12 w-12 mx-auto mb-4" />
                                    <p className="font-semibold">Nenhum lote em estoque para este quiosque.</p>
                                </div>
                            ) : (
                                <Form {...form}>
                                <form onSubmit={form.handleSubmit(onSubmit)}>
                                    <ScrollArea className="h-[50vh] pr-4">
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        {fields.map((field, index) => {
                                            const lot = kioskLots[index];
                                            if (!lot) return null;
                                            const product = products.find(p => p.id === lot.productId);

                                            return (
                                                <Card key={field.id} className="p-4 flex gap-4 items-center">
                                                <div className="w-20 h-20 shrink-0">
                                                    {product?.imageUrl ? (
                                                        <Image
                                                            src={product.imageUrl}
                                                            alt={lot.productName}
                                                            width={80}
                                                            height={80}
                                                            className="w-20 h-20 rounded-md object-cover"
                                                        />
                                                    ) : (
                                                        <div className="w-20 h-20 rounded-md bg-muted flex items-center justify-center">
                                                        <ListOrdered className="h-8 w-8 text-muted-foreground" />
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex-1 space-y-3">
                                                    <div className="space-y-1">
                                                        <p className="font-semibold leading-tight">{lot.productName}</p>
                                                        <p className="text-xs text-muted-foreground">Lote: {lot.lotNumber} | Val: {lot.expiryDate ? format(parseISO(lot.expiryDate), 'dd/MM/yy') : 'N/A'}</p>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <FormField
                                                        control={form.control}
                                                        name={`items.${index}.countedQuantity`}
                                                        render={({ field }) => (
                                                            <FormItem>
                                                            <FormLabel className="text-xs">Qtd. contada</FormLabel>
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
                                                        <FormField
                                                        control={form.control}
                                                        name={`items.${index}.notes`}
                                                        render={({ field }) => (
                                                            <FormItem>
                                                            <FormLabel className="text-xs">Observações</FormLabel>
                                                            <FormControl>
                                                                <Input 
                                                                    {...field}
                                                                    placeholder="Opcional..."
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                            </FormItem>
                                                        )}
                                                        />
                                                    </div>
                                                </div>
                                                </Card>
                                            );
                                        })}
                                    </div>
                                    </ScrollArea>
                                    <div className="flex justify-end pt-4 mt-4 border-t">
                                    <Button type="submit" disabled={submitting}>
                                        <Save className="mr-2 h-4 w-4" />
                                        {submitting ? 'Salvando...' : 'Salvar contagem para aprovação'}
                                    </Button>
                                    </div>
                                </form>
                                </Form>
                            )
                        )}
                    </div>
                </TabsContent>
                {showManagementTab && (
                     <TabsContent value="management" className="mt-4">
                        <Tabs defaultValue="approvals" className="w-full">
                            <TabsList className="grid w-full grid-cols-2">
                                {canApproveCounts && <TabsTrigger value="approvals">Aprovações de contagem</TabsTrigger>}
                                {canManageRequests && <TabsTrigger value="requests">Solicitações de cadastro</TabsTrigger>}
                            </TabsList>
                            {canApproveCounts && (
                                <TabsContent value="approvals" className="mt-4">
                                    <PendingApprovals />
                                </TabsContent>
                            )}
                            {canManageRequests && (
                                <TabsContent value="requests" className="mt-4">
                                    <ItemAdditionRequestManagement />
                                </TabsContent>
                            )}
                        </Tabs>
                    </TabsContent>
                )}
           </Tabs>
        </CardContent>
      </Card>

      <RequestItemAdditionModal 
        open={isRequestModalOpen}
        onOpenChange={setIsRequestModalOpen}
        kioskId={selectedKioskId}
      />

      <HelpModal open={isHelpModalOpen} onOpenChange={setIsHelpModalOpen} />
    </div>
  );
}
