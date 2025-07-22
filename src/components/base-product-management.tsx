

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
            ) : baseProducts.length > 0 ? (
              baseProducts.map(product => {
                const linkedProductsCount = products.filter(p => p.baseProductId === product.id).length;
                return (
                 <AccordionItem value={product.id} key={product.id} className="border-none">
                    <Card>
                        <div className="flex items-center p-2">
                          <AccordionTrigger className="p-2 hover:no-underline rounded-lg [&[data-state=open]]:rounded-b-none flex-grow">
                              <div className="flex flex-col text-left">
                                  <span className="font-semibold">{product.name}</span>
                                  <span className="text-xs text-muted-foreground">{linkedProductsCount} insumo(s) vinculado(s)</span>
                              </div>
                          </AccordionTrigger>
                          <div className="flex items-center shrink-0">
                              <Button variant="ghost" size="icon" onClick={() => handleEdit(product)}>
                                  <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(product)}>
                                  <Trash2 className="h-4 w-4" />
                              </Button>
                          </div>
                        </div>
                        <AccordionContent className="p-4 pt-0">
                           <div className="text-sm space-y-2">
                                <p><strong>Unidade de medida para estoque:</strong> <span className="font-semibold">{product.unit || 'Não definida'}</span></p>
                                <div>
                                    <h4 className="font-semibold mb-1">Níveis de estoque mínimo:</h4>
                                    {Object.keys(product.stockLevels || {}).length > 0 ? (
                                        <ul className="list-disc pl-5">
                                            {Object.entries(product.stockLevels).map(([kioskId, levels]) => (
                                                <li key={kioskId}>
                                                    {getKioskName(kioskId)}: {levels.min} {product.unit}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-muted-foreground">Nenhum nível de estoque mínimo definido.</p>
                                    )}
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
