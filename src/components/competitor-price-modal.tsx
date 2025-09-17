
"use client";

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useCompetitors } from '@/hooks/use-competitors';
import { useToast } from '@/hooks/use-toast';
import { type CompetitorProduct, type CompetitorPrice } from '@/types';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Calendar as CalendarIcon, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
import { cn } from '@/lib/utils';
import { Checkbox } from './ui/checkbox';


const priceSchema = z.object({
  price: z.coerce.number().min(0.01, "O preço deve ser maior que zero."),
  data_coleta: z.date({ required_error: 'A data da coleta é obrigatória.'}),
  fonte: z.string().min(1, 'A fonte é obrigatória (ex: iFood, loja física).'),
  promocional: z.boolean(),
});

type FormValues = z.infer<typeof priceSchema>;

interface CompetitorPriceModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: CompetitorProduct;
}

export function CompetitorPriceModal({ isOpen, onClose, product }: CompetitorPriceModalProps) {
  const { competitorPrices, addPrice, deletePrice } = useCompetitors();
  const { toast } = useToast();
  
  const form = useForm<FormValues>({
    resolver: zodResolver(priceSchema),
    defaultValues: {
      price: 0,
      data_coleta: new Date(),
      fonte: '',
      promocional: false,
    }
  });
  
  const productPriceHistory = competitorPrices
    .filter(p => p.competitorProductId === product.id)
    .sort((a, b) => new Date(b.data_coleta).getTime() - new Date(a.data_coleta).getTime());

  const onSubmit = async (values: FormValues) => {
    const dataToSave = {
        ...values,
        competitorProductId: product.id,
        data_coleta: values.data_coleta.toISOString(),
    };
    await addPrice(dataToSave);
    toast({ title: 'Preço adicionado com sucesso!' });
    form.reset({ price: 0, data_coleta: new Date(), fonte: '', promocional: false });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Histórico de Preços</DialogTitle>
          <DialogDescription>
            Gerencie o histórico de preços para o produto: <strong>{product.itemName} ({product.unit})</strong>
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                <FormField
                  control={form.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Novo Preço (R$)</FormLabel>
                      <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField
                    control={form.control}
                    name="data_coleta"
                    render={({ field }) => (
                    <FormItem className="flex flex-col">
                        <FormLabel>Data da coleta</FormLabel>
                        <Popover>
                        <PopoverTrigger asChild>
                            <FormControl>
                            <Button
                                variant={"outline"}
                                className={cn(
                                "w-full justify-start text-left font-normal",
                                !field.value && "text-muted-foreground"
                                )}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {field.value ? format(field.value, "dd/MM/yyyy") : <span>Selecione a data</span>}
                            </Button>
                            </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
                            initialFocus
                            />
                        </PopoverContent>
                        </Popover>
                        <FormMessage />
                    </FormItem>
                    )}
                />
            </div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                 <FormField
                  control={form.control}
                  name="fonte"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fonte da coleta</FormLabel>
                      <FormControl><Input placeholder="Ex: Loja física, iFood" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField
                  control={form.control}
                  name="promocional"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-end space-x-3 space-y-0 rounded-md border p-3">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>
                          Preço promocional
                        </FormLabel>
                      </div>
                    </FormItem>
                  )}
                />
             </div>
            <Button type="submit" className="w-full">Adicionar novo preço</Button>
          </form>
        </Form>

        <Separator />
        
        <h3 className="font-semibold">Histórico de preços</h3>
        <ScrollArea className="h-60">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Preço</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead>Fonte</TableHead>
                        <TableHead></TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {productPriceHistory.map(price => (
                        <TableRow key={price.id}>
                            <TableCell className="font-medium">{price.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} {price.promocional && <Badge variant="outline">Promo</Badge>}</TableCell>
                            <TableCell>{format(parseISO(price.data_coleta), 'dd/MM/yyyy')}</TableCell>
                            <TableCell>{price.fonte}</TableCell>
                            <TableCell className="text-right">
                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deletePrice(price.id)}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </ScrollArea>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
