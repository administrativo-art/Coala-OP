
"use client";

import { useState, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useProducts } from '@/hooks/use-products';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from './ui/skeleton';
import { Inbox, ListOrdered, Save, Trash2, ArrowRight } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import Image from 'next/image';
import { format, parseISO } from 'date-fns';
import { ScrollArea } from './ui/scroll-area';
import { type MovementType } from '@/types';

const DIVERGENCE_REASONS: { value: MovementType, label: string }[] = [
    { value: 'SAIDA_CONSUMO', label: 'Consumo / Venda' },
    { value: 'SAIDA_DESCARTE_VENCIMENTO', label: 'Descarte por Vencimento' },
    { value: 'SAIDA_DESCARTE_AVARIA', label: 'Descarte por Avaria/Quebra' },
    { value: 'SAIDA_DESCARTE_PERDA', label: 'Descarte por Perda/Extravio' },
    { value: 'SAIDA_DESCARTE_OUTROS', label: 'Outros (especificar)'},
];

const writeDownItemSchema = z.object({
  lotId: z.string(),
  quantity: z.coerce.number().min(0.01, "Deve ser > 0"),
  type: z.string().min(1, 'Selecione o tipo.'),
  notes: z.string().optional(),
}).refine(data => {
    if (data.type === 'SAIDA_DESCARTE_OUTROS' && (!data.notes || data.notes.trim() === '')) {
        return false;
    }
    return true;
}, {
    message: 'A observação é obrigatória para o tipo "Outros".',
    path: ['notes'],
});

const writeDownFormSchema = z.object({
  items: z.array(writeDownItemSchema).min(1, "Adicione pelo menos um item para baixa."),
});

type WriteDownFormValues = z.infer<typeof writeDownFormSchema>;

