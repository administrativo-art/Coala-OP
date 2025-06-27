"use client"
import React, { useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { useStockAnalysisProducts } from '@/hooks/use-stock-analysis-products';
import { useKiosks } from '@/hooks/use-kiosks';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormMessage, FormDescription, FormLabel } from '@/components/ui/form';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { type Product } from '@/types';
import { Switch } from './ui/switch';

// This will be the type for the form, including the calculated field.
type FormProduct = Product & {
  formId?: string; // from useFieldArray
  totalQuantityInPurchaseUnit?: number;
};


type FormValues = {
  products: FormProduct[];
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
    if (!productsLoading && !kiosksLoading && products.length > 0 && kiosks.length > 0) {
      const initialData: FormProduct[] = products.map(p => ({
        ...p,
        hasPurchaseUnit: p.hasPurchaseUnit ?? !!p.purchaseUnitName,
        purchaseUnitName: p.purchaseUnitName || '',
        itemsPerPurchaseUnit: p.itemsPerPurchaseUnit || 1,
        totalQuantityInPurchaseUnit: (p.itemsPerPurchaseUnit || 1) * p.packageSize,
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
    const productsToUpdate: Product[] = data.products.map(p => {
        const { formId, totalQuantityInPurchaseUnit, ...productData } = p;
        if (productData.hasPurchaseUnit && totalQuantityInPurchaseUnit && productData.packageSize > 0) {
            productData.itemsPerPurchaseUnit = Math.round(totalQuantityInPurchaseUnit / productData.packageSize);
        } else if (!productData.hasPurchaseUnit) {
            productData.purchaseUnitName = '';
            productData.itemsPerPurchaseUnit = 1;
        }
        return productData;
    });

    updateMultipleProducts(productsToUpdate).then(() => {
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
                  
                  <FormField
                    control={form.control}
                    name={`products.${index}.hasPurchaseUnit`}
                    render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                            <FormLabel>Usar unidade de compra?</FormLabel>
                            <FormDescription>
                                Ative se você compra este produto em embalagens maiores (caixas, fardos).
                            </FormDescription>
                        </div>
                        <FormControl>
                            <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                            />
                        </FormControl>
                        </FormItem>
                    )}
                  />

                  {form.watch(`products.${index}.hasPurchaseUnit`) && (
                    <div className="space-y-4 pl-4 border-l-2 ml-2">
                        <h4 className="font-medium text-sm text-muted-foreground">Detalhes da Unidade de Compra</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                            control={form.control}
                            name={`products.${index}.purchaseUnitName`}
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Nome da unidade (ex: Caixa)</FormLabel>
                                <FormControl><Input {...field} placeholder="Caixa" /></FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                            />
                            <FormField
                            control={form.control}
                            name={`products.${index}.totalQuantityInPurchaseUnit`}
                            render={({ field: inputField }) => (
                                <FormItem>
                                    <FormLabel>Total na unidade ({products[index].unit})</FormLabel>
                                    <FormControl>
                                        <Input 
                                            type="number" 
                                            {...inputField} 
                                            onChange={e => inputField.onChange(parseFloat(e.target.value) || 0)}
                                            step="any"
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                            />
                        </div>
                    </div>
                  )}

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
