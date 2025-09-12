

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
import { Loader2, Calendar as CalendarIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const requestSchema = z.object({
  productName: z.string().min(3, 'O nome do insumo é obrigatório.'),
  brand: z.string().optional(),
  lote: z.string().optional(),
  barcode: z.string().optional(),
  expiryDate: z.date().optional().nullable(),
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
      lote: '',
      barcode: '',
      expiryDate: null,
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
    
    const dataToSend = {
        ...values,
        kioskId,
        expiryDate: values.expiryDate ? values.expiryDate.toISOString() : null
    }

    await addRequest(dataToSend);
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
          <DialogTitle>Solicitar cadastro de insumo</DialogTitle>
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
                name="barcode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Código de barras</FormLabel>
                    <FormControl><Input placeholder="Código de barras" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
             <FormField
                control={form.control}
                name="expiryDate"
                render={({ field }) => (
                <FormItem className="flex flex-col">
                    <FormLabel>Data de vencimento</FormLabel>
                    <Popover>
                    <PopoverTrigger asChild>
                        <FormControl>
                        <Button
                            variant={"outline"}
                            className={cn(
                            "pl-3 text-left font-normal",
                            !field.value && "text-muted-foreground"
                            )}
                        >
                            {field.value ? (
                            format(field.value, "dd/MM/yyyy")
                            ) : (
                            <span>Selecione a data</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                        </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                        mode="single"
                        selected={field.value ?? undefined}
                        onSelect={field.onChange}
                        initialFocus
                        locale={ptBR}
                        />
                    </PopoverContent>
                    </Popover>
                    <FormMessage />
                </FormItem>
                )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Adicione informações relevantes, como quantidade encontrada, etc."
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
                Enviar solicitação
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
