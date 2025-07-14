
"use client"

import React, { useState, useMemo } from 'react';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { useKiosks } from '@/hooks/use-kiosks';
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlusCircle, Trash2, Edit, Save, PackagePlus } from 'lucide-react';
import { type BaseProduct, unitCategories } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Skeleton } from './ui/skeleton';
import { units } from '@/lib/conversion';
import { Label } from './ui/label';

type EditableStockLevels = {
    [kioskId: string]: { min: string };
};

interface BaseProductManagementProps {
    newBaseProductName: string;
    setNewBaseProductName: (name: string) => void;
    onAddBaseProduct: () => void;
}

export function BaseProductManagement({ newBaseProductName, setNewBaseProductName, onAddBaseProduct }: BaseProductManagementProps) {
  const { baseProducts, loading, updateMultipleBaseProducts, deleteBaseProduct } = useBaseProducts();
  const { products } = useProducts();
  const { kiosks } = useKiosks();

  const [productToDelete, setProductToDelete] = useState<BaseProduct | null>(null);
  const [editableStockLevels, setEditableStockLevels] = useState<Record<string, EditableStockLevels>>({});
  const [editableUnits, setEditableUnits] = useState<Record<string, string>>({});


  const handleDeleteClick = (product: BaseProduct) => {
    const isUsed = products.some(p => p.baseProductId === product.id);
    if (isUsed) {
      alert(`Não é possível excluir o produto base "${product.name}" pois ele está vinculado a um ou mais insumos.`);
      return;
    }
    setProductToDelete(product);
  };

  const handleDeleteConfirm = async () => {
    if (productToDelete) {
      await deleteBaseProduct(productToDelete.id);
      setProductToDelete(null);
    }
  };

  const handleStockLevelChange = (baseProductId: string, kioskId: string, value: string) => {
    setEditableStockLevels(prev => ({
      ...prev,
      [baseProductId]: {
        ...prev[baseProductId],
        [kioskId]: { min: value },
      }
    }));
  };

  const handleUnitChange = (baseProductId: string, unit: string) => {
    setEditableUnits(prev => ({
      ...prev,
      [baseProductId]: unit,
    }));
  };

  const handleSaveStockLevels = (baseProduct: BaseProduct) => {
    const stockLevelsToSave = editableStockLevels[baseProduct.id];
    const unitToSave = editableUnits[baseProduct.id];
    
    const updatedProducts: BaseProduct[] = [];

    const updatedProduct = { ...baseProduct };

    if (unitToSave) {
        updatedProduct.unit = unitToSave;
    }
    
    if (stockLevelsToSave) {
        updatedProduct.stockLevels = { ...baseProduct.stockLevels };
        for (const kioskId in stockLevelsToSave) {
            const min = parseFloat(stockLevelsToSave[kioskId].min);
            if (!isNaN(min)) {
                 if (!updatedProduct.stockLevels[kioskId]) {
                    updatedProduct.stockLevels[kioskId] = { min: 0 };
                }
                updatedProduct.stockLevels[kioskId].min = min;
            }
        }
    }
    
    updatedProducts.push(updatedProduct);

    if (updatedProducts.length > 0) {
        updateMultipleBaseProducts(updatedProducts);
    }
  };

  const kiosksToDisplay = useMemo(() => kiosks.filter(k => k.id !== 'matriz'), [kiosks]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Gerenciar produto base</CardTitle>
          <CardDescription>Produtos base agrupam insumos e definem metas de estoque por quiosque.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           <div className="flex gap-2">
                <Input
                placeholder="Nome do novo produto base"
                value={newBaseProductName}
                onChange={(e) => setNewBaseProductName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onAddBaseProduct()}
                />
                <Button onClick={onAddBaseProduct}>
                <PlusCircle className="mr-2 h-4 w-4" /> Adicionar
                </Button>
            </div>
           <Accordion type="multiple" className="w-full space-y-2 pt-4 border-t">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : baseProducts.length > 0 ? (
              baseProducts.map(product => {
                const linkedProductsCount = products.filter(p => p.baseProductId === product.id).length;
                const currentUnit = editableUnits[product.id] || product.unit || 'g';

                return (
                 <AccordionItem value={product.id} key={product.id} className="border-none">
                    <Card>
                        <AccordionTrigger className="p-4 hover:no-underline rounded-lg [&[data-state=open]]:rounded-b-none">
                            <div className="flex items-center justify-between w-full">
                                <div className="flex flex-col text-left">
                                    <span className="font-semibold">{product.name}</span>
                                    <span className="text-xs text-muted-foreground">{linkedProductsCount} insumo(s) vinculado(s)</span>
                                </div>
                                <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(product)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="p-4 pt-0">
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4 items-end">
                                    <div className="space-y-1">
                                        <Label>Unidade de medida</Label>
                                        <Select value={currentUnit} onValueChange={(u) => handleUnitChange(product.id, u)}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {Object.entries(units).flatMap(([category, unitMap]) =>
                                                    Object.keys(unitMap).map(unit => (
                                                        <SelectItem key={`${category}-${unit}`} value={unit}>{unit} ({category})</SelectItem>
                                                    ))
                                                )}
                                            </SelectContent>
                                        </Select>
                                        <p className="text-xs text-muted-foreground">Esta unidade será usada para a quantidade mínima.</p>
                                    </div>
                                    <Button onClick={() => handleSaveStockLevels(product)}>
                                        <Save className="mr-2"/> Salvar alterações de estoque
                                    </Button>
                                </div>
                                <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Quiosque</TableHead>
                                            <TableHead className="text-right">Quantidade Mínima ({currentUnit})</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {kiosksToDisplay.map(kiosk => {
                                            const savedMin = product.stockLevels?.[kiosk.id]?.min ?? '';
                                            const editableMin = editableStockLevels[product.id]?.[kiosk.id]?.min;
                                            const displayValue = editableMin !== undefined ? editableMin : savedMin.toString();

                                            return (
                                                <TableRow key={kiosk.id}>
                                                    <TableCell className="font-medium">{kiosk.name}</TableCell>
                                                    <TableCell className="text-right">
                                                        <Input 
                                                            type="number" 
                                                            className="w-32 ml-auto text-right"
                                                            placeholder="0"
                                                            value={displayValue}
                                                            onChange={(e) => handleStockLevelChange(product.id, kiosk.id, e.target.value)}
                                                        />
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                                </div>
                            </div>
                        </AccordionContent>
                    </Card>
                 </AccordionItem>
                )
              })
            ) : (
                <div className="text-center text-muted-foreground py-8 border-2 border-dashed rounded-lg">
                    <PackagePlus className="mx-auto h-10 w-10 mb-2" />
                    <p className="font-semibold">Nenhum produto base cadastrado.</p>
                    <p className="text-sm">Adicione um para começar a agrupar insumos.</p>
                </div>
            )}
            </Accordion>
        </CardContent>
      </Card>
      {productToDelete && (
        <DeleteConfirmationDialog
          open={!!productToDelete}
          onOpenChange={() => setProductToDelete(null)}
          onConfirm={handleDeleteConfirm}
          itemName={`o produto base "${productToDelete.name}"`}
        />
      )}
    </>
  );
}
