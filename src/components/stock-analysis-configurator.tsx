"use client"

import React from 'react';
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { PlusCircle, Trash2 } from 'lucide-react';
import { type AnalysisProduct } from '@/types';

interface StockAnalysisConfiguratorProps {
    analysisProducts: AnalysisProduct[];
    loading: boolean;
    newCategoryName: string;
    setNewCategoryName: (name: string) => void;
    onAddCategory: () => void;
    onDeleteCategory: (id: string) => void;
}

export function StockAnalysisConfigurator({
    analysisProducts,
    loading,
    newCategoryName,
    setNewCategoryName,
    onAddCategory,
    onDeleteCategory,
}: StockAnalysisConfiguratorProps) {

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
        <CardTitle>Cadastro de Categorias (Produtos Macro)</CardTitle>
        <CardDescription>
          Categorias servem para agrupar diferentes embalagens de um mesmo insumo. Por exemplo, a categoria "Ovomaltine" pode agrupar os insumos "Ovomaltine 250g" e "Ovomaltine 500g".
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex gap-2 p-1">
            <Input 
                placeholder="Nome da nova categoria (ex: Leite Ninho)"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onAddCategory(); }}
            />
            <Button onClick={onAddCategory}><PlusCircle className="mr-2"/> Adicionar Categoria</Button>
        </div>

         <div className="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Nome da Categoria</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {analysisProducts.length > 0 ? analysisProducts.map(product => (
                        <TableRow key={product.id}>
                            <TableCell className="font-medium">{product.itemName}</TableCell>
                            <TableCell className="text-right">
                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => onDeleteCategory(product.id)}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </TableCell>
                        </TableRow>
                    )) : (
                        <TableRow>
                            <TableCell colSpan={2} className="text-center text-muted-foreground h-24">
                                Nenhuma categoria cadastrada.
                            </TableCell>
                        </TableRow>
                     )}
                </TableBody>
            </Table>
        </div>
    </CardContent>
    </Card>
  );
}
