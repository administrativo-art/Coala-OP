

"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useBaseProducts } from "@/hooks/use-base-products";
import { useEntities } from "@/hooks/use-entities";
import { usePurchase } from "@/hooks/use-purchase";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";

interface StartPurchaseSessionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const startSessionSchema = z.object({
  entityId: z.string().min(1, "Selecione um fornecedor."),
  description: z.string().min(3, "O título é obrigatório."),
  baseProductIds: z.array(z.string()).min(1, "Selecione ao menos um insumo base."),
});

type StartSessionFormValues = z.infer<typeof startSessionSchema>;

export function StartPurchaseSessionModal({ open, onOpenChange }: StartPurchaseSessionModalProps) {
  const { baseProducts } = useBaseProducts();
  const { entities } = useEntities();
  const { startNewSession, loading } = usePurchase();

  const form = useForm<StartSessionFormValues>({
    resolver: zodResolver(startSessionSchema),
    defaultValues: {
      entityId: "",
      description: "",
      baseProductIds: [],
    },
  });

  const onSubmit = async (values: StartSessionFormValues) => {
    await startNewSession({
      ...values,
      baseProductIds: values.baseProductIds,
    });
    form.reset();
    onOpenChange(false);
  };
  
  const suppliers = entities.filter(e => e.type === 'pessoa_juridica');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar nova pesquisa de preços</DialogTitle>
          <DialogDescription>
            Selecione o fornecedor e os insumos para iniciar uma nova sessão de pesquisa.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
            <FormField
              control={form.control}
              name="entityId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fornecedor</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o fornecedor da pesquisa" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título da pesquisa</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Ex: Pesquisa de preços semanal - Açaí" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="baseProductIds"
              render={() => (
                <FormItem>
                  <FormLabel>Insumos Base</FormLabel>
                   <ScrollArea className="h-40 w-full rounded-md border p-4">
                     {baseProducts.map((bp) => (
                        <FormField
                            key={bp.id}
                            control={form.control}
                            name="baseProductIds"
                            render={({ field }) => {
                            return (
                                <FormItem
                                key={bp.id}
                                className="flex flex-row items-start space-x-3 space-y-0 mb-2"
                                >
                                <FormControl>
                                    <Checkbox
                                    checked={field.value?.includes(bp.id)}
                                    onCheckedChange={(checked) => {
                                        return checked
                                        ? field.onChange([...field.value, bp.id])
                                        : field.onChange(
                                            field.value?.filter(
                                            (value) => value !== bp.id
                                            )
                                        )
                                    }}
                                    />
                                </FormControl>
                                <Label className="font-normal">
                                    {bp.name}
                                </Label>
                                </FormItem>
                            )
                            }}
                        />
                        ))}
                    </ScrollArea>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                Iniciar Pesquisa
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

    