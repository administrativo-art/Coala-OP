"use client";

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { Loader2, AlertTriangle, CheckSquare, Square } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { useBaseProducts } from '@/hooks/use-base-products';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { type Quotation, type QuotationItem } from '@/types';
import { cn } from '@/lib/utils';

const schema = z.object({
  receiptMode: z.enum(['future_delivery', 'immediate_pickup'] as const),
  paymentMethod: z.enum(['pix', 'card_credit', 'card_debit', 'cash', 'boleto', 'term'] as const),
  paymentDueDate: z.string().min(1, 'Informe o vencimento.'),
  estimatedReceiptDate: z.string().optional(),
  deliveryFee: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const PAYMENT_LABELS: Record<string, string> = {
  pix: 'Pix',
  card_credit: 'Cartão de crédito',
  card_debit: 'Cartão de débito',
  cash: 'Dinheiro',
  boleto: 'Boleto',
  term: 'A prazo',
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  quotation: Quotation;
  items: QuotationItem[];
}

export function CreatePurchaseModal({ open, onOpenChange, quotation, items }: Props) {
  const router = useRouter();
  const { baseProducts } = useBaseProducts();
  const { createPurchase } = usePurchaseOrders();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    const eligible = items.filter(
      (i) => i.conversionStatus === 'selected' && !!i.baseItemId,
    );
    return new Set(eligible.map((i) => i.id));
  });
  const [submitting, setSubmitting] = useState(false);

  const eligibleItems = useMemo(
    () =>
      items.filter((i) => i.conversionStatus === 'selected'),
    [items],
  );

  const freeSelectedCount = useMemo(
    () => [...selectedIds].filter((id) => !items.find((i) => i.id === id)?.baseItemId).length,
    [selectedIds, items],
  );

  const today = format(new Date(), 'yyyy-MM-dd');

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      receiptMode: 'immediate_pickup',
      paymentMethod: 'pix',
      paymentDueDate: today,
      estimatedReceiptDate: today,
      deliveryFee: 0,
      notes: '',
    },
  });

  const receiptMode = form.watch('receiptMode');
  const deliveryFee = form.watch('deliveryFee') ?? 0;

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const eligibleIds = eligibleItems.map((i) => i.id);
    if (eligibleIds.every((id) => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(eligibleIds));
    }
  };

  const totalSelected = useMemo(
    () =>
      [...selectedIds].reduce((sum, id) => {
        const item = items.find((i) => i.id === id);
        return sum + (item?.totalPrice ?? 0);
      }, 0),
    [selectedIds, items],
  );

  const grandTotal = totalSelected + deliveryFee;

  const onSubmit = async (values: FormValues) => {
    if (selectedIds.size === 0 || freeSelectedCount > 0) return;
    setSubmitting(true);
    try {
      const orderItems = [...selectedIds].map((id) => {
        const item = items.find((i) => i.id === id)!;
        return {
          baseItemId: item.baseItemId!,
          productId: item.productId,
          quotationItemId: item.id,
          unit: item.unit,
          purchaseUnitType: item.purchaseUnitType ?? 'content',
          purchaseUnitLabel: item.purchaseUnitLabel ?? item.unit,
          quantityOrdered: item.quantity,
          unitPriceOrdered: item.unitPrice,
          discountOrdered: item.discount ?? 0,
        };
      });

      const orderId = await createPurchase({
        supplierId: quotation.supplierId,
        origin: 'quotation',
        quotationId: quotation.id,
        receiptMode: values.receiptMode,
        paymentMethod: values.paymentMethod,
        paymentDueDate: values.paymentDueDate,
        estimatedReceiptDate:
          values.receiptMode === 'immediate_pickup'
            ? new Date().toISOString()
            : values.estimatedReceiptDate!,
        deliveryFee: values.deliveryFee ?? 0,
        notes: values.notes || undefined,
        items: orderItems,
      });

      if (orderId) {
        onOpenChange(false);
        router.push(`/dashboard/purchasing/orders/${orderId}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const allSelected = eligibleItems.length > 0 && eligibleItems.every((i) => selectedIds.has(i.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="p-6 pb-4 shrink-0">
          <DialogTitle>Criar compra</DialogTitle>
          <DialogDescription>
            Selecione os itens da cotação que deseja comprar e configure o recebimento.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 space-y-5">
          {/* Item selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Itens da cotação ({eligibleItems.length})
              </span>
              <Button variant="ghost" size="sm" onClick={toggleAll} type="button">
                {allSelected ? (
                  <CheckSquare className="mr-1.5 h-4 w-4" />
                ) : (
                  <Square className="mr-1.5 h-4 w-4" />
                )}
                {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
              </Button>
            </div>

            <ScrollArea className="max-h-52 rounded-md border">
              <div className="divide-y">
                {eligibleItems.map((item) => {
                  const base = baseProducts.find((bp) => bp.id === item.baseItemId);
                  const checked = selectedIds.has(item.id);
                  const isFree = !item.baseItemId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => !isFree && toggleItem(item.id)}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                        isFree
                          ? 'cursor-not-allowed opacity-60 bg-amber-50 dark:bg-amber-950/20'
                          : checked
                          ? 'bg-primary/5'
                          : 'hover:bg-muted/50',
                      )}
                    >
                      {isFree ? (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                      ) : checked ? (
                        <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
                      ) : (
                        <Square className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="flex-1 text-sm truncate">
                        {base?.name ?? item.freeText ?? '—'}
                      </span>
                      {isFree && (
                        <Badge variant="outline" className="text-amber-600 border-amber-400 text-xs shrink-0">
                          Livre
                        </Badge>
                      )}
                      <span className="text-sm text-muted-foreground shrink-0">
                        {item.quantity} {item.unit}
                      </span>
                      <span className="text-sm font-medium shrink-0">
                        {item.totalPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </span>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>

            {freeSelectedCount > 0 && (
              <p className="text-xs text-destructive">
                Remova os itens livres da seleção ou normalize-os antes de continuar.
              </p>
            )}

            {selectedIds.size > 0 && (
              <div className="flex justify-between text-sm font-medium pt-1">
                <span>{selectedIds.size} iten{selectedIds.size > 1 ? 's' : ''} selecionado{selectedIds.size > 1 ? 's' : ''}</span>
                <span>
                  Mercadorias:{' '}
                  {totalSelected.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </span>
              </div>
            )}
          </div>

          <Separator />

          {/* Purchase config */}
          <Form {...form}>
            <form id="create-purchase-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="receiptMode"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Tipo de recebimento</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="immediate_pickup">Retirada imediata</SelectItem>
                          <SelectItem value="future_delivery">Entrega futura</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {receiptMode === 'future_delivery' && (
                  <FormField
                    control={form.control}
                    name="estimatedReceiptDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Data estimada de entrega</FormLabel>
                        <FormControl>
                          <Input type="date" min={today} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name="paymentDueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vencimento</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="paymentMethod"
                  render={({ field }) => (
                    <FormItem className={receiptMode === 'future_delivery' ? '' : 'col-span-2'}>
                      <FormLabel>Forma de pagamento</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.entries(PAYMENT_LABELS).map(([v, l]) => (
                            <SelectItem key={v} value={v}>
                              {l}
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
                  name="deliveryFee"
                  render={({ field }) => (
                    <FormItem className={receiptMode === 'future_delivery' ? '' : 'col-span-2'}>
                      <FormLabel>Frete / entrega (opcional)</FormLabel>
                      <FormControl>
                        <CurrencyInput value={field.value ?? 0} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Observações (opcional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Informações adicionais da compra..." {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="col-span-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Mercadorias</span>
                    <span>{totalSelected.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">Frete / entrega</span>
                    <span>{deliveryFee.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between font-medium">
                    <span>Total previsto</span>
                    <span>{grandTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                  </div>
                </div>
              </div>
            </form>
          </Form>
        </div>

        <DialogFooter className="p-6 pt-4 border-t shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="create-purchase-form"
            disabled={submitting || selectedIds.size === 0 || freeSelectedCount > 0}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar compra
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
