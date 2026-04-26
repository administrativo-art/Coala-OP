
"use client"

import React, { useState, useMemo } from 'react';
import Image from 'next/image';

import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { usePredefinedLists } from '@/hooks/use-predefined-lists';
import { useBaseProducts } from '@/hooks/use-base-products';
import { type Product } from '@/types';

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from './ui/checkbox';
import { Switch } from './ui/switch';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { PlusCircle, Edit, Trash2, Box, Search, MoreHorizontal, Inbox, AlertTriangle } from 'lucide-react';
import { AddEditProductModal } from './add-edit-product-modal';
import { Input } from './ui/input';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from './ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Badge } from './ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';


export function ItemManagement() {
  const { products, loading: productsLoading, getProductFullName, updateProduct, deleteMultipleProducts } = useProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { lists, loading: listsLoading } = usePredefinedLists();

  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [productsToDelete, setProductsToDelete] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const loading = productsLoading || listsLoading || lotsLoading || baseProductsLoading;

  const baseProductMap = useMemo(() => {
    return new Map(baseProducts.map(bp => [bp.id, bp]));
  }, [baseProducts]);

  const { activeFiltered, archivedFiltered } = useMemo(() => {
    const searchLower = searchTerm.toLowerCase();
    const matched = !searchLower
      ? products
      : products.filter(p => {
          const bp = p.baseProductId ? baseProductMap.get(p.baseProductId) : null;
          return (
            getProductFullName(p).toLowerCase().includes(searchLower) ||
            (p.barcode && p.barcode.includes(searchLower)) ||
            (bp && bp.name.toLowerCase().includes(searchLower))
          );
        });
    return {
      activeFiltered: matched.filter(p => !p.isArchived),
      archivedFiltered: matched.filter(p => p.isArchived),
    };
  }, [products, searchTerm, getProductFullName, baseProductMap]);

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

  const handleToggleActive = async (product: Product, activate: boolean) => {
    await updateProduct({ ...product, isArchived: !activate });
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
    setSelectedProducts(isSelected ? new Set(activeFiltered.map(p => p.id)) : new Set());
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

  const allActiveSelected = activeFiltered.length > 0 && activeFiltered.every(p => selectedProducts.has(p.id));

  const renderBaseProductCell = (product: Product) => {
    if (!product.baseProductId) return <span className="text-muted-foreground">-</span>;
    const bp = baseProductMap.get(product.baseProductId);
    if (!bp) return <Badge variant="secondary">N/A</Badge>;

    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant="secondary">{bp.name}</Badge>
        {bp.isArchived && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="destructive" className="gap-1 cursor-default">
                  <AlertTriangle className="h-3 w-3" />
                  Insumo inativo
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                O produto base "{bp.name}" está desativado. Substitua o insumo base ou desative esta mercadoria.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    );
  };

  const renderRow = (product: Product, isArchived: boolean) => {
    const effectiveName = getProductFullName(product);
    return (
      <TableRow key={product.id}>
        {!isArchived && (
          <TableCell>
            <Checkbox
              checked={selectedProducts.has(product.id)}
              onCheckedChange={(checked) => handleProductSelectionChange(product.id, !!checked)}
            />
          </TableCell>
        )}
        {isArchived && <TableCell />}
        <TableCell>
          <div className="flex items-center gap-3">
            {product.imageUrl ? (
              <Image src={product.imageUrl} alt={product.baseName} width={40} height={40} className="rounded-md object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                <Box className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <span className="font-semibold">{effectiveName}</span>
          </div>
        </TableCell>
        <TableCell>{renderBaseProductCell(product)}</TableCell>
        <TableCell>
          {product.packageSize}
          {product.unit?.toLowerCase() === 'pacote' ? ' ' : ''}
          {product.unit}
        </TableCell>
        <TableCell className="font-mono text-xs">{product.barcode || '-'}</TableCell>
        <TableCell className="text-center">
          <Switch
            checked={!isArchived}
            onCheckedChange={(checked) => handleToggleActive(product, checked)}
            aria-label={isArchived ? 'Ativar insumo' : 'Desativar insumo'}
          />
        </TableCell>
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
    );
  };

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

          {/* Tabela de Ativos */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allActiveSelected}
                      onCheckedChange={(checked) => handleSelectAllChange(!!checked)}
                      aria-label="Selecionar todos os ativos"
                    />
                  </TableHead>
                  <TableHead className="w-[35%]">Insumo</TableHead>
                  <TableHead>Produto Base</TableHead>
                  <TableHead>Embalagem</TableHead>
                  <TableHead>Cód. Barras</TableHead>
                  <TableHead className="w-20 text-center">Ativo</TableHead>
                  <TableHead className="w-16 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7}><Skeleton className="h-10 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : activeFiltered.length > 0 ? (
                  activeFiltered.map(p => renderRow(p, false))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <Inbox className="h-10 w-10" />
                        <span>Nenhum insumo ativo encontrado.</span>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Tabela de Inativos */}
          {archivedFiltered.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-1">
                Inativos ({archivedFiltered.length})
              </p>
              <div className="rounded-md border border-dashed opacity-70">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead className="w-[35%]">Insumo</TableHead>
                      <TableHead>Produto Base</TableHead>
                      <TableHead>Embalagem</TableHead>
                      <TableHead>Cód. Barras</TableHead>
                      <TableHead className="w-20 text-center">Ativo</TableHead>
                      <TableHead className="w-16 text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {archivedFiltered.map(p => renderRow(p, true))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

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
        onManageBaseProducts={() => setIsModalOpen(false)}
      />

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
