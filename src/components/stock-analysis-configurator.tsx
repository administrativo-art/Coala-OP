
"use client"
import React, { useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { useStockAnalysisProducts } from '@/hooks/use-stock-analysis-products';
import { useKiosks } from '@/hooks/use-kiosks';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormMessage, FormDescription, FormLabel } from '@/components/ui/form';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { type Product } from '@/types';
import { Switch } from './ui/switch';
import { Download } from 'lucide-react';

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

  const watchedProducts = form.watch('products');

  useEffect(() => {
    if (!productsLoading && !kiosksLoading) {
      const initialData: FormProduct[] = products.map(p => {
        const newStockLevels: { [kioskId: string]: { min: number; max: number } } = {};
        kiosks.forEach(kiosk => {
            newStockLevels[kiosk.id] = {
                min: p.stockLevels?.[kiosk.id]?.min || 0,
                max: p.stockLevels?.[kiosk.id]?.max || 0,
            };
        });

        return {
            ...p,
            hasPurchaseUnit: p.hasPurchaseUnit ?? !!p.purchaseUnitName,
            purchaseUnitName: p.purchaseUnitName || '',
            itemsPerPurchaseUnit: p.itemsPerPurchaseUnit || 1,
            totalQuantityInPurchaseUnit: (p.itemsPerPurchaseUnit || 1) * p.packageSize,
            stockLevels: newStockLevels,
        };
      });
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

  const handleExportPdf = () => {
    const data = form.getValues('products');
    
    if (!data.length || !kiosks.length) {
      toast({
        variant: 'destructive',
        title: 'Sem dados para exportar',
        description: 'Não há produtos configurados para análise.',
      });
      return;
    }

    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.text("Parâmetros de Análise de Estoque", 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Exportado em: ${new Date().toLocaleDateString('pt-BR')}`, 14, 29);

    const head = [['Produto', 'Embalagem', 'Unidade de Compra', 'Itens/Unid.', 'Quiosque', 'Estoque Mínimo', 'Estoque Máximo']];
    const body: any[] = [];

    data.forEach(product => {
      const productInfo = [
        {
          content: product.baseName,
          rowSpan: kiosks.length,
          styles: { valign: 'middle' },
        },
        {
          content: `${product.packageSize} ${product.unit}`,
          rowSpan: kiosks.length,
          styles: { valign: 'middle' },
        },
        {
          content: product.purchaseUnitName || '-',
          rowSpan: kiosks.length,
          styles: { valign: 'middle' },
        },
        {
          content: product.hasPurchaseUnit ? (product.itemsPerPurchaseUnit || 1) : '-',
          rowSpan: kiosks.length,
          styles: { valign: 'middle' },
        },
      ];

      kiosks.forEach((kiosk, index) => {
        const row = [
          kiosk.name,
          product.stockLevels?.[kiosk.id]?.min ?? 0,
          product.stockLevels?.[kiosk.id]?.max ?? 0,
        ];
        if (index === 0) {
          body.push([...productInfo, ...row]);
        } else {
          body.push(row);
        }
      });
    });

    autoTable(doc, {
      startY: 35,
      head: head,
      body: body,
      theme: 'grid',
      headStyles: { fillColor: '#3F51B5' },
    });

    doc.save('parametros_de_analise.pdf');
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
                            render={({ field: inputField }) => {
                                const currentProduct = watchedProducts[index];
                                const productInfo = products.find(p => p.id === field.id);
                                
                                const itemsPerUnit = (
                                    currentProduct &&
                                    currentProduct.totalQuantityInPurchaseUnit &&
                                    productInfo && productInfo.packageSize > 0
                                ) ? Math.round(currentProduct.totalQuantityInPurchaseUnit / productInfo.packageSize)
                                : (currentProduct?.itemsPerPurchaseUnit || 0);
                                
                                const purchaseUnitName = currentProduct?.purchaseUnitName || 'unidade de compra';

                                return (
                                    <FormItem>
                                    <FormLabel>Total na unidade ({productInfo?.unit})</FormLabel>
                                    <FormControl>
                                        <Input 
                                            type="number" 
                                            {...inputField} 
                                            onChange={e => inputField.onChange(parseFloat(e.target.value) || 0)}
                                            step="any"
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        Isso equivale a {itemsPerUnit} embalagens por {purchaseUnitName}.
                                    </FormDescription>
                                    <FormMessage />
                                    </FormItem>
                                )
                            }}
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
        <div className="flex justify-between items-center pt-4 border-t">
          <Button type="button" variant="outline" onClick={handleExportPdf}>
            <Download className="mr-2" /> Exportar para PDF
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>Salvar Alterações Gerais</Button>
        </div>
      </form>
    </Form>
  );
}
