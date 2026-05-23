
"use client"

import React, { useState, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';

import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { usePredefinedLists } from '@/hooks/use-predefined-lists';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useOperationalItemCategories } from '@/hooks/use-operational-item-categories';
import { type OperationalItemCategory, type OperationalItemDestination, type Product, type BaseProduct } from '@/types';

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from './ui/checkbox';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { PlusCircle, Edit, Trash2, Archive, Box, Search, MoreHorizontal, Inbox, Save, X, Layers } from 'lucide-react';
import { AddEditProductModal } from './add-edit-product-modal';
import { Input } from './ui/input';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from './ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Badge } from './ui/badge';
import { BaseProductManagement } from './base-product-management';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { useToast } from '@/hooks/use-toast';

const CONTROL_LABELS: Record<OperationalItemDestination, string> = {
  stock: 'Estoque',
  uniform: 'Vestimenta',
  asset: 'Patrimônio',
};

function controlDescription(destination: OperationalItemDestination) {
  if (destination === 'asset') return 'No recebimento, cada unidade vira um patrimônio individual.';
  if (destination === 'uniform') return 'Entra no controle de vestimentas e pode ser entregue a colaboradores.';
  return 'Entra no estoque comum com lote e movimentação.';
}

function OperationalCategoriesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { categories, addCategory, updateCategory } = useOperationalItemCategories();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [controlType, setControlType] = useState<OperationalItemDestination>('stock');
  const [editing, setEditing] = useState<OperationalItemCategory | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingControlType, setEditingControlType] = useState<OperationalItemDestination>('stock');
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await addCategory({ name, destination: controlType });
      setName('');
      setControlType('stock');
      toast({ title: 'Categoria cadastrada.' });
    } catch (error) {
      toast({
        title: 'Erro ao cadastrar categoria',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const startEditing = (category: OperationalItemCategory) => {
    setEditing(category);
    setEditingName(category.name);
    setEditingControlType(category.destination);
  };

  const handleSaveEdit = async () => {
    if (!editing || !editingName.trim()) return;
    setSaving(true);
    try {
      await updateCategory(editing.id, { name: editingName, destination: editingControlType });
      setEditing(null);
      toast({ title: 'Categoria atualizada.' });
    } catch (error) {
      toast({
        title: 'Erro ao atualizar categoria',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Categorias de item</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex: Descartáveis, Manutenção, Escritório"
            />
            <Select value={controlType} onValueChange={(value) => setControlType(value as OperationalItemDestination)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="stock">Estoque</SelectItem>
                <SelectItem value="uniform">Vestimenta</SelectItem>
                <SelectItem value="asset">Patrimônio</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" onClick={handleAdd} disabled={saving || !name.trim()}>
              Adicionar
            </Button>
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="w-40">Tipo de controle</TableHead>
                  <TableHead>Uso no sistema</TableHead>
                  <TableHead className="w-36 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((category) => {
                  const isEditing = editing?.id === category.id;
                  return (
                    <TableRow key={category.id} className={category.isArchived ? 'opacity-60' : undefined}>
                      <TableCell className="font-medium">
                        {isEditing ? (
                          <Input value={editingName} onChange={(event) => setEditingName(event.target.value)} />
                        ) : (
                          category.name
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Select value={editingControlType} onValueChange={(value) => setEditingControlType(value as OperationalItemDestination)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="stock">Estoque</SelectItem>
                              <SelectItem value="uniform">Vestimenta</SelectItem>
                              <SelectItem value="asset">Patrimônio</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="secondary">{CONTROL_LABELS[category.destination]}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {controlDescription(isEditing ? editingControlType : category.destination)}
                      </TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <div className="flex justify-end gap-1">
                            <Button type="button" variant="ghost" size="icon" onClick={handleSaveEdit} disabled={saving || !editingName.trim()}>
                              <Save className="h-4 w-4" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" onClick={() => setEditing(null)} disabled={saving}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-1">
                            <Button type="button" variant="ghost" size="icon" onClick={() => startEditing(category)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => updateCategory(category.id, { isArchived: !category.isArchived })}
                            >
                              {category.isArchived ? 'Ativar' : 'Inativar'}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {categories.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                      Nenhuma categoria de item cadastrada.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type CountingUnitOption = 'package' | 'base' | 'content';
type BulkLogisticsMode = 'set' | 'disable';
type BulkInstructionMode = 'set' | 'disable';

type BulkEditProductsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedProducts: Product[];
  activeCategories: OperationalItemCategory[];
  baseProducts: BaseProduct[];
  onApply: (updates: Partial<Product>) => Promise<void>;
};

function BulkEditProductsDialog({
  open,
  onOpenChange,
  selectedProducts,
  activeCategories,
  baseProducts,
  onApply,
}: BulkEditProductsDialogProps) {
  const [applyOperationalCategory, setApplyOperationalCategory] = useState(false);
  const [operationalCategoryId, setOperationalCategoryId] = useState('');
  const [applyBaseProduct, setApplyBaseProduct] = useState(false);
  const [baseProductId, setBaseProductId] = useState('');
  const [applyCountingUnit, setApplyCountingUnit] = useState(false);
  const [defaultCountingUnit, setDefaultCountingUnit] = useState<CountingUnitOption>('package');
  const [applyLogistics, setApplyLogistics] = useState(false);
  const [logisticsMode, setLogisticsMode] = useState<BulkLogisticsMode>('set');
  const [multiploCaixa, setMultiploCaixa] = useState('');
  const [rotuloCaixa, setRotuloCaixa] = useState('');
  const [applyCountingInstruction, setApplyCountingInstruction] = useState(false);
  const [instructionMode, setInstructionMode] = useState<BulkInstructionMode>('set');
  const [countingInstruction, setCountingInstruction] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const reset = () => {
    setApplyOperationalCategory(false);
    setOperationalCategoryId('');
    setApplyBaseProduct(false);
    setBaseProductId('');
    setApplyCountingUnit(false);
    setDefaultCountingUnit('package');
    setApplyLogistics(false);
    setLogisticsMode('set');
    setMultiploCaixa('');
    setRotuloCaixa('');
    setApplyCountingInstruction(false);
    setInstructionMode('set');
    setCountingInstruction('');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const handleSubmit = async () => {
    const updates: Partial<Product> = {};

    if (applyOperationalCategory) {
      if (!operationalCategoryId) return;
      const category = activeCategories.find((item) => item.id === operationalCategoryId);
      updates.operationalCategoryId = operationalCategoryId;
      updates.operationalCategoryName = category?.name;
      updates.operationalDestination = category?.destination;
    }

    if (applyBaseProduct) {
      updates.baseProductId = baseProductId === '_clear' ? '' : baseProductId;
    }

    if (applyCountingUnit) {
      updates.defaultCountingUnit = defaultCountingUnit;
    }

    if (applyLogistics) {
      if (logisticsMode === 'disable') {
        updates.multiplo_caixa = 0;
        updates.rotulo_caixa = '';
      } else {
        const quantity = Number(multiploCaixa);
        if (!quantity || quantity <= 0 || !rotuloCaixa) return;
        updates.multiplo_caixa = quantity;
        updates.rotulo_caixa = rotuloCaixa;
      }
    }

    if (applyCountingInstruction) {
      if (instructionMode === 'disable') {
        updates.countingInstruction = '';
        updates.countingInstructionImageUrl = '';
      } else {
        updates.countingInstruction = countingInstruction.trim();
      }
    }

    if (Object.keys(updates).length === 0) return;

    setIsSaving(true);
    try {
      await onApply(updates);
      handleOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  const canSubmit =
    (applyOperationalCategory && !!operationalCategoryId) ||
    (applyBaseProduct && !!baseProductId) ||
    applyCountingUnit ||
    (applyLogistics && (logisticsMode === 'disable' || (!!rotuloCaixa && Number(multiploCaixa) > 0))) ||
    applyCountingInstruction;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Alterar insumos em lote</DialogTitle>
          <DialogDescription>
            As alterações marcadas serão aplicadas a {selectedProducts.length} insumo(s) selecionado(s).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={applyOperationalCategory} onCheckedChange={(checked) => setApplyOperationalCategory(!!checked)} />
              Categoria do item
            </label>
            <Select value={operationalCategoryId} onValueChange={setOperationalCategoryId} disabled={!applyOperationalCategory}>
              <SelectTrigger><SelectValue placeholder="Selecione a categoria..." /></SelectTrigger>
              <SelectContent>
                {activeCategories
                  .filter((category) => category.destination !== 'asset')
                  .map((category) => (
                    <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={applyBaseProduct} onCheckedChange={(checked) => setApplyBaseProduct(!!checked)} />
              Insumo base
            </label>
            <Select value={baseProductId} onValueChange={setBaseProductId} disabled={!applyBaseProduct}>
              <SelectTrigger><SelectValue placeholder="Selecione o insumo base..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_clear">Sem vínculo</SelectItem>
                {baseProducts
                  .filter((baseProduct) => !baseProduct.isArchived)
                  .map((baseProduct) => (
                    <SelectItem key={baseProduct.id} value={baseProduct.id}>{baseProduct.name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={applyCountingUnit} onCheckedChange={(checked) => setApplyCountingUnit(!!checked)} />
              Forma da contagem de estoque
            </label>
            <Select value={defaultCountingUnit} onValueChange={(value) => setDefaultCountingUnit(value as CountingUnitOption)} disabled={!applyCountingUnit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="package">Unidade do Lote</SelectItem>
                <SelectItem value="base">Unidade do Produto Base</SelectItem>
                <SelectItem value="content">Unidade do Conteúdo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={applyLogistics} onCheckedChange={(checked) => setApplyLogistics(!!checked)} />
              Detalhes logísticos
            </label>
            <Select value={logisticsMode} onValueChange={(value) => setLogisticsMode(value as BulkLogisticsMode)} disabled={!applyLogistics}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="set">Definir agrupamento</SelectItem>
                <SelectItem value="disable">Remover agrupamento</SelectItem>
              </SelectContent>
            </Select>
            {logisticsMode === 'set' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Quantidade</Label>
                  <Input type="number" step="1" value={multiploCaixa} onChange={(event) => setMultiploCaixa(event.target.value)} disabled={!applyLogistics} placeholder="Ex: 12" />
                </div>
                <div className="space-y-2">
                  <Label>Tipo de agrupamento</Label>
                  <Select value={rotuloCaixa} onValueChange={setRotuloCaixa} disabled={!applyLogistics}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Caixa">Caixa</SelectItem>
                      <SelectItem value="Fardo">Fardo</SelectItem>
                      <SelectItem value="Pallet">Pallet</SelectItem>
                      <SelectItem value="Tambor">Tambor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-md border p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={applyCountingInstruction} onCheckedChange={(checked) => setApplyCountingInstruction(!!checked)} />
              Instrução de contagem
            </label>
            <Select value={instructionMode} onValueChange={(value) => setInstructionMode(value as BulkInstructionMode)} disabled={!applyCountingInstruction}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="set">Definir texto</SelectItem>
                <SelectItem value="disable">Remover instrução</SelectItem>
              </SelectContent>
            </Select>
            {instructionMode === 'set' && (
              <Textarea
                value={countingInstruction}
                onChange={(event) => setCountingInstruction(event.target.value)}
                disabled={!applyCountingInstruction}
                placeholder="Ex: Contar por peso na balança..."
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSaving}>Cancelar</Button>
          <Button type="button" onClick={handleSubmit} disabled={isSaving || !canSubmit}>
            {isSaving ? 'Salvando...' : 'Aplicar alterações'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


export function ItemManagement() {
  const { products, loading: productsLoading, getProductFullName, updateProduct, updateMultipleProducts, deleteMultipleProducts } = useProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { activeCategories, loading: categoriesLoading } = useOperationalItemCategories();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { lists, loading: listsLoading } = usePredefinedLists();
  const { toast } = useToast();

  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBaseProductModalOpen, setIsBaseProductModalOpen] = useState(false);
  const [isOperationalCategoriesOpen, setIsOperationalCategoriesOpen] = useState(false);
  const [productsToDelete, setProductsToDelete] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
const [searchTerm, setSearchTerm] = useState('');
const [categoryFilter, setCategoryFilter] = useState<string>('Todos');
  
  const loading = productsLoading || listsLoading || lotsLoading || baseProductsLoading || categoriesLoading;

  const baseProductMap = useMemo(() => {
    return new Map(baseProducts.map(bp => [bp.id, bp]));
  }, [baseProducts]);

  const { activeFiltered, archivedFiltered } = useMemo(() => {
    const searchLower = searchTerm.toLowerCase();
    const matches = (p: Product) => {
      if (!searchLower) return true;
      const baseProductName = p.baseProductId ? baseProductMap.get(p.baseProductId)?.name.toLowerCase() : '';
      return getProductFullName(p).toLowerCase().includes(searchLower) ||
             (p.barcode && p.barcode.includes(searchLower)) ||
             (baseProductName && baseProductName.includes(searchLower));
    };
    const matchesCategory = (p: Product) =>
      categoryFilter === 'Todos' ||
      p.operationalCategoryId === categoryFilter ||
      (categoryFilter === '_sem_categoria' && !p.operationalCategoryId);
    return {
      activeFiltered: products.filter(p => !p.isArchived && matches(p) && matchesCategory(p)),
      archivedFiltered: products.filter(p => p.isArchived && matches(p) && matchesCategory(p)),
    };
  }, [products, searchTerm, categoryFilter, getProductFullName, baseProductMap]);

  const categoryFilters = useMemo(() => {
    const counts = new Map<string, number>();
    products
      .filter((p) => !p.isArchived)
      .forEach((p) => {
        const key = p.operationalCategoryId || '_sem_categoria';
        counts.set(key, (counts.get(key) ?? 0) + 1);
      });
    return [
      { id: 'Todos', label: 'Todos', count: products.filter((p) => !p.isArchived).length },
      ...activeCategories.map((category) => ({
        id: category.id,
        label: category.name,
        count: counts.get(category.id) ?? 0,
      })),
      ...(counts.has('_sem_categoria') ? [{ id: '_sem_categoria', label: 'Sem categoria', count: counts.get('_sem_categoria') ?? 0 }] : []),
    ];
  }, [activeCategories, products]);


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

  const selectedProductList = useMemo(() => {
    return products.filter((product) => selectedProducts.has(product.id));
  }, [products, selectedProducts]);

  const handleBulkApply = async (updates: Partial<Product>) => {
    const productsToUpdate = selectedProductList.map((product) => ({ ...product, ...updates }));
    await updateMultipleProducts(productsToUpdate);
    setSelectedProducts(new Set());
    toast({
      title: 'Alteração em lote aplicada',
      description: `${productsToUpdate.length} insumo(s) atualizado(s).`,
    });
  };

  const allActiveSelected = activeFiltered.length > 0 && activeFiltered.every(p => selectedProducts.has(p.id));

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Insumos derivados cadastrados</CardTitle>
          <CardDescription>Adicione e edite os itens de estoque derivados dos insumos base.</CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
                <Button onClick={handleAddNewClick} className="w-full sm:w-auto">
                    <PlusCircle className="mr-2 h-4 w-4" /> Adicionar insumo
                </Button>
                <Button type="button" variant="outline" onClick={() => setIsOperationalCategoriesOpen(true)} className="w-full sm:w-auto">
                    Categorias de item
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
            <div className="flex flex-wrap gap-2">
                {categoryFilters.map((filter) => (
                    <Button
                        key={filter.id}
                        type="button"
                        variant={categoryFilter === filter.id ? "default" : "outline"}
                        size="sm"
                        className="h-8 max-w-[240px] rounded-full"
                        onClick={() => setCategoryFilter(filter.id)}
                        title={filter.label}
                    >
                        <span className="truncate">{filter.label}</span>
                        <span className="ml-2 rounded-full bg-background/70 px-1.5 text-[10px] text-foreground">
                            {filter.count}
                        </span>
                    </Button>
                ))}
            </div>
            {selectedProducts.size > 0 && (
                <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm font-medium">
                        {selectedProducts.size} insumo(s) selecionado(s)
                    </span>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Button variant="outline" onClick={() => setIsBulkEditOpen(true)}>
                            <Layers className="mr-2 h-4 w-4" /> Alterar em lote
                        </Button>
                        <Button variant="destructive" onClick={handleDeleteSelectedClick}>
                            <Trash2 className="mr-2 h-4 w-4" /> Excluir selecionados
                        </Button>
                    </div>
                </div>
            )}
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-10">
                                <Checkbox
                                    checked={allActiveSelected}
                                    onCheckedChange={(checked) => handleSelectAllChange(!!checked)}
                                    aria-label="Selecionar todos"
                                />
                            </TableHead>
                            <TableHead className="w-[30%]">Insumo</TableHead>
                            <TableHead>Produto Base</TableHead>
                            <TableHead>Categoria do item</TableHead>
                            <TableHead>Embalagem</TableHead>
                            <TableHead>Forma da contagem de estoque</TableHead>
                            <TableHead>Unidade da contagem de estoque</TableHead>
                            <TableHead>Cód. Barras</TableHead>
                            <TableHead className="w-16 text-right">Ações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            [...Array(5)].map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell colSpan={9}><Skeleton className="h-10 w-full" /></TableCell>
                                </TableRow>
                            ))
                        ) : activeFiltered.length > 0 ? (
                            activeFiltered.map(product => {
                                const countingUnitOption = product.defaultCountingUnit || 'package';
                                let countingUnitText = 'Unidade do Lote';
                                if (countingUnitOption === 'base') countingUnitText = 'Unidade do Produto Base';
                                else if (countingUnitOption === 'content') countingUnitText = 'Unidade do Conteúdo';

                                let displayedCountingUnit = '';
                                if (countingUnitOption === 'package') displayedCountingUnit = product.packageType || product.unit;
                                else if (countingUnitOption === 'base') displayedCountingUnit = (product.baseProductId ? baseProductMap.get(product.baseProductId)?.unit : null) || '-';
                                else if (countingUnitOption === 'content') displayedCountingUnit = product.unit || '-';

                                return (
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
                                                <Badge variant="secondary">{baseProductMap.get(product.baseProductId)?.name || 'N/A'}</Badge>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {product.operationalCategoryName ? (
                                                <Badge variant="outline">{product.operationalCategoryName}</Badge>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell>{product.packageSize}{product.unit?.toLowerCase() === 'pacote' ? ' ' : ''}{product.unit}</TableCell>
                                        <TableCell><Badge variant="outline">{countingUnitText}</Badge></TableCell>
                                        <TableCell><Badge variant="default">{displayedCountingUnit}</Badge></TableCell>
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
                                );
                            })
                        ) : (
                            <TableRow>
                                <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                                    <div className="flex flex-col items-center gap-2">
                                        <Inbox className="h-8 w-8" />
                                        <span>Nenhum insumo ativo encontrado.</span>
                                    </div>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {archivedFiltered.length > 0 && (
                <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-1">Inativos ({archivedFiltered.length})</p>
                    <div className="rounded-md border border-dashed opacity-70">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-10" />
                                    <TableHead className="w-[30%]">Insumo</TableHead>
                                    <TableHead>Produto Base</TableHead>
                                    <TableHead>Categoria do item</TableHead>
                                    <TableHead>Embalagem</TableHead>
                                    <TableHead>Forma da contagem de estoque</TableHead>
                                    <TableHead>Unidade da contagem de estoque</TableHead>
                                    <TableHead>Cód. Barras</TableHead>
                                    <TableHead className="w-16 text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {archivedFiltered.map(product => {
                                    const countingUnitOption = product.defaultCountingUnit || 'package';
                                    let countingUnitText = 'Unidade do Lote';
                                    if (countingUnitOption === 'base') countingUnitText = 'Unidade do Produto Base';
                                    else if (countingUnitOption === 'content') countingUnitText = 'Unidade do Conteúdo';

                                    let displayedCountingUnit = '';
                                    if (countingUnitOption === 'package') displayedCountingUnit = product.packageType || product.unit;
                                    else if (countingUnitOption === 'base') displayedCountingUnit = (product.baseProductId ? baseProductMap.get(product.baseProductId)?.unit : null) || '-';
                                    else if (countingUnitOption === 'content') displayedCountingUnit = product.unit || '-';

                                    return (
                                        <TableRow key={product.id}>
                                            <TableCell />
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
                                                    <Badge variant="secondary">{baseProductMap.get(product.baseProductId)?.name || 'N/A'}</Badge>
                                                ) : (
                                                    <span className="text-muted-foreground">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {product.operationalCategoryName ? (
                                                    <Badge variant="outline">{product.operationalCategoryName}</Badge>
                                                ) : (
                                                    <span className="text-muted-foreground">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell>{product.packageSize}{product.unit?.toLowerCase() === 'pacote' ? ' ' : ''}{product.unit}</TableCell>
                                            <TableCell><Badge variant="outline">{countingUnitText}</Badge></TableCell>
                                            <TableCell><Badge variant="default">{displayedCountingUnit}</Badge></TableCell>
                                            <TableCell className="font-mono text-xs">{product.barcode || '-'}</TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onSelect={() => updateProduct({ ...product, isArchived: false })}>
                                                            <Archive className="mr-2 h-4 w-4" /> Restaurar
                                                        </DropdownMenuItem>
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
                 <div className="pt-2 flex flex-col sm:flex-row gap-2">
                    <Button variant="outline" onClick={() => setIsBulkEditOpen(true)}>
                        <Layers className="mr-2 h-4 w-4" /> Alterar em lote ({selectedProducts.size})
                    </Button>
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
      <OperationalCategoriesDialog open={isOperationalCategoriesOpen} onOpenChange={setIsOperationalCategoriesOpen} />
      <BulkEditProductsDialog
        open={isBulkEditOpen}
        onOpenChange={setIsBulkEditOpen}
        selectedProducts={selectedProductList}
        activeCategories={activeCategories}
        baseProducts={baseProducts}
        onApply={handleBulkApply}
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

    
