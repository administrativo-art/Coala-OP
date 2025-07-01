
"use client"
import React, { useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { useProducts } from '@/hooks/use-products';
import { useKiosks } from '@/hooks/use-kiosks';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormMessage, FormLabel } from '@/components/ui/form';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { type Product } from '@/types';
import { Download } from 'lucide-react';

type FormProduct = Product & {
  formId?: string; // from useFieldArray
};

type FormValues = {
  products: FormProduct[];
};

export function StockAnalysisConfigurator() {
  const { products, loading: productsLoading, updateMultipleProducts } = useProducts();
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
            stockLevels: newStockLevels,
        };
      });
      replace(initialData);
    }
  }, [products, kiosks, productsLoading, kiosksLoading, replace]);
  
  const onSubmit = (data: FormValues) => {
    const productsToUpdate: Product[] = data.products.map(p => {
        const { formId, ...productData } = p;
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

    const head = [['Produto', 'Unidade Base', 'Quiosque', 'Estoque Mínimo', 'Estoque Máximo']];
    const body: any[] = [];

    data.forEach(product => {
      const productInfo = [
        {
          content: product.baseName,
          rowSpan: kiosks.length,
          styles: { valign: 'middle' },
        },
        {
          content: product.unit,
          rowSpan: kiosks.length,
          styles: { valign: 'middle' },
        },
      ];

      kiosks.forEach((kiosk, index) => {
        const minStock = product.stockLevels?.[kiosk.id]?.min ?? 0;
        const maxStock = product.stockLevels?.[kiosk.id]?.max ?? 0;
        const row = [
          kiosk.name,
          `${minStock.toLocaleString()} ${product.unit}`,
          `${maxStock.toLocaleString()} ${product.unit}`,
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
                 {products.find(p => p.id === field.id)!.baseName}
              </AccordionTrigger>
              <AccordionContent className="p-4 pt-0">
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-muted-foreground pt-2">Níveis de Estoque (em {products.find(p=>p.id === field.id)!.unit})</h4>
                   <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Quiosque</TableHead>
                                <TableHead className="text-right w-[150px]">Estoque Mínimo</TableHead>
                                <TableHead className="text-right w-[150px]">Estoque Máximo</TableHead>
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
                                            render={({ field: minField }) => (
                                                <FormItem>
                                                    <FormControl><Input type="number" className="text-right" {...minField} onChange={e => minField.onChange(parseInt(e.target.value, 10) || 0)} /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                            />
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <FormField
                                            control={form.control}
                                            name={`products.${index}.stockLevels.${kiosk.id}.max`}
                                            render={({ field: maxField }) => (
                                                <FormItem>
                                                    <FormControl><Input type="number" className="text-right" {...maxField} onChange={e => maxField.onChange(parseInt(e.target.value, 10) || 0)} /></FormControl>
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
