
"use client"

import React, { useState, useMemo } from 'react';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { PlusCircle, Trash2, Edit, Settings, Search, MoreHorizontal, Inbox, Box } from 'lucide-react';
import { type BaseProduct } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Skeleton } from './ui/skeleton';
import { AddEditBaseProductModal } from './add-edit-base-product-modal';
import { ClassificationManagementModal } from './classification-management-modal';
import { Input } from './ui/input';

export function BaseProductManagement() {
  const { baseProducts, loading, deleteBaseProduct, deleteMultipleBaseProducts } = useBaseProducts();
  const { products } = useProducts();

  const [productToDelete, setProductToDelete] = useState<BaseProduct | null>(null);
  const [productsToDelete, setProductsToDelete] = useState<BaseProduct[]>([]);
  const [productToEditId, setProductToEditId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isClassificationModalOpen, setIsClassificationModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteClick = (product: BaseProduct) => {
    const isUsed = products.some(p => p.baseProductId === product.id);
    if (isUsed) {
      alert(`Não é possível excluir o produto base "${product.name}" pois ele está vinculado a um ou mais insumos.`);
      return;
    }
    setProductsToDelete([product]);
  };
  
  const handleDeleteSelectedClick = () => {
      const toDelete = baseProducts.filter(p => selectedProducts.has(p.id));
      setProductsToDelete(toDelete);
  };

  const handleDeleteMultipleConfirm = async () => {
    if (productsToDelete.length > 0) {
      const idsToDelete = productsToDelete.map(p => p.id);
      const productsWithLinks = idsToDelete.filter(id => products.some(p => p.baseProductId === id));
      
      if (productsWithLinks.length > 0) {
          const names = productsWithLinks.map(id => baseProducts.find(bp => bp.id === id)?.name).join(', ');
          alert(`Erro: Os seguintes produtos base não podem ser excluídos pois estão vinculados a insumos: ${names}.`);
          setProductsToDelete([]);
          return;
      }
      
      setIsDeleting(true);
      try {
          await deleteMultipleBaseProducts(idsToDelete);
          setSelectedProducts(new Set());
          setProductsToDelete([]);
      } finally { setIsDeleting(false); }
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

  const filteredProducts = useMemo(() => {
    const searchLower = searchTerm.toLowerCase();
    return baseProducts.filter(p => 
        p.name.toLowerCase().includes(searchLower) ||
        (p.classification && p.classification.toLowerCase().includes(searchLower))
    );
  }, [baseProducts, searchTerm]);
  
  const handleProductSelectionChange = (id: string, isSelected: boolean) => {
    setSelectedProducts(prev => {
        const newSet = new Set(prev);
        if (isSelected) newSet.add(id);
        else newSet.delete(id);
        return newSet;
    });
  };

  const handleSelectAllChange = (isSelected: boolean) => {
      setSelectedProducts(isSelected ? new Set(filteredProducts.map(p => p.id)) : new Set());
  };

  const allFilteredProductsSelected = filteredProducts.length > 0 && selectedProducts.size === filteredProducts.length;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Gerenciar produtos base</CardTitle>
          <CardDescription>Produtos base agrupam insumos e definem metas de estoque por quiosque.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           <div className="flex flex-col sm:flex-row gap-2">
             <Button onClick={handleAddNew} className="w-full sm:w-auto">
                  <PlusCircle className="mr-2 h-4 w-4" /> Adicionar novo produto base
             </Button>
              <Button variant="outline" onClick={() => setIsClassificationModalOpen(true)} className="w-full sm:w-auto">
                <Settings className="mr-2 h-4 w-4" /> Gerenciar classificações
             </Button>
              <div className="relative flex-grow">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar produto base ou classificação..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
           </div>
           
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-10">
                                <Checkbox 
                                    checked={allFilteredProductsSelected} 
                                    onCheckedChange={(checked) => handleSelectAllChange(!!checked)}
                                    aria-label="Selecionar todos"
                                />
                            </TableHead>
                            <TableHead>Produto Base</TableHead>
                            <TableHead>Classificação</TableHead>
                            <TableHead>Unidade Padrão</TableHead>
                            <TableHead className="w-16 text-right">Ações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            [...Array(5)].map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell colSpan={5}><Skeleton className="h-10 w-full" /></TableCell>
                                </TableRow>
                            ))
                        ) : filteredProducts.length > 0 ? (
                            filteredProducts.map(product => (
                                <TableRow key={product.id}>
                                    <TableCell>
                                        <Checkbox
                                            checked={selectedProducts.has(product.id)}
                                            onCheckedChange={(checked) => handleProductSelectionChange(product.id, !!checked)}
                                        />
                                    </TableCell>
                                    <TableCell className="font-semibold">{product.name}</TableCell>
                                    <TableCell>{product.classification || '-'}</TableCell>
                                    <TableCell>{product.unit}</TableCell>
                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onSelect={() => handleEdit(product)}><Edit className="mr-2 h-4 w-4" /> Editar</DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onSelect={() => handleDeleteClick(product)} className="text-destructive focus:text-destructive">
                                                    <Trash2 className="mr-2 h-4 w-4" /> Excluir
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                                    <div className="flex flex-col items-center gap-2">
                                        <Inbox className="h-10 w-10" />
                                        <span>Nenhum produto base encontrado.</span>
                                    </div>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            {selectedProducts.size > 0 && (
                 <div className="pt-2">
                    <Button variant="destructive" onClick={handleDeleteSelectedClick}>
                        <Trash2 className="mr-2 h-4 w-4" /> Excluir selecionados ({selectedProducts.size})
                    </Button>
                </div>
            )}
        </CardContent>
      </Card>

      <AddEditBaseProductModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        productToEditId={productToEditId}
      />

      <ClassificationManagementModal open={isClassificationModalOpen} onOpenChange={setIsClassificationModalOpen} />

      {productsToDelete.length > 0 && (
        <DeleteConfirmationDialog
          open={productsToDelete.length > 0}
          isDeleting={isDeleting}
          onOpenChange={(isOpen) => { if (!isOpen) setProductsToDelete([]) }}
          onConfirm={handleDeleteMultipleConfirm}
          itemName={productsToDelete.length > 1 ? `os ${productsToDelete.length} produtos base selecionados` : `o produto base "${productsToDelete[0].name}"`}
        />
      )}
    </>
  );
}