export function StockWriteDown() {
  const { user } = useAuth();
  const { kiosks } = useKiosks();
  const { lots, loading: lotsLoading, consumeFromLot } = useExpiryProducts();
  const { products, getProductFullName, loading: productsLoading } = useProducts();
  const { toast } = useToast();
  
  const [selectedKioskId, setSelectedKioskId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<WriteDownFormValues>({
    resolver: zodResolver(writeDownFormSchema),
    defaultValues: { items: [] },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  const kioskLots = useMemo(() => {
    if (!selectedKioskId) return [];
    const lotMap = new Map(lots.map(l => [l.id, l]));
    const productMap = new Map(products.map(p => [p.id, p]));
    
    return lots
      .filter(lot => lot.kioskId === selectedKioskId && lot.quantity > 0)
      .map(lot => ({
        lot,
        product: productMap.get(lot.productId)
      }))
      .filter(item => !!item.product)
      .sort((a, b) => {
        const nameA = getProductFullName(a.product!);
        const nameB = getProductFullName(b.product!);
        return nameA.localeCompare(nameB);
      });
  }, [selectedKioskId, lots, products, getProductFullName]);
  
  const handleAddItem = (lotId: string) => {
    const existingIndex = fields.findIndex(field => field.lotId === lotId);
    if (existingIndex === -1) {
        append({ lotId: lotId, quantity: 1, type: 'SAIDA_CONSUMO', notes: '' });
    }
  };

  const onSubmit = async (values: WriteDownFormValues) => {
    if (!user) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Usuário não autenticado.' });
      return;
    }
    setIsSubmitting(true);
    try {
        for (const item of values.items) {
            await consumeFromLot({
                lotId: item.lotId,
                quantityToConsume: item.quantity,
                type: item.type as MovementType,
                notes: item.notes,
            }, user);
        }
        toast({ title: 'Sucesso!', description: 'Baixas registradas com sucesso.' });
        form.reset({ items: [] });
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Erro ao dar baixa', description: error.message || 'Não foi possível processar a solicitação.' });
    } finally {
        setIsSubmitting(false);
    }
  };
  
  const loading = lotsLoading || productsLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ListOrdered /> Baixa de Estoque</CardTitle>
        <CardDescription>
          Selecione um quiosque, adicione os lotes para baixa e preencha as informações.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Select value={selectedKioskId} onValueChange={(value) => { setSelectedKioskId(value); form.reset({ items: [] }); }}>
          <SelectTrigger><SelectValue placeholder="Selecione um quiosque..." /></SelectTrigger>
          <SelectContent>
            {kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
          </SelectContent>
        </Select>

        {loading && selectedKioskId && <Skeleton className="h-64 w-full" />}
        
        {selectedKioskId && !loading && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Coluna da esquerda - Itens disponíveis */}
                <div className="space-y-2">
                  <h3 className="font-semibold">Itens em estoque ({kioskLots.length})</h3>
                  <ScrollArea className="h-96 rounded-md border p-2">
                    <div className="space-y-2">
                      {kioskLots.length > 0 ? kioskLots.map(({lot, product}) => (
                        <div key={lot.id} className="flex items-center justify-between p-2 border rounded-md">
                          <div>
                            <p className="font-medium">{getProductFullName(product!)}</p>
                            <p className="text-xs text-muted-foreground">Lote: {lot.lotNumber} | Qtd: {lot.quantity}</p>
                          </div>
                          <Button size="icon" variant="outline" onClick={() => handleAddItem(lot.id)} disabled={fields.some(f => f.lotId === lot.id)}>
                              <ArrowRight className="h-4 w-4" />
                          </Button>
                        </div>
                      )) : (
                        <div className="text-center text-muted-foreground p-8">
                          <Inbox className="h-8 w-8 mx-auto mb-2" />
                          <p>Nenhum lote em estoque.</p>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>

                {/* Coluna da direita - Itens para baixa */}
                <div className="space-y-2">
                  <h3 className="font-semibold">Itens para baixa ({fields.length})</h3>
                    <ScrollArea className="h-96 rounded-md border p-2">
                        {fields.length > 0 ? (
                            <div className="space-y-2">
                                {fields.map((field, index) => {
                                    const lot = lots.find(l => l.id === field.lotId);
                                    if (!lot) return null;
                                    const product = products.find(p => p.id === lot.productId);

                                    return (
                                        <Card key={field.id} className="p-4 space-y-4 relative">
                                            <Button type="button" variant="ghost" size="icon" className="absolute top-1 right-1 h-7 w-7 text-destructive" onClick={() => remove(index)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                            <div className="flex items-start gap-4">
                                                {product?.imageUrl && (
                                                    <Image src={product.imageUrl} alt={product.baseName} width={48} height={48} className="rounded-md object-cover" />
                                                )}
                                                <div>
                                                    <p className="font-semibold">{getProductFullName(product!)}</p>
                                                    <p className="text-xs text-muted-foreground">Lote: {lot.lotNumber} | Disponível: {lot.quantity}</p>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <FormField
                                                  control={form.control}
                                                  name={`items.${index}.quantity`}
                                                  render={({ field }) => (
                                                    <FormItem>
                                                      <FormLabel>Quantidade</FormLabel>
                                                      <FormControl><Input type="number" {...field} max={lot.quantity} /></FormControl>
                                                      <FormMessage />
                                                    </FormItem>
                                                  )}
                                                />
                                                <FormField
                                                  control={form.control}
                                                  name={`items.${index}.type`}
                                                  render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>Motivo</FormLabel>
                                                        <Select onValueChange={field.onChange} value={field.value}>
                                                            <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                                                            <SelectContent>
                                                               {DIVERGENCE_REASONS.map(reason => <SelectItem key={reason.value} value={reason.value}>{reason.label}</SelectItem>)}
                                                            </SelectContent>
                                                        </Select>
                                                        <FormMessage/>
                                                    </FormItem>
                                                  )}
                                                />
                                            </div>
                                             <FormField
                                                  control={form.control}
                                                  name={`items.${index}.notes`}
                                                  render={({ field }) => (
                                                    <FormItem>
                                                      <FormLabel>Observação</FormLabel>
                                                      <FormControl><Textarea placeholder="Opcional, exceto para 'Outros'" {...field} /></FormControl>
                                                      <FormMessage />
                                                    </FormItem>
                                                  )}
                                                />
                                        </Card>
                                    );
                                })}
                            </div>
                        ) : (
                             <div className="text-center text-muted-foreground p-8">
                                <p>Adicione itens da lista à esquerda para registrar uma baixa.</p>
                             </div>
                        )}
                    </ScrollArea>
                </div>
              </div>
              <CardFooter className="justify-end border-t pt-6 -mx-6 -mb-6 px-6">
                <Button type="submit" disabled={isSubmitting || fields.length === 0}>
                  <Save className="mr-2 h-4 w-4"/>
                  {isSubmitting ? 'Processando...' : `Confirmar Baixa (${fields.length})`}
                </Button>
              </CardFooter>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}
