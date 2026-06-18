

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
import { Plus, Trash2, Edit, Tags, Search, MoreHorizontal, Inbox, FileText, Link2 } from 'lucide-react';
import { type BaseProduct } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Skeleton } from './ui/skeleton';
import { AddEditBaseProductModal } from './add-edit-base-product-modal';
import { BaseProductFichaModal } from './base-product-ficha-modal';
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
    const [integerPart, fractionPart = ''] = value.toString().split('.');
    const integer = Number(integerPart).toLocaleString('pt-BR');
    const fraction = fractionPart.padEnd(3, '0');
    return `R$ ${integer},${fraction}`;
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
  const [fichaProduct, setFichaProduct] = useState<BaseProduct | null>(null);
  const [isClassificationModalOpen, setIsClassificationModalOpen] = useState(false);
  const [isBulkEditModalOpen, setIsBulkEditModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClassificationFilter, setSelectedClassificationFilter] = useState('all');
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  
  const classificationMap = useMemo(() => {
    return new Map(classifications.map(c => [c.id, c.name]));
  }, [classifications]);

  const classificationFilters = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of baseProducts) {
      if (product.isArchived) continue;
      const key = product.classification || 'none';
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    return [
      { id: 'all', name: 'Todas', count: baseProducts.filter(p => !p.isArchived).length },
      ...classifications.map(classification => ({
        id: classification.id,
        name: classification.name,
        count: counts.get(classification.id) || 0,
      })),
      { id: 'none', name: 'Sem classificação', count: counts.get('none') || 0 },
    ];
  }, [baseProducts, classifications]);

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
    const all = baseProducts.filter(p => {
      const matchesClassification =
        selectedClassificationFilter === 'all' ||
        (selectedClassificationFilter === 'none' ? !p.classification : p.classification === selectedClassificationFilter);

      if (!matchesClassification) return false;

      return (
        p.name.toLowerCase().includes(searchLower) ||
        (classificationMap.get(p.classification || '') || '').toLowerCase().includes(searchLower)
      );
    });
    return {
      activeFiltered: all.filter(p => !p.isArchived),
      archivedFiltered: all.filter(p => p.isArchived),
    };
  }, [baseProducts, searchTerm, classificationMap, selectedClassificationFilter]);

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
      <Card className="border-0 bg-transparent shadow-none">
        <CardHeader className="px-0 pb-6 pt-0">
          <CardTitle className="text-3xl font-black tracking-[-0.035em] text-[#281f1a] sm:text-4xl">
            Insumos base cadastrados
          </CardTitle>
          <CardDescription className="text-base text-[#756a62] sm:text-lg">
            Catálogo mestre de produtos-tipo que originam os itens de estoque.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 px-0">
           <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
             <div className="flex flex-col gap-3 sm:flex-row">
               <Button
                 variant="outline"
                 onClick={() => setIsClassificationModalOpen(true)}
                 className="h-12 rounded-2xl border-[#dccbb8] bg-[#fffdf9] px-6 text-[#281f1a] hover:bg-white"
               >
                 <Tags className="mr-2 h-4 w-4" /> Categorias de item
               </Button>
               <Button onClick={handleAddNew} className="h-12 rounded-2xl bg-[#a6325b] px-6 text-white hover:bg-[#8e294d]">
                 <Plus className="mr-2 h-5 w-5" /> Adicionar insumo base
               </Button>
             </div>
             <p className="text-sm text-[#756a62]">
               <strong className="text-[#281f1a]">{activeFiltered.length}</strong> de {baseProducts.filter((product) => !product.isArchived).length}
             </p>
           </div>
           <div className="relative">
                <Search className="absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#9e938b]" />
                <Input
                  placeholder="Buscar por nome, código, categoria..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-16 rounded-2xl border-[#dccbb8] bg-[#fffdf9] pl-14 text-base shadow-none placeholder:text-[#8f847b]"
                />
           </div>
           <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {classificationFilters.map(filter => {
                const isSelected = selectedClassificationFilter === filter.id;
                return (
                  <Button
                    key={filter.id}
                    type="button"
                    variant="outline"
                    className={isSelected
                      ? 'h-11 shrink-0 rounded-full border-[#281f1a] bg-[#281f1a] px-5 text-white hover:bg-[#281f1a]/90'
                      : 'h-11 shrink-0 rounded-full border-[#dccbb8] bg-[#fffdf9] px-5 text-[#756a62] hover:bg-white'}
                    onClick={() => {
                      setSelectedClassificationFilter(filter.id);
                      setSelectedProducts(new Set());
                    }}
                  >
                    {filter.name}
                    <span
                      className={
                        isSelected
                          ? 'ml-2 text-xs text-white/70'
                          : 'ml-2 text-xs text-[#9e938b]'
                      }
                    >
                      {filter.count}
                    </span>
                  </Button>
                );
              })}
           </div>
           
            {/* Tabela de Ativos */}
            <div className="overflow-hidden rounded-[26px] border border-[#dccbb8] bg-[#fffdf9]">
                <Table>
                    <TableHeader>
                        <TableRow className="border-[#e6ddd3] hover:bg-transparent">
                            <TableHead className="w-10">
                                <Checkbox
                                    checked={allActiveSelected}
                                    onCheckedChange={(checked) => handleSelectAllChange(!!checked)}
                                    aria-label="Selecionar todos os ativos"
                                />
                            </TableHead>
                            <TableHead className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-[#756a62]">Insumo base</TableHead>
                            <TableHead className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-[#756a62]">Categoria</TableHead>
                            <TableHead className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-[#756a62]">Unidade</TableHead>
                            <TableHead className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-[#756a62]">Custo médio</TableHead>
                            <TableHead className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-[#756a62]">Derivados</TableHead>
                            <TableHead className="w-24 font-mono text-xs font-bold uppercase tracking-[0.12em] text-[#756a62]">Status</TableHead>
                            <TableHead className="w-16 text-right">Ações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            [...Array(5)].map((_, i) => (
                                <TableRow key={i}>
                                <TableCell colSpan={8}><Skeleton className="h-10 w-full" /></TableCell>
                                </TableRow>
                            ))
                        ) : activeFiltered.length > 0 ? (
                            activeFiltered.map(product => {
                                const effectivePrice = product.lastEffectivePrice?.pricePerUnit ?? product.initialCostPerUnit ?? 0;
                                return (
                                    <TableRow key={product.id} className="h-24 border-[#e6ddd3] hover:bg-[#faf6f0]">
                                        <TableCell>
                                            <Checkbox
                                                checked={selectedProducts.has(product.id)}
                                                onCheckedChange={(checked) => handleProductSelectionChange(product.id, !!checked)}
                                            />
                                        </TableCell>
                                        <TableCell>
                                          <div className="flex items-center gap-3">
                                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#ffd4bd] bg-[#fff7ef] text-lg font-black text-[#f97316] shadow-[inset_0_-4px_0_#f97316]">
                                              {product.name.slice(0, 1).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                              <p className="max-w-64 truncate font-bold text-[#281f1a]">{product.name}</p>
                                              <p className="font-mono text-xs uppercase text-[#756a62]">{product.id.slice(0, 8)}</p>
                                            </div>
                                          </div>
                                        </TableCell>
                                        <TableCell>
                                          <span className="inline-flex rounded-full border border-[#ffd1b3] bg-[#fff8f1] px-3 py-1 text-sm font-medium text-[#f97316]">
                                            {product.classification ? (classificationMap.get(product.classification) || '-') : 'Sem categoria'}
                                          </span>
                                        </TableCell>
                                        <TableCell>{product.unit}</TableCell>
                                        <TableCell className="font-mono text-sm">{formatCurrency(effectivePrice)}</TableCell>
                                        <TableCell>
                                          <span className="inline-flex items-center gap-1 text-[#756a62]">
                                            <Link2 className="h-4 w-4" />
                                            {products.filter((derived) => derived.baseProductId === product.id).length}
                                          </span>
                                        </TableCell>
                                        <TableCell>
                                            <button
                                              type="button"
                                              onClick={() => handleToggleActive(product, false)}
                                              className="inline-flex items-center gap-2 font-medium text-[#756a62]"
                                            >
                                              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                                              Ativo
                                            </button>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onSelect={() => setFichaProduct(product)}><FileText className="mr-2 h-4 w-4" /> Ficha Cadastral</DropdownMenuItem>
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
                                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
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
                                                        <DropdownMenuItem onSelect={() => setFichaProduct(product)}><FileText className="mr-2 h-4 w-4" /> Ficha Cadastral</DropdownMenuItem>
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

      <BaseProductFichaModal
        open={!!fichaProduct}
        onOpenChange={(open) => { if (!open) setFichaProduct(null); }}
        baseProduct={fichaProduct}
        onEdit={(bp) => {
          setFichaProduct(null);
          setProductToEditId(bp.id);
          setIsModalOpen(true);
        }}
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
