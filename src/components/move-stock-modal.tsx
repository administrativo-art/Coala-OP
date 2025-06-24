"use client"

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type LotEntry, type Kiosk } from '@/types';

type MoveStockModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lotToMove: LotEntry;
  kiosks: Kiosk[];
  onMoveConfirm: (lotId: string, toKioskId: string, quantity: number) => void;
};

export function MoveStockModal({ open, onOpenChange, lotToMove, kiosks, onMoveConfirm }: MoveStockModalProps) {
  const availableKiosks = kiosks.filter(l => l.id !== lotToMove.kioskId);
  
  const moveSchema = z.object({
    quantity: z.coerce.number()
        .min(1, "A quantidade deve ser de pelo menos 1.")
        .max(lotToMove.quantity, `A quantidade não pode ser maior que ${lotToMove.quantity}.`),
    destinationId: z.string().min(1, 'Selecione um quiosque de destino.'),
  });

  const form = useForm<z.infer<typeof moveSchema>>({
    resolver: zodResolver(moveSchema),
    defaultValues: {
      quantity: 1,
      destinationId: '',
    },
  });

  const onSubmit = (values: z.infer<typeof moveSchema>) => {
    onMoveConfirm(lotToMove.id, values.destinationId, values.quantity);
    onOpenChange(false);
  };
  
  const sourceKioskName = kiosks.find(l => l.id === lotToMove.kioskId)?.name || 'Desconhecido';

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
        if (!isOpen) form.reset();
        onOpenChange(isOpen);
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover Estoque</DialogTitle>
          <DialogDescription>
            Mova itens do lote <strong>{lotToMove.lotNumber}</strong> de <strong>{sourceKioskName}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
            <p><strong>Produto:</strong> {lotToMove.productName}</p>
            <p><strong>Quantidade disponível:</strong> {lotToMove.quantity}</p>
        </div>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantidade a Mover</FormLabel>
                    <FormControl><Input type="number" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="destinationId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mover Para</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={availableKiosks.length === 0}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Destino..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableKiosks.map(kiosk => <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit">Confirmar Movimentação</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
