
"use client"

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProducts } from '@/hooks/use-products';
import { useReturnRequests } from '@/hooks/use-return-requests';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { useMemo, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useExpiryProducts } from '@/hooks/use-expiry-products.tsx';
import { Textarea } from './ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
import { cn } from '@/lib/utils';
import { Calendar as CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const returnRequestSchema = z.object({
  tipo: z.enum(['devolucao', 'bonificacao'], { required_error: 'Selecione o tipo.' }),
  insumoId: z.string().min(1, 'Selecione um insumo.'),
  lote: z.string().min(1, 'O lote é obrigatório.'),
  quantidade: z.coerce.number().min(0.01, 'A quantidade deve ser maior que zero.'),
  motivo: z.string().min(10, 'O motivo deve ter pelo menos 10 caracteres.'),
});

type ReturnRequestFormValues = z.infer<typeof returnRequestSchema>;

interface AddReturnRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddReturnRequestModal({ open, onOpenChange }: AddReturnRequestModalProps) {
  const { products, getProductFullName, loading: productsLoading } = useProducts();
  const { addReturnRequest, loading: addingRequest } = useReturnRequests();
  const { user } = useAuth();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  
  const form = useForm<ReturnRequestFormValues>({
    resolver: zodResolver(returnRequestSchema),
    defaultValues: {
      tipo: 'devolucao',
      insumoId: '',
      lote: '',
      quantidade: undefined,
      motivo: '',
    }
  });

  const selectedInsumoId = form.watch('insumoId');

  const availableLots = useMemo(() => {
    if (!selectedInsumoId || lotsLoading || !user) return [];

    const userVisibleLots = user.username === 'master' 
        ? lots 
        : lots.filter(lot => user.assignedKioskIds.includes(lot.kioskId));

    const productLots = userVisibleLots.filter(lot => lot.productId === selectedInsumoId && lot.quantity > 0);
    
    const uniqueLotsMap = new Map<string, { lotNumber: string, quantity: number }>();

    productLots.forEach(lot => {
        const existing = uniqueLotsMap.get(lot.lotNumber);
        if (existing) {
            existing.quantity += lot.quantity;
        } else {
            uniqueLotsMap.set(lot.lotNumber, { 
                lotNumber: lot.lotNumber, 
                quantity: lot.quantity,
            });
        }
    });

    return Array.from(uniqueLotsMap.values());
  }, [selectedInsumoId, lots, user, lotsLoading]);

  useEffect(() => {
    if(selectedInsumoId) {
      form.resetField('lote');
    }
  }, [selectedInsumoId, form]);

  const onSubmit = async (values: ReturnRequestFormValues) => {
    await addReturnRequest(values);
    onOpenChange(false);
    form.reset();
  };
  
  const activeProducts = useMemo(() => products.filter(p => !p.isArchived), [products]);
  
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      form.reset();
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Abrir chamado de avaria</DialogTitle>
          <DialogDescription>
            Preencha os detalhes abaixo para iniciar um novo processo de devolução ou bonificação.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
            <FormField
              control={form.control}
              name="tipo"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Tipo de chamado</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      className="flex gap-4"
                    >
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl><RadioGroupItem value="devolucao" /></FormControl>
                        <FormLabel className="font-normal">Devolução</FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl><RadioGroupItem value="bonificacao" /></FormControl>
                        <FormLabel className="font-normal">Bonificação</FormLabel>
                      </FormItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="insumoId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Insumo</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={productsLoading}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Selecione o insumo..." /></SelectTrigger></FormControl>
                    <SelectContent>
                      {activeProducts.map(p => <SelectItem key={p.id} value={p.id}>{getProductFullName(p)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
             <div className="grid grid-cols-2 gap-4">
               <FormField
                  control={form.control}
                  name="lote"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lote</FormLabel>
                       <Select
                            onValueChange={field.onChange}
                            value={field.value}
                            disabled={!selectedInsumoId || availableLots.length === 0 || lotsLoading}
                        >
                            <FormControl>
                                <SelectTrigger>
                                    <SelectValue placeholder={
                                        !selectedInsumoId 
                                        ? "Selecione um insumo" 
                                        : lotsLoading
                                        ? "Carregando lotes..."
                                        : availableLots.length === 0 
                                        ? "Nenhum lote disponível" 
                                        : "Selecione o lote"
                                    } />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                {availableLots.map(({ lotNumber, quantity }) => (
                                    <SelectItem key={lotNumber} value={lotNumber}>
                                        {lotNumber} (Qtd: {quantity})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField
                  control={form.control}
                  name="quantidade"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quantidade</FormLabel>
                      <FormControl><Input type="number" placeholder="0" {...field} value={field.value ?? ''} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
             </div>
             <FormField
              control={form.control}
              name="motivo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Descreva o motivo da avaria (ex: produto vencido, embalagem danificada, etc.)"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={addingRequest}>
                {addingRequest ? 'Salvando...' : 'Abrir chamado'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
