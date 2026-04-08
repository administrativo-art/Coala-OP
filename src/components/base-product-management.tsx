

"use client"

import React, { useState, useMemo } from 'react';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { Switch } from './ui/switch';
import { usePurchase } from '@/hooks/use-purchase';
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { PlusCircle, Trash2, Edit, Settings, Search, MoreHorizontal, Inbox, Box, DollarSign } from 'lucide-react';
import { type BaseProduct } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Skeleton } from './ui/skeleton';
import { AddEditBaseProductModal } from './add-edit-base-product-modal';
import { ClassificationManagementModal } from './classification-management-modal';
import { Input } from './ui/input';
import { useClassifications } from '@/hooks/use-classifications';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from './ui/label';

function BulkEditClassificationModal({
  open,
  onOpenChange,
  selectedCount,
  onConfirm
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onConfirm: (classificationId: string) => void;
}) {
  const { classifications, loading } = useClassifications();
  const [selectedClassification, setSelectedClassification] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alterar classificação em massa</DialogTitle>
          <DialogDescription>
            Selecione a nova classificação para os {selectedCount} produtos base selecionados.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Label htmlFor="bulk-classification">Nova classificação</Label>
          <Select
            value={selectedClassification}
            onValueChange={setSelectedClassification}
            disabled={loading}
          >
            <SelectTrigger id="bulk-classification">
              <SelectValue placeholder="Selecione uma classificação..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nenhuma</SelectItem>
              {classifications.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => onConfirm(selectedClassification)} disabled={!selectedClassification}>Aplicar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const formatCurrency = (value: number) => {
    if (!value || isNaN(value)) return 'R$ 0,000';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 3 });
}

