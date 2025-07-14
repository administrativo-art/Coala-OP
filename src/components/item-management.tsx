
"use client"

import React, { useState, useMemo } from 'react';
import Image from 'next/image';

import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { usePredefinedLists } from '@/hooks/use-predefined-lists';
import { type Product } from '@/types';

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from './ui/checkbox';
import { ScrollArea } from './ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { PlusCircle, Edit, Trash2, Archive } from 'lucide-react';
import { ArchivedProductsModal } from './archived-products-modal';
import { AddEditProductModal } from './add-edit-product-modal';

export function ItemManagement() {
  const { products, loading: productsLoading, getProductFullName, addProduct, updateProduct, deleteProduct, deleteMultipleProducts } = useProducts();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { lists, loading: listsLoading } = usePredefinedLists();

  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [productsToDelete, setProductsToDelete] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);

  const handleEdit = (product: Product) => {
    setProductToEdit(product);
    setIsModalOpen(true);
  };

  const handleDeleteClick = (product: Product) => {
      const usedInLotsCount = lots.filter(lot => lot.productId === product.id).length;
      const usedInLists = lists.filter(list => list.items.some(item => item.productId === product.id));

      let messages = [];
      if (usedInLotsCount > 0) messages.push(`está sendo usado em ${usedInLotsCount} lote(s)`);
      if (usedInLists.length > 0) messages.push(`está nas listas predefinidas: ${usedInLists.map(l => `"${l.name}"`).join(', ')}`);

      if (messages.length > 0) {
          alert(`Não é possível excluir o insumo: Este insumo não pode ser excluído pois ${messages.join(' e ')}.`);
          return;
      }
      setProductToDelete(product);
  };
  
  const handleDeleteConfirm = async () => {
      if (productToDelete) {
          setIsDeleting(true);
          try { await deleteProduct(productToDelete.id); } 
          finally { setIsDeleting(false); setProductToDelete(null); }
      }
  };
  
  const handleArchiveClick = (product: Product) => {
      updateProduct({ ...product, isArchived: true });
  };
  
  const handleAddNewClick = () => {
    setProductToEdit(null);
    setIsModalOpen(true);
  };

  const handleProductSelectionChange = (id: string, isSelected: boolean) => {
    setSelectedProducts(prev => {
        const newSet = new Set(prev);
        if (isSelected) newSet.add(id);
        else newSet.delete(id);
        return newSet;
    });
  };

  const activeProducts = useMemo(() => products.filter(p => !p.isArchived), [products]);

  const handleSelectAllChange = (isSelected: boolean) => {
      setSelectedProducts(isSelected ? new Set(activeProducts.map(p => p.id)) : new Set());
  };

  const handleDeleteSelectedClick = () => {
      const toDelete = products.filter(p => selectedProducts.has(p.id));
      setProductsToDelete(toDelete);
  };

  const handleDeleteMultipleConfirm = async () => {
      if (productsToDelete.length > 0) {
          setIsDeleting(true);
          try {
              const idsToDelete = productsToDelete.map(p => p.id);
              await deleteMultipleProducts(idsToDelete);
              setSelectedProducts(new Set());
              setProductsToDelete([]);
          } finally { setIsDeleting(false); }
      }
  };

  const allProductsSelected = activeProducts.length > 0 && selectedProducts.size === activeProducts.length;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Insumos Cadastrados</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
            <div className="flex gap-2">
              <Button onClick={handleAddNewClick} className="w-full">
                <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Novo Insumo
              </Button>
               <Button variant="outline" onClick={() => setIsArchiveModalOpen(true)} className="w-full">
                <Archive className="mr-2" /> Ver Arquivados
              </Button>
            </div>

            <div className="flex flex-col flex-1 overflow-hidden">
                {activeProducts.length > 0 && (
                <div className="flex items-center gap-3 px-3 py-2 mb-2 border rounded-md bg-muted/50">
                    <Checkbox id="select-all-active-products" checked={allProductsSelected} onCheckedChange={(checked) => handleSelectAllChange(!!checked)} aria-label="Selecionar todos"/>
                    <label htmlFor="select-all-active-products" className="text-sm font-medium leading-none cursor-pointer">Selecionar todos</label>
                </div>
                )}
                <ScrollArea className="h-96 pr-4 -mr-4">
                    <Accordion type="multiple" className="w-full space-y-2">
                        {productsLoading || listsLoading || lotsLoading ? (
                             [...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
                        ) : activeProducts.length > 0 ? activeProducts.map(product => (
                        <AccordionItem value={product.id} key={product.id} className="border-none">
                            <Card>
                                <div className="flex items-center p-4">
                                    <Checkbox
                                        id={`active-product-${product.id}`}
                                        checked={selectedProducts.has(product.id)}
                                        onCheckedChange={(checked) => handleProductSelectionChange(product.id, !!checked)}
                                    />
                                    <AccordionTrigger className="p-0 pl-3 hover:no-underline rounded-lg w-full">
                                        <div className="flex items-center gap-3 w-full">
                                            {product.imageUrl && <Image src={product.imageUrl} alt={product.baseName} width={40} height={40} className="rounded-md object-cover" />}
                                            <span className="font-semibold">{getProductFullName(product)}</span>
                                        </div>
                                    </AccordionTrigger>
                                </div>
                                <AccordionContent className="p-4 pt-0 text-sm text-muted-foreground">
                                    <p><strong>Categoria:</strong> {product.category}</p>
                                    <p><strong>Cód. Barras:</strong> {product.barcode || 'N/A'}</p>
                                    {product.notes && <p><strong>Notas:</strong> {product.notes}</p>}
                                    <div className="flex items-center gap-1 mt-4 pt-4 border-t">
                                        <Button variant="ghost" size="icon" onClick={() => handleEdit(product)}><Edit className="h-4 w-4" /> <span className="sr-only">Editar</span></Button>
                                        <Button variant="ghost" size="icon" onClick={() => handleArchiveClick(product)}><Archive className="h-4 w-4" /> <span className="sr-only">Arquivar</span></Button>
                                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(product)}><Trash2 className="h-4 w-4" /> <span className="sr-only">Excluir</span></Button>
                                    </div>
                                </AccordionContent>
                            </Card>
                        </AccordionItem>
                        )) : (
                             <div className="text-center py-12 text-muted-foreground">
                                <p>Nenhum insumo cadastrado.</p>
                                <p className="text-sm">Clique em "Adicionar Novo Insumo" para começar.</p>
                            </div>
                        )}
                    </Accordion>
                </ScrollArea>
                {activeProducts.length > 0 && (
                    <div className="pt-4 border-t mt-4 shrink-0 flex justify-start">
                        <Button type="button" variant="destructive" onClick={handleDeleteSelectedClick} disabled={selectedProducts.size === 0}>
                            <Trash2 className="mr-2 h-4 w-4" /> Excluir Selecionados ({selectedProducts.size})
                        </Button>
                    </div>
                )}
            </div>
        </CardContent>
      </Card>
      
      <AddEditProductModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        productToEdit={productToEdit}
      />
      
      <ArchivedProductsModal open={isArchiveModalOpen} onOpenChange={setIsArchiveModalOpen} />

      {productToDelete && <DeleteConfirmationDialog open={!!productToDelete} isDeleting={isDeleting} onOpenChange={() => setProductToDelete(null)} onConfirm={handleDeleteConfirm} itemName={`o insumo "${getProductFullName(productToDelete)}"`} />}
      {productsToDelete.length > 0 && <DeleteConfirmationDialog open={productsToDelete.length > 0} isDeleting={isDeleting} onOpenChange={(isOpen) => { if (!isOpen) setProductsToDelete([]); }} onConfirm={handleDeleteMultipleConfirm} itemName={`os ${productsToDelete.length} insumo(s) selecionado(s)`} />}
    </>
  );
}
