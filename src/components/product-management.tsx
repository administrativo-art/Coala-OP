
"use client"

import React, { useState, useMemo, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';

import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { usePredefinedLists } from '@/hooks/use-predefined-lists';
import { useBaseProducts } from '@/hooks/use-base-products';
import { type Product, type BaseProduct, unitCategories, type UnitCategory } from '@/types';

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from './ui/checkbox';
import { ScrollArea } from './ui/scroll-area';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { PlusCircle, Edit, Trash2, Archive, Box, Search, MoreHorizontal, Inbox } from 'lucide-react';
import { ArchivedProductsModal } from './archived-products-modal';
import { AddEditProductModal } from './add-edit-product-modal';
import { Input } from './ui/input';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from './ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Badge } from './ui/badge';
import { BaseProductManagement } from './base-product-management';


export function ItemManagement() {
  const { products, loading: productsLoading, getProductFullName, updateProduct, deleteMultipleProducts } = useProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { lists, loading: listsLoading } = usePredefinedLists();

  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBaseProductModalOpen, setIsBaseProductModalOpen] = useState(false);
  const [productsToDelete, setProductsToDelete] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const loading = productsLoading || listsLoading || lotsLoading || baseProductsLoading;

  const baseProductMap = useMemo(() => {
    return new Map(baseProducts.map(bp => [bp.id, bp.name]));
  }, [baseProducts]);

  const activeProducts = useMemo(() => products.filter(p => !p.isArchived), [products]);

  const filteredProducts = useMemo(() => {
    const searchLower = searchTerm.toLowerCase();
    if (!searchLower) return activeProducts;

    return activeProducts.filter(p => {
        const baseProductName = p.baseProductId ? baseProductMap.get(p.baseProductId)?.toLowerCase() : '';
        return getProductFullName(p).toLowerCase().includes(searchLower) ||
               (p.barcode && p.barcode.includes(searchLower)) ||
               (baseProductName && baseProductName.includes(searchLower));
    });
  }, [activeProducts, searchTerm, getProductFullName, baseProductMap]);


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
          alert(`Não é possível excluir o insumo: este insumo não pode ser excluído pois ${messages.join(' e ')}.`);
          return;
      }
      setProductsToDelete([product]);
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

  const handleSelectAllChange = (isSelected: boolean) => {
      setSelectedProducts(isSelected ? new Set(filteredProducts.map(p => p.id)) : new Set());
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

  const allFilteredProductsSelected = filteredProducts.length > 0 && selectedProducts.size === filteredProducts.length;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Insumos cadastrados</CardTitle>
          <CardDescription>Adicione, edite e agrupe os insumos (itens físicos) que compõem seu estoque.</CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
                <Button onClick={handleAddNewClick} className="w-full sm:w-auto">
                    <PlusCircle className="mr-2 h-4 w-4" /> Adicionar insumo
                </Button>
                <div className="relative flex-grow">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por insumo, marca, cód. de barras..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="pl-10 w-full"
                    />
                </div>
            </div>
             <div className="flex gap-2">
                <Button variant="outline" onClick={() => setIsArchiveModalOpen(true)}>
                    <Archive className="mr-2 h-4 w-4" /> Ver arquivados
                </Button>
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
                            <TableHead className="w-[40%]">Insumo</TableHead>
                            <TableHead>Produto Base</TableHead>
                            <TableHead>Embalagem</TableHead>
                            <TableHead>Cód. Barras</TableHead>
                            <TableHead className="w-16 text-right">Ações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            [...Array(5)].map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell colSpan={6}><Skeleton className="h-10 w-full" /></TableCell>
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
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            {product.imageUrl ? (
                                                <Image src={product.imageUrl} alt={product.baseName} width={40} height={40} className="rounded-md object-cover" />
                                            ) : (
                                                <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                                                    <Box className="h-5 w-5 text-muted-foreground" />
                                                </div>
                                            )}
                                            <span className="font-semibold">{getProductFullName(product)}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {product.baseProductId ? (
                                            <Badge variant="secondary">{baseProductMap.get(product.baseProductId) || 'N/A'}</Badge>
                                        ) : (
                                            <span className="text-muted-foreground">-</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {product.packageSize}
                                        {product.unit?.toLowerCase() === 'pacote' ? ' ' : ''}
                                        {product.unit}
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">{product.barcode || '-'}</TableCell>
                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onSelect={() => handleEdit(product)}><Edit className="mr-2 h-4 w-4" /> Editar</DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleArchiveClick(product)}><Archive className="mr-2 h-4 w-4" /> Arquivar</DropdownMenuItem>
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
                                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                                    <div className="flex flex-col items-center gap-2">
                                        <Inbox className="h-10 w-10" />
                                        <span>Nenhum insumo encontrado.</span>
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
      
      <AddEditProductModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        productToEdit={productToEdit}
        onManageBaseProducts={() => {
            setIsModalOpen(false);
            setIsBaseProductModalOpen(true);
        }}
      />
      
      <ArchivedProductsModal open={isArchiveModalOpen} onOpenChange={setIsArchiveModalOpen} />
      
      {productsToDelete.length > 0 && 
        <DeleteConfirmationDialog 
            open={productsToDelete.length > 0} 
            isDeleting={isDeleting} 
            onOpenChange={(isOpen) => { if (!isOpen) setProductsToDelete([]); }} 
            onConfirm={handleDeleteMultipleConfirm} 
            itemName={productsToDelete.length > 1 ? `os ${productsToDelete.length} insumos selecionados` : `o insumo "${getProductFullName(productsToDelete[0])}"`}
        />
      }
    </>
  );
}
