
"use client"

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { useProducts } from '@/hooks/use-products';
import { useKiosks } from '@/hooks/use-kiosks';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import Papa from 'papaparse';
import * as RadixAccordion from "@radix-ui/react-accordion";
import { Accordion, AccordionContent, AccordionItem } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormMessage, FormLabel, FormDescription } from '@/components/ui/form';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { type Product, unitCategories } from '@/types';
import { Download, PlusCircle, Edit, Trash2, FileUp, Loader2, Info, ChevronDown, Search, Eraser } from 'lucide-react';
import { units } from '@/lib/conversion';
import { Checkbox } from './ui/checkbox';
import { ProductManagement as AddEditProductModal } from './product-management'; // Renamed to avoid confusion

type FormProduct = Product & {
  formId?: string; // from useFieldArray
};

type FormValues = {
  products: FormProduct[];
};

interface ItemManagementProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function ItemManagement({ open, onOpenChange }: ItemManagementProps) {
  const { products, loading: productsLoading, addProduct, updateMultipleProducts, getProductFullName } = useProducts();
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const [isImporting, setIsImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const importFileRef = useRef<HTMLInputElement>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [productToEdit, setProductToEdit] = useState<Product | null>(null);

  const form = useForm<FormValues>({
    defaultValues: { products: [] },
  });

  const { fields, replace } = useFieldArray({
    control: form.control,
    name: "products",
    keyName: "formId"
  });
  
  const filteredFields = useMemo(() => {
    if (!searchTerm) return fields;
    return fields.filter(field => getProductFullName(field).toLowerCase().includes(searchTerm.toLowerCase()));
  }, [fields, searchTerm, getProductFullName]);

  useEffect(() => {
    if (!productsLoading && !kiosksLoading) {
      const initialData: FormProduct[] = products.map(p => {
        const newStockLevels: { [kioskId: string]: { min: number; max: number } } = {};
        kiosks.filter(k => k.id !== 'matriz').forEach(kiosk => {
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
        console.log("Parâmetros salvos!");
    }).catch((err) => {
         console.error("Erro ao salvar os parâmetros.", err);
    });
  };
  
  const handleEditClick = (e: React.MouseEvent, product: Product) => {
    setProductToEdit(product);
    setIsProductModalOpen(true);
  }

  const handleAddNewClick = () => {
    setProductToEdit(null);
    setIsProductModalOpen(true);
  };
  
  if (!open) return null;

  return (
    <>
      <AddEditProductModal
        open={isProductModalOpen}
        onOpenChange={setIsProductModalOpen}
        productToEdit={productToEdit}
      />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 p-4">
          <div className="flex justify-end gap-2 p-1">
               <Button type="button" onClick={handleAddNewClick}>
                      <PlusCircle className="mr-2" /> Adicionar Novo Insumo
               </Button>
          </div>

          <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/50">
              <div className="relative flex-grow">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                      placeholder="Buscar por nome do insumo..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 w-full"
                  />
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSearchTerm('')}>
                  <Eraser className="h-4 w-4" />
              </Button>
          </div>
          
          {filteredFields.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                  <p>Nenhum insumo encontrado.</p>
                  {searchTerm && <p className="text-sm">Tente uma busca diferente ou adicione um novo insumo.</p>}
              </div>
          ) : (
          <Accordion type="multiple" className="w-full space-y-4" defaultValue={filteredFields.map(field => field.id)}>
            {filteredFields.map((field) => {
              const originalIndex = fields.findIndex(f => f.id === field.id);
              return (
                <AccordionItem value={field.id} key={field.formId} className="border rounded-lg bg-card">
                  <RadixAccordion.Header className="flex w-full items-center p-4">
                      <RadixAccordion.Trigger className="flex flex-1 items-center justify-between text-left hover:no-underline font-semibold text-base px-0 py-0 [&[data-state=open]>svg]:rotate-180">
                          <span className="flex-grow text-left">{getProductFullName(field)}</span>
                          <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
                      </RadixAccordion.Trigger>
                      <div className="flex items-center gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
                          <Button type="button" variant="ghost" size="icon" onClick={(e) => handleEditClick(e, field)}>
                              <Edit className="h-4 w-4" />
                          </Button>
                      </div>
                  </RadixAccordion.Header>
                  <AccordionContent className="p-4 pt-0">
                    <div className="space-y-4">
                       <FormField
                        control={form.control}
                        name={`products.${originalIndex}.pdfUnit`}
                        render={({ field: pdfUnitField }) => {
                          const categoryUnits = (field.category && units[field.category]) ? Object.keys(units[field.category]) : [];
                          return (
                            <FormItem className="pt-2">
                              <FormLabel>Unidade de Medida no Relatório (Planilha)</FormLabel>
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
                                {kiosks.filter(k => k.id !== 'matriz').map(kiosk => (
                                    <TableRow key={kiosk.id}>
                                        <TableCell className="font-medium">{kiosk.name}</TableCell>
                                        <TableCell className="text-right">
                                            <FormField
                                                control={form.control}
                                                name={`products.${originalIndex}.stockLevels.${kiosk.id}.min`}
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
                                                name={`products.${originalIndex}.stockLevels.${kiosk.id}.max`}
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
              )
            })}
          </Accordion>
          )}
          <div className="flex justify-end pt-4 mt-6 border-t">
            <Button type="submit" disabled={form.formState.isSubmitting}>Salvar Alterações Gerais</Button>
          </div>
        </form>
      </Form>
    </>
  );
}