export function BaseProductManagement() {
  const { baseProducts, loading: loadingBase, updateBaseProduct, updateMultipleBaseProducts, deleteMultipleBaseProducts } = useBaseProducts();
  const { products, updateMultipleProducts } = useProducts();
  const { lots } = useExpiryProducts();
  const { classifications } = useClassifications();
  const { priceHistory, loading: loadingHistory } = usePurchase();
  const loading = loadingBase || loadingHistory;

  const [productsToDelete, setProductsToDelete] = useState<BaseProduct[]>([]);
  const [productToEditId, setProductToEditId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isClassificationModalOpen, setIsClassificationModalOpen] = useState(false);
  const [isBulkEditModalOpen, setIsBulkEditModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  
  const classificationMap = useMemo(() => {
    return new Map(classifications.map(c => [c.id, c.name]));
  }, [classifications]);

  const handleDeleteClick = (product: BaseProduct) => {
    const isUsed = products.some(p => p.baseProductId === product.id);
    if (isUsed) {
      alert(`Não é possível excluir o produto base "${product.name}" pois ele está vinculado a um ou mais insumos.`);
      return;
    }
    setProductsToDelete([product]);
  };
  
  const handleToggleActive = async (bp: BaseProduct, activate: boolean) => {
    if (!activate) {
      const derivedIds = new Set(products.filter(p => p.baseProductId === bp.id).map(p => p.id));
      const hasStock = lots.some(l => derivedIds.has(l.productId) && l.quantity > 0);
      if (hasStock) {
        alert(`Não é possível desativar "${bp.name}": há lotes com estoque vinculados. Zere o estoque antes de desativar.`);
        return;
      }
    }
    await updateBaseProduct({ ...bp, isArchived: !activate });
    const derived = products.filter(p => p.baseProductId === bp.id);
    if (derived.length > 0) {
      await updateMultipleProducts(derived.map(p => ({ id: p.id, isArchived: !activate })));
    }
  };

  const handleDeleteSelectedClick = () => {
      const toDelete = baseProducts.filter(p => selectedProducts.has(p.id));
      setProductsToDelete(toDelete);
  };

  const handleBulkEditConfirm = async (classificationId: string) => {
    const productsToUpdate = baseProducts
      .filter(p => selectedProducts.has(p.id))
      .map(p => ({ ...p, classification: classificationId === 'none' ? '' : classificationId }));

    await updateMultipleBaseProducts(productsToUpdate);
    setIsBulkEditModalOpen(false);
    setSelectedProducts(new Set());
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

  const { activeFiltered, archivedFiltered } = useMemo(() => {
    const searchLower = searchTerm.toLowerCase();
    const all = baseProducts.filter(p =>
        p.name.toLowerCase().includes(searchLower) ||
        (classificationMap.get(p.classification || '') || '').toLowerCase().includes(searchLower)
    );
    return {
      activeFiltered: all.filter(p => !p.isArchived),
      archivedFiltered: all.filter(p => p.isArchived),
    };
  }, [baseProducts, searchTerm, classificationMap]);

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

  const allActiveSelected = activeFiltered.length > 0 && activeFiltered.every(p => selectedProducts.has(p.id));

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
                            <TableHead>Produto Base</TableHead>
                            <TableHead>Classificação</TableHead>
                            <TableHead>Unidade Padrão</TableHead>
                            <TableHead>Valor</TableHead>
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
                            activeFiltered.map(product => {
                                const effectivePrice = product.lastEffectivePrice?.pricePerUnit ?? product.initialCostPerUnit ?? 0;
                                return (
                                    <TableRow key={product.id}>
                                        <TableCell>
                                            <Checkbox
                                                checked={selectedProducts.has(product.id)}
                                                onCheckedChange={(checked) => handleProductSelectionChange(product.id, !!checked)}
                                            />
                                        </TableCell>
                                        <TableCell className="font-semibold">{product.name}</TableCell>
                                        <TableCell>{product.classification ? (classificationMap.get(product.classification) || '-') : '-'}</TableCell>
                                        <TableCell>{product.unit}</TableCell>
                                        <TableCell className="font-mono text-sm">{formatCurrency(effectivePrice)}</TableCell>
                                        <TableCell className="text-center">
                                            <Switch
                                                checked={true}
                                                onCheckedChange={(checked) => handleToggleActive(product, checked)}
                                                aria-label="Desativar insumo base"
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
                            })
                        ) : (
                            <TableRow>
                                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                    <div className="flex flex-col items-center gap-2">
                                        <Inbox className="h-8 w-8" />
                                        <span>Nenhum produto base ativo.</span>
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
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-1">Inativos ({archivedFiltered.length})</p>
                    <div className="rounded-md border border-dashed opacity-70">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-10" />
                                    <TableHead>Produto Base</TableHead>
                                    <TableHead>Classificação</TableHead>
                                    <TableHead>Unidade Padrão</TableHead>
                                    <TableHead>Valor</TableHead>
                                    <TableHead className="w-20 text-center">Ativo</TableHead>
                                    <TableHead className="w-16 text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {archivedFiltered.map(product => {
                                    const effectivePrice = product.lastEffectivePrice?.pricePerUnit ?? product.initialCostPerUnit ?? 0;
                                    return (
                                        <TableRow key={product.id}>
                                            <TableCell />
                                            <TableCell className="font-semibold">{product.name}</TableCell>
                                            <TableCell>{product.classification ? (classificationMap.get(product.classification) || '-') : '-'}</TableCell>
                                            <TableCell>{product.unit}</TableCell>
                                            <TableCell className="font-mono text-sm">{formatCurrency(effectivePrice)}</TableCell>
                                            <TableCell className="text-center">
                                                <Switch
                                                    checked={false}
                                                    onCheckedChange={(checked) => handleToggleActive(product, checked)}
                                                    aria-label="Ativar insumo base"
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
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            )}
            {selectedProducts.size > 0 && (
                 <div className="pt-2 flex gap-2">
                    <Button variant="outline" onClick={() => setIsBulkEditModalOpen(true)}>
                        <Edit className="mr-2 h-4 w-4" /> Editar selecionados ({selectedProducts.size})
                    </Button>
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

      <BulkEditClassificationModal 
        open={isBulkEditModalOpen}
        onOpenChange={setIsBulkEditModalOpen}
        selectedCount={selectedProducts.size}
        onConfirm={handleBulkEditConfirm}
      />

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

