"use client"
import React, { useEffect, useState, useRef } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { useProducts } from '@/hooks/use-products';
import { useKiosks } from '@/hooks/use-kiosks';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import Papa from 'papaparse';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormMessage, FormLabel, FormDescription } from '@/components/ui/form';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { type Product } from '@/types';
import { Download, PlusCircle, Edit, Trash2, FileUp, Loader2, Info } from 'lucide-react';
import { units } from '@/lib/conversion';

type FormProduct = Product & {
  formId?: string; // from useFieldArray
};

type FormValues = {
  products: FormProduct[];
};

interface StockAnalysisConfiguratorProps {
    onAddNew?: () => void;
    onEdit?: (product: Product) => void;
    onDelete?: (product: Product) => void;
}

export function StockAnalysisConfigurator({ onAddNew, onEdit, onDelete }: StockAnalysisConfiguratorProps) {
  const { products, loading: productsLoading, addProduct, updateMultipleProducts, getProductFullName } = useProducts();
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { toast } = useToast();
  const [isImporting, setIsImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

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
            pdfUnit: p.pdfUnit || '',
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
          content: getProductFullName(product),
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
  
  const handleDownloadTemplate = () => {
    if (kiosksLoading || kiosks.length === 0) {
        toast({
            variant: 'destructive',
            title: 'Quiosques não carregados',
            description: 'Aguarde os quiosques carregarem para gerar o modelo.',
        });
        return;
    }

    const headers = [
        'baseName',
        'category',
        'unit',
        'pdfUnit',
        ...kiosks.flatMap(kiosk => [`min_${kiosk.name}`, `max_${kiosk.name}`])
    ];

    const exampleRow = [
        'Exemplo de Produto', // baseName
        'Massa', // category
        'kg', // unit
        'g', // pdfUnit
        ...kiosks.flatMap(kiosk => ['10', '20']) // example min/max for each kiosk
    ];

    const csvContent = [
        headers.join(','),
        exampleRow.join(',')
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.href) {
        URL.revokeObjectURL(link.href);
    }
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute('download', 'modelo_importacao_itens.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const { id: toastId } = toast({
      title: "Importando planilha...",
      description: "Aguarde enquanto processamos o arquivo.",
    });

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const rows = results.data as any[];
          if (rows.length === 0) {
            throw new Error("A planilha está vazia ou em formato inválido.");
          }

          const kioskNameMap = new Map<string, string>(kiosks.map(k => [k.name.toLowerCase(), k.id]));
          const productsToUpdate: Partial<Product>[] = [];
          const productsToAdd: Omit<Product, 'id'>[] = [];

          for (const row of rows) {
            const baseName = row.baseName?.trim();
            if (!baseName) continue; // Skip rows without a baseName

            const stockLevels: { [kioskId: string]: { min: number; max: number } } = {};
            for (const key in row) {
              if (key.startsWith('min_') || key.startsWith('max_')) {
                const parts = key.split('_');
                const type = parts[0];
                const kioskName = parts.slice(1).join('_').toLowerCase();
                const kioskId = kioskNameMap.get(kioskName);

                if (kioskId) {
                  if (!stockLevels[kioskId]) stockLevels[kioskId] = { min: 0, max: 0 };
                  stockLevels[kioskId][type as 'min' | 'max'] = parseInt(row[key], 10) || 0;
                }
              }
            }
            
            const productData = {
              baseName,
              category: row.category?.trim() || 'Unidade',
              unit: row.unit?.trim() || 'un',
              pdfUnit: row.pdfUnit?.trim() || '',
              packageSize: 1, // Always 1 for analysis items
              stockLevels,
            };

            const existingProduct = products.find(p => p.baseName.toLowerCase() === baseName.toLowerCase());

            if (existingProduct) {
              productsToUpdate.push({ id: existingProduct.id, ...productData });
            } else {
              productsToAdd.push(productData);
            }
          }

          if (productsToUpdate.length > 0) {
            await updateMultipleProducts(productsToUpdate);
          }
          if (productsToAdd.length > 0) {
            await Promise.all(productsToAdd.map(p => addProduct(p)));
          }

          toast({
            id: toastId,
            title: "Importação concluída!",
            description: `${productsToAdd.length} itens adicionados e ${productsToUpdate.length} itens atualizados.`,
          });

        } catch (error: any) {
          toast({
            id: toastId,
            variant: "destructive",
            title: "Erro na importação",
            description: error.message || "Verifique o formato da planilha e tente novamente.",
          });
        } finally {
          setIsImporting(false);
          if (event.target) event.target.value = "";
        }
      },
      error: (error: any) => {
        toast({
          id: toastId,
          variant: "destructive",
          title: "Erro ao ler o arquivo",
          description: error.message,
        });
        setIsImporting(false);
        if (event.target) event.target.value = "";
      }
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
  
  const handleEditClick = (e: React.MouseEvent, product: Product) => {
    e.stopPropagation();
    onEdit?.(product);
  }

  const handleDeleteClick = (e: React.MouseEvent, product: Product) => {
    e.stopPropagation();
    onDelete?.(product);
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Como importar itens em massa?</AlertTitle>
          <AlertDescription>
            Clique em "Baixar Modelo" para obter uma planilha CSV com as colunas corretas.
            Os nomes dos quiosques devem corresponder aos cadastrados no sistema. A coluna `pdfUnit` é opcional.
          </AlertDescription>
        </Alert>
        <div className="flex justify-end gap-2 p-1">
             <Button type="button" variant="outline" onClick={handleDownloadTemplate}>
                <Download className="mr-2" /> Baixar Modelo
             </Button>
             <input type="file" accept=".csv" ref={importFileRef} onChange={handleFileImport} className="hidden" />
             <Button type="button" variant="outline" onClick={() => importFileRef.current?.click()} disabled={isImporting}>
                {isImporting ? <Loader2 className="mr-2 animate-spin" /> : <FileUp className="mr-2" />}
                {isImporting ? 'Importando...' : 'Importar de planilha'}
             </Button>
             {onAddNew && (
                <Button type="button" onClick={onAddNew}>
                    <PlusCircle className="mr-2" /> Adicionar Novo Item
                </Button>
            )}
        </div>
        {fields.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
                <p>Nenhum produto cadastrado para análise.</p>
                <p className="text-sm">Clique em "Adicionar Novo Item" para começar.</p>
            </div>
        ) : (
        <Accordion type="multiple" className="w-full space-y-4" defaultValue={fields.map(field => field.id)}>
          {fields.map((field, index) => (
            <AccordionItem value={field.id} key={field.formId} className="border rounded-lg bg-card">
              <AccordionTrigger className="p-4 hover:no-underline font-semibold text-base">
                 <span className="flex-grow text-left">{getProductFullName(field)}</span>
                 <div className="flex items-center gap-1">
                    {onEdit && (
                         <Button type="button" variant="ghost" size="icon" onClick={(e) => handleEditClick(e, field)}><Edit className="h-4 w-4" /></Button>
                    )}
                     {onDelete && (
                         <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={(e) => handleDeleteClick(e, field)}><Trash2 className="h-4 w-4" /></Button>
                    )}
                 </div>
              </AccordionTrigger>
              <AccordionContent className="p-4 pt-0">
                <div className="space-y-4">
                   <FormField
                    control={form.control}
                    name={`products.${index}.pdfUnit`}
                    render={({ field: pdfUnitField }) => {
                      const categoryUnits = Object.keys(units[field.category]);
                      return (
                        <FormItem className="pt-2">
                          <FormLabel>Unidade de Medida no Relatório (PDF)</FormLabel>
                          <Select
                            onValueChange={(value) => pdfUnitField.onChange(value === 'none' ? '' : value)}
                            value={pdfUnitField.value || 'none'}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione a unidade do relatório" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="none">-- Mesma unidade da embalagem ({field.unit}) --</SelectItem>
                              {categoryUnits.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormDescription>
                            Se a unidade no relatório for diferente da unidade da embalagem, especifique aqui para a conversão correta.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )
                    }}
                  />
                  <h4 className="font-medium text-sm text-muted-foreground pt-2">Níveis de Estoque (em {field.unit})</h4>
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
        )}
        <div className="flex justify-between items-center pt-4 mt-6 border-t">
          <Button type="button" variant="outline" onClick={handleExportPdf}>
            <Download className="mr-2" /> Exportar para PDF
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>Salvar Alterações Gerais</Button>
        </div>
      </form>
    </Form>
  );
}
