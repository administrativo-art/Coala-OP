
"use client";

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from './ui/textarea';
import { useItemAddition } from '@/hooks/use-item-addition';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const requestSchema = z.object({
  productName: z.string().min(3, 'O nome do insumo é obrigatório.'),
  brand: z.string().optional(),
  notes: z.string().optional(),
});

type RequestFormValues = z.infer<typeof requestSchema>;

interface RequestItemAdditionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kioskId: string;
}

export function RequestItemAdditionModal({ open, onOpenChange, kioskId }: RequestItemAdditionModalProps) {
  const { addRequest, loading } = useItemAddition();
  const { toast } = useToast();

  const form = useForm<RequestFormValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: {
      productName: '',
      brand: '',
      notes: '',
    },
  });

  const onSubmit = async (values: RequestFormValues) => {
    if (!kioskId) {
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Nenhum quiosque selecionado. Por favor, selecione um quiosque na tela de contagem.',
      });
      return;
    }
    
    await addRequest({ kioskId, ...values });
    toast({
      title: 'Solicitação enviada!',
      description: 'Sua solicitação de cadastro foi enviada para o administrador.',
    });
    form.reset();
    onOpenChange(false);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      form.reset();
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Solicitar Cadastro de Insumo</DialogTitle>
          <DialogDescription>
            Preencha os dados do insumo encontrado no estoque que não está cadastrado no sistema.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="productName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome do insumo</FormLabel>
                    <FormControl><Input placeholder="Ex: Leite em pó" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="brand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Marca (opcional)</FormLabel>
                    <FormControl><Input placeholder="Ex: Nestlé" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Adicione informações relevantes, como lote, validade, quantidade encontrada, etc."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={loading}>
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enviar Solicitação
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
