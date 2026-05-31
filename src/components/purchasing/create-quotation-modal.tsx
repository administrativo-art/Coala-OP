"use client";

import { useState } from 'react';
import { format } from 'date-fns';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useRouter } from 'next/navigation';
import { Loader2, Send } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEntities } from '@/hooks/use-entities';
import { useQuotations } from '@/hooks/use-quotations';
import { type QuotationMode } from '@/types';

const schema = z.object({
  supplierId: z.string().min(1, 'Selecione um fornecedor.'),
  mode: z.enum(['remote', 'in_loco'] as const),
  validUntil: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function CreateQuotationModal({ open, onOpenChange }: Props) {
  const router = useRouter();
  const { entities } = useEntities();
  const { createQuotation } = useQuotations();
  const [submitting, setSubmitting] = useState(false);
  const today = format(new Date(), 'yyyy-MM-dd');

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { supplierId: '', mode: 'remote', validUntil: today, notes: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const id = await createQuotation({
        supplierId: values.supplierId,
        mode: values.mode as QuotationMode,
        validUntil: values.validUntil || undefined,
        notes: values.notes || undefined,
      });
      if (id) {
        onOpenChange(false);
        form.reset({ supplierId: '', mode: 'remote', validUntil: today, notes: '' });
        router.push(`/dashboard/purchasing/quotations/${id}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[620px] overflow-hidden rounded-[18px] border-zinc-200 bg-[#f6f6f7] p-0">
        <div className="border-b border-zinc-200 bg-[#f6f6f7] px-8 pb-5 pt-7">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-violet-600 text-white">
                <Send className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-[1.75rem] font-black leading-none tracking-[-0.045em] text-zinc-950">
                  Nova cotação
                </DialogTitle>
                <p className="mt-2 text-sm text-zinc-500">
                  Abra uma consulta de preço por fornecedor antes de criar o pedido.
                </p>
              </div>
            </div>
          </DialogHeader>
        </div>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 px-8 py-6">
            <div className="rounded-[14px] border border-zinc-200 bg-white p-5">
              <h3 className="text-base font-black tracking-[-0.02em] text-zinc-950">Informações gerais</h3>
              <div className="mt-4 space-y-4">
            <FormField
              control={form.control}
              name="supplierId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fornecedor</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="h-12 rounded-[10px]">
                        <SelectValue placeholder="Selecione um fornecedor" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {entities.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.fantasyName ?? e.name}
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
              name="mode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Modo</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="h-12 rounded-[10px]">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="remote">Remota (digitada)</SelectItem>
                      <SelectItem value="in_loco">In loco (leitor de código)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="validUntil"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Data da cotação</FormLabel>
                  <FormControl>
                    <Input type="date" className="h-12 rounded-[10px]" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações (opcional)</FormLabel>
                  <FormControl>
                    <Textarea rows={3} className="rounded-[10px]" placeholder="Ex: Preços consultados por WhatsApp, Mercado Livre ou fornecedor local" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
              </div>
            </div>

            <DialogFooter className="items-center gap-2 border-t border-zinc-200 pt-5">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="h-11 rounded-[10px] px-5">
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting} className="h-11 rounded-[10px] bg-violet-600 px-5 font-bold text-white hover:bg-violet-700">
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Criar cotação
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
