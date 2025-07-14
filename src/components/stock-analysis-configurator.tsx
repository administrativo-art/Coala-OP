
"use client"

import React, { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { useStockAnalysisProducts } from '@/hooks/use-stock-analysis-products';
import { useProducts } from '@/hooks/use-products';

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormMessage, FormLabel } from '@/components/ui/form';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { type AnalysisProduct } from '@/types';
import { Download, PlusCircle, Edit, Trash2, FileUp, Loader2, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';

type FormValues = {
  analysisProducts: AnalysisProduct[];
};

export function StockAnalysisConfigurator() {
  const { analysisProducts, loading, addAnalysisProduct, updateMultipleAnalysisProducts, deleteAnalysisProduct } = useStockAnalysisProducts();
  const { products } = useProducts();
  const { toast } = useToast();
  
  const [editingProduct, setEditingProduct] = useState<AnalysisProduct | null>(null);
  const [newProductName, setNewProductName] = useState('');


  const handleAddProduct = async () => {
    if (newProductName.trim()) {
      await addAnalysisProduct({ itemName: newProductName.trim(), minStock: 0, maxStock: 0 });
      setNewProductName('');
    }
  };

  const handleDeleteProduct = async (id: string) => {
    // Check if any product is using this analysis product
    const isUsed = products.some(p => p.analysisProductId === id);
    if(isUsed) {
        toast({
            variant: "destructive",
            title: "Erro ao excluir",
            description: "Este item de análise está sendo usado por um ou mais insumos e não pode ser excluído.",
        });
        return;
    }
    await deleteAnalysisProduct(id);
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
    <div className="space-y-6">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>O que são Itens de Análise?</AlertTitle>
          <AlertDescription>
            Itens de Análise (ou Produtos Macro) são categorias para agrupar diferentes embalagens de um mesmo insumo. Por exemplo, o item "Ovomaltine" pode agrupar os insumos "Ovomaltine 250g" e "Ovomaltine 500g".
          </AlertDescription>
        </Alert>

        <div className="flex gap-2 p-1">
            <Input 
                placeholder="Nome do novo item de análise (ex: Leite Ninho)"
                value={newProductName}
                onChange={(e) => setNewProductName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddProduct(); }}
            />
            <Button onClick={handleAddProduct}><PlusCircle className="mr-2"/> Adicionar</Button>
        </div>

         <div className="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Nome do Item de Análise</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {analysisProducts.map(product => (
                        <TableRow key={product.id}>
                            <TableCell className="font-medium">{product.itemName}</TableCell>
                            <TableCell className="text-right">
                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteProduct(product.id)}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    </div>
  );
}
