
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
import { useMemo } from 'react';

const returnRequestSchema = z.object({
  tipo: z.enum(['devolucao', 'bonificacao'], { required_error: 'Selecione o tipo.' }),
  insumoId: z.string().min(1, 'Selecione um insumo.'),
  lote: z.string().min(1, 'O lote é obrigatório.'),
  quantidade: z.coerce.number().min(0.01, 'A quantidade deve ser maior que zero.'),
});

type ReturnRequestFormValues = z.infer<typeof returnRequestSchema>;

interface AddReturnRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddReturnRequestModal({ open, onOpenChange }: AddReturnRequestModalProps) {
  const { products, getProductFullName, loading: productsLoading } = useProducts();
  const { addReturnRequest, loading: addingRequest } = useReturnRequests();
  
  const form = useForm<ReturnRequestFormValues>({
    resolver: zodResolver(returnRequestSchema),
    defaultValues: {
      tipo: 'devolucao',
      insumoId: '',
      lote: '',
      quantidade: undefined,
    }
  });

  const onSubmit = async (values: ReturnRequestFormValues) => {
    await addReturnRequest(values);
    onOpenChange(false);
    form.reset();
  };
  
  const activeProducts = useMemo(() => products.filter(p => !p.isArchived), [products]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Abrir Chamado de Devolução/Bonificação</DialogTitle>
          <DialogDescription>
            Preencha os detalhes abaixo para iniciar um novo processo.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
            <FormField
              control={form.control}
              name="tipo"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Tipo de Chamado</FormLabel>
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
                      <FormControl><Input placeholder="Lote do produto" {...field} /></FormControl>
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
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={addingRequest}>
                {addingRequest ? 'Salvando...' : 'Abrir Chamado'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
