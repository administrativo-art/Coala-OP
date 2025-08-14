
"use client"

import React, { useState, useMemo } from 'react';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { useKiosks } from '@/hooks/use-kiosks';
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { PlusCircle, Trash2, Edit, PackagePlus } from 'lucide-react';
import { type BaseProduct } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Skeleton } from './ui/skeleton';
import { AddEditBaseProductModal } from './add-edit-base-product-modal';

export function BaseProductManagement() {
  const { baseProducts, loading, deleteBaseProduct } = useBaseProducts();
  const { products } = useProducts();
  const { kiosks } = useKiosks();

  const [productToDelete, setProductToDelete] = useState<BaseProduct | null>(null);
  const [productToEditId, setProductToEditId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

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

  const handleAddNew = () => {
    setProductToEditId(null);
    setIsModalOpen(true);
  };

  const handleEdit = (product: BaseProduct) => {
    setProductToEditId(product.id);
    setIsModalOpen(true);
  };

  const getKioskName = (kioskId: string) => kiosks.find(k => k.id === kioskId)?.name || 'N/A';

  const baseProductsByClassification = useMemo(() => {
    const grouped: { [key: string]: BaseProduct[] } = {};
    const unclassified: BaseProduct[] = [];

    baseProducts.forEach(product => {
      const classification = product.classification || 'Sem Classificação';
      if(classification === 'Sem Classificação') {
        unclassified.push(product);
      } else {
        if (!grouped[classification]) {
          grouped[classification] = [];
        }
        grouped[classification].push(product);
      }
    });

    Object.keys(grouped).forEach(key => {
      grouped[key].sort((a, b) => a.name.localeCompare(b.name));
    });
    
    unclassified.sort((a, b) => a.name.localeCompare(b.name));

    return { ...grouped, 'Sem Classificação': unclassified };
  }, [baseProducts]);


  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Gerenciar produto base</CardTitle>
          <CardDescription>Produtos base agrupam insumos e definem metas de estoque por quiosque.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           <Button onClick={handleAddNew} className="w-full">
                <PlusCircle className="mr-2 h-4 w-4" /> Adicionar novo produto base
           </Button>
           
           <Accordion type="multiple" className="w-full space-y-2 pt-4 border-t">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : Object.keys(baseProductsByClassification).length > 0 ? (
                Object.entries(baseProductsByClassification).map(([classification, products]) => (
                    products.length > 0 && (
                        <AccordionItem value={classification} key={classification}>
                            <AccordionTrigger className="text-base font-semibold px-2">{classification} ({products.length})</AccordionTrigger>
                            <AccordionContent className="space-y-2 pt-2">
                                {products.map(product => {
                                    const linkedProductsCount = products.filter(p => p.baseProductId === product.id).length;
                                    return (
                                        <Card key={product.id} className="ml-4">
                                            <div className="flex items-center p-2">
                                                <div className="flex-grow pl-2">
                                                    <span className="font-semibold">{product.name}</span>
                                                </div>
                                                <div className="flex items-center shrink-0">
                                                    <Button variant="ghost" size="icon" onClick={() => handleEdit(product)}>
                                                        <Edit className="h-4 w-4" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(product)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </Card>
                                    )
                                })}
                            </AccordionContent>
                        </AccordionItem>
                    )
                ))
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

      <AddEditBaseProductModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        productToEditId={productToEditId}
      />

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
