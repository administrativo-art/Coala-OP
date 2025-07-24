
"use client";

import React, { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useBaseProducts } from '@/hooks/use-base-products';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';

const sessionSchema = z.object({
  description: z.string().min(3, 'A descrição deve ter pelo menos 3 caracteres.'),
  baseProductIds: z.array(z.string()).min(1, 'Selecione pelo menos um produto base.'),
});

type SessionFormValues = z.infer<typeof sessionSchema>;

interface StartPurchaseSessionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (data: Omit<SessionFormValues, 'entityId'>) => void;
}

export function StartPurchaseSessionModal({ open, onOpenChange, onConfirm }: StartPurchaseSessionModalProps) {
  const { baseProducts, loading: loadingBaseProducts } = useBaseProducts();
  const [searchTerm, setSearchTerm] = useState('');

  const form = useForm<SessionFormValues>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      description: '',
      baseProductIds: [],
    },
  });

  const filteredBaseProducts = useMemo(() => {
    return baseProducts.filter(bp =>
      bp.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [baseProducts, searchTerm]);

  const handleSubmit = (values: SessionFormValues) => {
    onConfirm(values);
    form.reset();
    onOpenChange(false);
  };
  
  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      form.reset();
      setSearchTerm('');
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Criar nova pesquisa de preço</DialogTitle>
          <DialogDescription>
            Defina uma descrição e selecione os produtos base que você deseja cotar com diferentes fornecedores.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição da pesquisa</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Cotação semanal" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div>
              <Label>Produtos base para cotação</Label>
              <Input
                placeholder="Buscar produto..."
                className="mt-2 mb-2"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <ScrollArea className="h-48 rounded-md border p-2">
                <div className="space-y-2">
                  {filteredBaseProducts.map((bp) => (
                    <FormField
                      key={bp.id}
                      control={form.control}
                      name="baseProductIds"
                      render={({ field }) => {
                        return (
                          <FormItem
                            key={bp.id}
                            className="flex flex-row items-start space-x-3 space-y-0"
                          >
                            <FormControl>
                              <Checkbox
                                checked={field.value?.includes(bp.id)}
                                onCheckedChange={(checked) => {
                                  return checked
                                    ? field.onChange([...(field.value || []), bp.id])
                                    : field.onChange(
                                        (field.value || []).filter(
                                          (value) => value !== bp.id
                                        )
                                      )
                                }}
                              />
                            </FormControl>
                            <FormLabel className="font-normal w-full">
                              {bp.name}
                            </FormLabel>
                          </FormItem>
                        )
                      }}
                    />
                  ))}
                </div>
              </ScrollArea>
              <FormMessage>
                {form.formState.errors.baseProductIds?.message}
              </FormMessage>
            </div>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>Cancelar</Button>
              <Button type="submit">Iniciar pesquisa</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
