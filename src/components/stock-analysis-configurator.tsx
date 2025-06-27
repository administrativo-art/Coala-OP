
"use client"
import React, { useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { useStockAnalysisProducts } from '@/hooks/use-stock-analysis-products';
import { useKiosks } from '@/hooks/use-kiosks';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { type Product } from '@/types';
import { Label } from './ui/label';

type FormValues = {
  products: Product[];
};

export function StockAnalysisConfigurator() {
  const { products, loading: productsLoading, getProductFullName, updateMultipleProducts } = useStockAnalysisProducts();
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { toast } = useToast();

  const form = useForm<FormValues>({
    defaultValues: { products: [] },
  });

  const { fields, replace } = useFieldArray({
    control: form.control,
    name: "products",
    keyName: "formId"
  });

  useEffect(() => {
    if (!productsLoading && !kiosksLoading) {
      const initialData = products.map(p => ({
        ...p,
        purchaseUnitName: p.purchaseUnitName || '',
        itemsPerPurchaseUnit: p.itemsPerPurchaseUnit || 1,
        stockLevels: kiosks.reduce((acc, kiosk) => {
          acc[kiosk.id] = {
            min: p.stockLevels?.[kiosk.id]?.min || 0,
            max: p.stockLevels?.[kiosk.id]?.max || 0,
          };
          return acc;
        }, {} as { [kioskId: string]: { min: number; max: number } }),
      }));
      replace(initialData);
    }
  }, [products, kiosks, productsLoading, kiosksLoading, replace]);
  
  const onSubmit = (data: FormValues) => {
    updateMultipleProducts(data.products).then(() => {
        toast({
            title: "Parâmetros salvos!",
            description: "As configurações de análise de estoque foram atualizadas.",
        });
    }).catch(() => {
         toast({
            variant: "destructive",
            title: "Erro ao salvar",
            description: "Não foi possível salvar os parâmetros. Tente novamente.",
        });
    });
  };

  if (productsLoading || kiosksLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  
  if (!productsLoading && products.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>Nenhum produto configurado para análise.</p>
        <p className="text-sm">Clique em "Gerenciar Produtos para Análise" para adicionar o primeiro.</p>
      </div>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Accordion type="multiple" className="w-full space-y-4" defaultValue={fields.map(field => field.id)}>
          {fields.map((field, index) => (
            <AccordionItem value={field.id} key={field.formId} className="border rounded-lg bg-card">
              <AccordionTrigger className="p-4 hover:no-underline font-semibold text-base">
                {getProductFullName(products.find(p => p.id === field.id)!)}
              </AccordionTrigger>
              <AccordionContent className="p-4 pt-0">
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground">Unidade de Compra</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name={`products.${index}.purchaseUnitName`}
                      render={({ field }) => (
                        <FormItem>
                          <Label>Nome da unidade (ex: Caixa, Fardo)</Label>
                          <FormControl><Input {...field} placeholder="Caixa" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`products.${index}.itemsPerPurchaseUnit`}
                      render={({ field }) => (
                        <FormItem>
                          <Label>Itens por unidade de compra</Label>
                          <FormControl><Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <h4 className="font-medium text-sm text-muted-foreground pt-2">Níveis de Estoque (em embalagens)</h4>
                   <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Quiosque</TableHead>
                                <TableHead className="text-right w-[120px]">Estoque Mínimo</TableHead>
                                <TableHead className="text-right w-[120px]">Estoque Máximo</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {kiosks.map(kiosk => (
                                <TableRow key={kiosk.id}>
                                    <TableCell className="font-medium">{kiosk.name}</TableCell>
                                    <TableCell className="text-right">
                                        <FormField
                                            control={form.control}
                                            name={`products.${index}.stockLevels.${kiosk.id}.min`}
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormControl><Input type="number" className="text-right min-w-[80px]" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                            />
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <FormField
                                            control={form.control}
                                            name={`products.${index}.stockLevels.${kiosk.id}.max`}
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormControl><Input type="number" className="text-right min-w-[80px]" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                            />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                   </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
        <div className="flex justify-end pt-4 border-t">
            <Button type="submit" disabled={form.formState.isSubmitting}>Salvar Alterações Gerais</Button>
        </div>
      </form>
    </Form>
  );
}
