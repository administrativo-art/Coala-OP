
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
import { type LotEntry, type StockCountItem } from '@/types';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Save, ListOrdered, Inbox, PlusCircle } from 'lucide-react';
import { Textarea } from './ui/textarea';
import { RequestItemAdditionModal } from './request-item-addition-modal';
import { ItemAdditionRequestManagement } from './item-addition-request-management';
import { Separator } from './ui/separator';

const countItemSchema = z.object({
  countedQuantity: z.coerce.number().min(0, "A quantidade não pode ser negativa."),
  notes: z.string().optional(),
});

const countFormSchema = z.object({
  items: z.array(countItemSchema)
});

type CountFormValues = z.infer<typeof countFormSchema>;

export function StockCount() {
  const { user, permissions } = useAuth();
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { products, getProductFullName, loading: productsLoading } = useProducts();
  const { addStockCount, loading: submitting } = useStockCount();
  const { toast } = useToast();

  const [selectedKioskId, setSelectedKioskId] = useState<string>('');
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);


  const kioskLots = useMemo(() => {
    if (!selectedKioskId) return [];
    return lots
      .filter(lot => lot.kioskId === selectedKioskId && lot.quantity > 0)
      .sort((a, b) => {
        const productA = products.find(p => p.id === a.productId);
        const productB = products.find(p => p.id === b.productId);
        if (productA && productB) {
          const nameA = getProductFullName(productA);
          const nameB = getProductFullName(productB);
          if (nameA !== nameB) {
            return nameA.localeCompare(nameB);
          }
        }
        return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
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
        expiryDate: lot.expiryDate,
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
  const canManageRequests = permissions.itemRequests.manage;

  return (
    <div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ListOrdered /> Contagem de Estoque</CardTitle>
        <CardDescription>
          Ajuste a quantidade final de cada lote. O sistema registrará apenas os itens com quantidades alteradas para aprovação.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <Select value={selectedKioskId} onValueChange={setSelectedKioskId}>
            <SelectTrigger className="flex-grow"><SelectValue placeholder="Selecione um quiosque para iniciar..." /></SelectTrigger>
            <SelectContent>
              {kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button 
            variant="outline" 
            onClick={() => setIsRequestModalOpen(true)}
            disabled={!selectedKioskId}
          >
              <PlusCircle className="mr-2 h-4 w-4" />
              Solicitar Cadastro de Insumo
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
                                    <p className="text-xs text-muted-foreground">Lote: {lot.lotNumber} | Val: {format(parseISO(lot.expiryDate), 'dd/MM/yy')}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <FormField
                                    control={form.control}
                                    name={`items.${index}.countedQuantity`}
                                    render={({ field }) => (
                                        <FormItem>
                                        <FormLabel className="text-xs">Qtd. Contada</FormLabel>
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
                    {submitting ? 'Salvando...' : 'Salvar Contagem para Aprovação'}
                  </Button>
                </div>
              </form>
            </Form>
          )
        )}
      </CardContent>
    </Card>

    <RequestItemAdditionModal 
      open={isRequestModalOpen}
      onOpenChange={setIsRequestModalOpen}
      kioskId={selectedKioskId}
    />

    {canManageRequests && (
        <div className="mt-6">
            <Separator />
            <div className="mt-6">
                 <ItemAdditionRequestManagement />
            </div>
        </div>
    )}
    </div>
  );
}
