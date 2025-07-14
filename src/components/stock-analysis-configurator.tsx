
"use client"

import React, { useState, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { PlusCircle, Trash2, Save, Link as LinkIcon } from 'lucide-react';
import { type AnalysisProduct, type Kiosk, type Product } from '@/types';
import { useProducts } from '@/hooks/use-products';
import { useKiosks } from '@/hooks/use-kiosks';
import { useStockAnalysisProducts } from '@/hooks/use-stock-analysis-products';
import { Separator } from './ui/separator';

interface StockAnalysisConfiguratorProps {
    analysisProducts: AnalysisProduct[];
    loading: boolean;
    newCategoryName: string;
    setNewCategoryName: (name: string) => void;
    onAddCategory: () => void;
    onDeleteCategory: (id: string) => void;
}

interface StockLevelFormProps {
    analysisProduct: AnalysisProduct;
    kiosks: Kiosk[];
}

const StockLevelForm: React.FC<StockLevelFormProps> = ({ analysisProduct, kiosks }) => {
    const { updateAnalysisProduct } = useStockAnalysisProducts();
    const { products } = useProducts();
    const { handleSubmit, control, formState, reset } = useForm({
        defaultValues: analysisProduct.stockLevels || {}
    });

    React.useEffect(() => {
        reset(analysisProduct.stockLevels || {});
    }, [analysisProduct, reset]);

    const onSubmit = (data: any) => {
        const stockLevels: { [key: string]: { max: number } } = {};
        for(const kioskId in data) {
            stockLevels[kioskId] = { max: Number(data[kioskId].max) || 0 };
        }
        updateAnalysisProduct({ ...analysisProduct, stockLevels });
    };

    const linkedProducts = useMemo(() => {
        return products.filter(p => p.analysisProductId === analysisProduct.id);
    }, [products, analysisProduct.id]);
    
    if (linkedProducts.length === 0) {
        return <div className="p-4 text-sm text-muted-foreground">nenhum insumo específico vinculado a este produto base. vincule um insumo na tela de 'cadastro de insumos' para configurar os níveis de estoque.</div>
    }

    const firstProductUnit = products.find(p => p.id === linkedProducts[0].id)?.unit;

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <p className="text-sm text-muted-foreground">
                defina o estoque máximo desejado para <span className="font-semibold">{analysisProduct.itemName}</span> em cada quiosque. o sistema usará esta informação para calcular as necessidades de reposição. a unidade de medida para o estoque é <span className="font-semibold">{firstProductUnit || 'unidade base'}</span>.
            </p>
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>quiosque</TableHead>
                            <TableHead className="text-right">estoque máximo</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {kiosks.filter(k => k.id !== 'matriz').map(kiosk => (
                            <TableRow key={kiosk.id}>
                                <TableCell className="font-medium">{kiosk.name}</TableCell>
                                <TableCell className="text-right">
                                    <Controller
                                        name={`${kiosk.id}.max` as const}
                                        control={control}
                                        defaultValue={analysisProduct.stockLevels?.[kiosk.id]?.max || 0}
                                        render={({ field }) => (
                                            <Input
                                                type="number"
                                                className="w-32 ml-auto text-right"
                                                {...field}
                                                onChange={e => field.onChange(parseFloat(e.target.value))}
                                                value={field.value || ''}
                                            />
                                        )}
                                    />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
            <div className="flex justify-end">
                <Button type="submit" disabled={!formState.isDirty}>
                    <Save className="mr-2" /> salvar níveis de estoque
                </Button>
            </div>
        </form>
    );
}

export function StockAnalysisConfigurator({
    analysisProducts,
    loading,
    newCategoryName,
    setNewCategoryName,
    onAddCategory,
    onDeleteCategory,
}: StockAnalysisConfiguratorProps) {
  
  const { products: allProducts } = useProducts();
  const { kiosks } = useKiosks();

  const getLinkedProductsCount = (analysisProductId: string) => {
    return allProducts.filter(p => p.analysisProductId === analysisProductId).length;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>gerenciar produto base</CardTitle>
        <CardDescription>
          produtos base agrupam diferentes insumos. configure aqui o estoque máximo desejado para cada produto base em cada quiosque.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex gap-2 p-1">
            <Input 
                placeholder="nome do novo produto base"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onAddCategory(); }}
            />
            <Button onClick={onAddCategory}><PlusCircle className="mr-2"/> adicionar produto base</Button>
        </div>

        <Accordion type="multiple" className="w-full space-y-3">
            {analysisProducts.length > 0 ? analysisProducts.map(product => {
                const linkedCount = getLinkedProductsCount(product.id);
                return (
                    <AccordionItem value={product.id} key={product.id} className="border-none">
                        <Card className="overflow-hidden">
                            <AccordionTrigger className="px-4 py-2 hover:no-underline w-full flex justify-between items-center rounded-lg">
                                <div className="flex flex-col items-start text-left">
                                  <span className="font-semibold text-lg">{product.itemName}</span>
                                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                                      <LinkIcon className="h-3 w-3" /> {linkedCount} insumo(s) vinculado(s)
                                  </span>
                                </div>
                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive shrink-0" onClick={(e) => { e.stopPropagation(); onDeleteCategory(product.id)}}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </AccordionTrigger>
                            <AccordionContent className="p-4 pt-0">
                                <Separator className="mb-4" />
                                <StockLevelForm analysisProduct={product} kiosks={kiosks} />
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                )
            }) : (
                <div className="text-center text-muted-foreground py-10">
                    <p>nenhum produto base cadastrado.</p>
                </div>
            )}
        </Accordion>
    </CardContent>
    </Card>
  );
}
