
"use client"

import React, { useState } from 'react';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PlusCircle, Trash2, Edit } from 'lucide-react';
import { type BaseProduct } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Skeleton } from './ui/skeleton';

export function BaseProductManagement() {
  const { baseProducts, loading, addBaseProduct, updateBaseProduct, deleteBaseProduct } = useBaseProducts();
  const { products } = useProducts();
  const [newBaseProductName, setNewBaseProductName] = useState('');
  const [editingProduct, setEditingProduct] = useState<BaseProduct | null>(null);
  const [productToDelete, setProductToDelete] = useState<BaseProduct | null>(null);

  const handleAddClick = () => {
    if (newBaseProductName.trim()) {
      addBaseProduct({ name: newBaseProductName.trim() });
      setNewBaseProductName('');
    }
  };

  const handleUpdateClick = () => {
    if (editingProduct && editingProduct.name.trim()) {
      updateBaseProduct(editingProduct);
      setEditingProduct(null);
    }
  };

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

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Gerenciar produtos base</CardTitle>
          <CardDescription>Produtos base são usados para agrupar diferentes variações de um mesmo insumo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Nome do novo produto base"
              value={newBaseProductName}
              onChange={(e) => setNewBaseProductName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddClick()}
            />
            <Button onClick={handleAddClick}>
              <PlusCircle className="mr-2 h-4 w-4" /> Adicionar
            </Button>
          </div>
          <div className="border rounded-lg p-2 space-y-2">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : baseProducts.length > 0 ? (
              baseProducts.map(product => (
                <div key={product.id} className="flex items-center justify-between rounded-md border p-3">
                  {editingProduct?.id === product.id ? (
                    <div className="flex-grow flex gap-2">
                      <Input
                        value={editingProduct.name}
                        onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && handleUpdateClick()}
                      />
                      <Button size="sm" onClick={handleUpdateClick}>Salvar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingProduct(null)}>Cancelar</Button>
                    </div>
                  ) : (
                    <>
                      <span className="font-medium">{product.name}</span>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => setEditingProduct(product)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDeleteClick(product)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))
            ) : (
              <p className="text-center text-muted-foreground py-8">Nenhum produto base cadastrado.</p>
            )}
          </div>
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
