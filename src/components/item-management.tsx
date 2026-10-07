
"use client"

import React, { useState, useMemo } from 'react';
import Image from 'next/image';

import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { usePredefinedLists } from '@/hooks/use-predefined-lists';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useOperationalItemCategories } from '@/hooks/use-operational-item-categories';
import { type OperationalItemCategory, type OperationalItemDestination, type Product, type BaseProduct } from '@/types';

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { Checkbox } from './ui/checkbox';

import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Edit, Save, X } from 'lucide-react';
import { AddEditProductModal } from './add-edit-product-modal';
import { ProductFichaModal } from './product-ficha-modal';
import { Input } from './ui/input';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from './ui/table';

import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { BulkBar, CardFooterLabel, CardGrid, CadastrosHero, Chevron, EmptyResults, GridCard, ListHead, ListRow, ListShell, ListSkeleton, ResultsBar, SelectBox, type CadastrosTabProps } from '@/components/cadastros/cadastros-ui';
import {
  buildChips,
  countByKey,
  derivedItemDeleteBlock,
  toggleAllInSet,
  toggleInSet,
  type CadastrosStatus,
} from '@/components/cadastros/cadastros-utils';

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
                {activeCategories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A categoria define o fluxo de compra: estoque, vestimenta ou patrimônio.
            </p>
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

const LIST_TEMPLATE = '28px minmax(0,2.1fr) minmax(0,1.2fr) minmax(0,1.1fr) 100px minmax(0,1.3fr) 20px';

const COUNTING_MODE_TEXT: Record<CountingUnitOption, string> = {
  package: 'Unidade do lote',
  base: 'Unidade do insumo base',
  content: 'Unidade do conteúdo',
};

export function ItemManagement({ tabs, view, onViewChange }: CadastrosTabProps) {
  const { products, loading: productsLoading, getProductFullName, updateProduct, updateMultipleProducts, deleteMultipleProducts } = useProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { activeCategories, loading: categoriesLoading } = useOperationalItemCategories();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { lists, loading: listsLoading } = usePredefinedLists();
  const { toast } = useToast();

  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
  const [editInitialStep, setEditInitialStep] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [, setIsBaseProductModalOpen] = useState(false);
  const [isOperationalCategoriesOpen, setIsOperationalCategoriesOpen] = useState(false);
  const [productsToDelete, setProductsToDelete] = useState<Product[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [status, setStatus] = useState<CadastrosStatus>('active');
  const [chip, setChip] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const loading = productsLoading || listsLoading || lotsLoading || baseProductsLoading || categoriesLoading;

  const baseProductMap = useMemo(() => new Map(baseProducts.map(bp => [bp.id, bp])), [baseProducts]);
  const categoryMap = useMemo(() => new Map(activeCategories.map(c => [c.id, c])), [activeCategories]);

  const countingOf = (product: Product) => {
    const option: CountingUnitOption = product.defaultCountingUnit || 'package';
    const unit =
      option === 'package' ? (product.packageType || product.unit)
      : option === 'base' ? ((product.baseProductId ? baseProductMap.get(product.baseProductId)?.unit : null) || '—')
      : (product.unit || '—');
    return { mode: COUNTING_MODE_TEXT[option], unit };
  };
  const controlOf = (product: Product) => {
    const destination = product.operationalDestination
      ?? (product.operationalCategoryId ? categoryMap.get(product.operationalCategoryId)?.destination : undefined);
    return destination ? CONTROL_LABELS[destination] : '—';
  };
  const packOf = (product: Product) => `${product.packageSize} ${product.unit}${product.packageType ? ` · ${product.packageType}` : ''}`;
  const subOf = (product: Product) => [product.brand, product.barcode].filter(Boolean).join(' · ') || 'Sem marca';
  const chipKeyOf = (product: Product) => product.operationalCategoryId || '_sem_categoria';

  const inStatus = useMemo(() => products.filter(p => (status === 'inactive' ? !!p.isArchived : !p.isArchived)), [products, status]);
  const searchLower = searchTerm.trim().toLowerCase();
  const searched = useMemo(() => {
    if (!searchLower) return inStatus;
    return inStatus.filter(p => {
      const baseName = p.baseProductId ? baseProductMap.get(p.baseProductId)?.name.toLowerCase() ?? '' : '';
      return getProductFullName(p).toLowerCase().includes(searchLower)
        || (p.brand ?? '').toLowerCase().includes(searchLower)
        || (p.barcode ?? '').includes(searchLower)
        || baseName.includes(searchLower);
    });
  }, [inStatus, searchLower, baseProductMap, getProductFullName]);
  const shown = useMemo(() => searched.filter(p => chip === 'all' || chipKeyOf(p) === chip), [searched, chip]);

  const chips = useMemo(() => {
    const counts = countByKey(searched, chipKeyOf);
    const entries = activeCategories
      .map(c => ({ id: c.id, label: c.name, count: counts.get(c.id) ?? 0 }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
    entries.push({ id: '_sem_categoria', label: 'Sem categoria', count: counts.get('_sem_categoria') ?? 0 });
    return buildChips(searched.length, entries, chip);
  }, [searched, activeCategories, chip]);

  const activeCount = products.filter(p => !p.isArchived).length;
  const inactiveCount = products.length - activeCount;
  const visibleSelected = useMemo(() => shown.filter(p => selectedProducts.has(p.id)), [shown, selectedProducts]);
  const allShownSelected = shown.length > 0 && visibleSelected.length === shown.length;
  const opened = openId ? products.find(p => p.id === openId) ?? null : null;

  const closeFicha = () => setOpenId(null);
  const changeStatus = (next: CadastrosStatus) => { setStatus(next); setChip('all'); setSelectedProducts(new Set()); closeFicha(); };

  const handleAddNewClick = () => { setProductToEdit(null); setEditInitialStep(1); setIsModalOpen(true); };
  const handleEdit = (product: Product, step = 1) => {
    closeFicha();
    setProductToEdit(product);
    setEditInitialStep(step);
    setIsModalOpen(true);
  };

  const deleteBlockOf = (product: Product) => derivedItemDeleteBlock(
    lots.filter(lot => lot.productId === product.id).length,
    lists.filter(list => list.items.some(item => item.productId === product.id)).map(list => list.name),
  );

  const handleArchiveToggle = async (product: Product) => {
    const willArchive = !product.isArchived;
    setIsBusy(true);
    try {
      await updateProduct({ ...product, isArchived: willArchive });
      toast({ title: `${product.baseName} ${willArchive ? 'arquivado' : 'desarquivado'}.` });
    } catch (error) {
      toast({ title: 'Não foi possível atualizar o insumo.', description: error instanceof Error ? error.message : 'Tente novamente.', variant: 'destructive' });
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteOne = (product: Product) => {
    const block = deleteBlockOf(product);
    if (block) {
      toast({ title: 'Exclusão bloqueada', description: block, variant: 'destructive' });
      return;
    }
    setProductsToDelete([product]);
  };

  const handleBulkDeleteClick = () => {
    const targets = products.filter(p => selectedProducts.has(p.id));
    const deletable = targets.filter(p => !deleteBlockOf(p));
    const skipped = targets.length - deletable.length;
    if (deletable.length === 0) {
      toast({ title: 'Exclusão bloqueada', description: 'Os itens selecionados têm lotes ou listas vinculados. Arquive para tirar de uso.', variant: 'destructive' });
      return;
    }
    if (skipped > 0) {
      toast({ title: `${skipped} item(ns) ficam de fora`, description: 'Itens com lotes ou listas vinculados não são excluídos.' });
    }
    setProductsToDelete(deletable);
  };

  const handleDeleteMultipleConfirm = async () => {
    if (productsToDelete.length === 0) return;
    setIsDeleting(true);
    try {
      await deleteMultipleProducts(productsToDelete.map(p => p.id));
      setSelectedProducts(new Set());
      setProductsToDelete([]);
      toast({ title: `${productsToDelete.length} insumo(s) excluído(s).` });
    } finally { setIsDeleting(false); }
  };

  const selectedProductList = useMemo(() => products.filter(product => selectedProducts.has(product.id)), [products, selectedProducts]);

  const handleBulkApply = async (updates: Partial<Product>) => {
    const productsToUpdate = selectedProductList.map((product) => ({ ...product, ...updates }));
    await updateMultipleProducts(productsToUpdate);
    setSelectedProducts(new Set());
    toast({
      title: 'Alteração em lote aplicada',
      description: `${productsToUpdate.length} insumo(s) atualizado(s).`,
    });
  };

  const openedBase = opened?.baseProductId ? baseProductMap.get(opened.baseProductId) : undefined;

  return (
    <>
      <div className="flex flex-col gap-4">
        <CadastrosHero
          kicker="Cadastros operacionais"
          tabs={tabs}
          search={{ value: searchTerm, onChange: setSearchTerm, placeholder: 'Buscar por insumo, marca, insumo base ou cód. de barras' }}
          status={{ value: status, onChange: changeStatus, activeCount, inactiveCount, inactiveLabel: 'Arquivados' }}
          manage={{ label: 'Categorias de item', onClick: () => setIsOperationalCategoriesOpen(true) }}
          primary={{ label: 'Adicionar insumo', onClick: handleAddNewClick }}
          chips={chips}
          activeChip={chip}
          onChip={(id) => { setChip(id); setSelectedProducts(new Set()); }}
        />

        <ResultsBar
          shown={shown.length}
          total={inStatus.length}
          noun="insumos"
          selectAll={shown.length > 0 ? {
            label: allShownSelected ? 'Desmarcar todos' : 'Selecionar todos',
            onClick: () => setSelectedProducts(toggleAllInSet(selectedProducts, shown.map(p => p.id), !allShownSelected)),
          } : undefined}
          view={view}
          onView={onViewChange}
        />

        {loading ? (
          <ListShell><ListSkeleton /></ListShell>
        ) : shown.length === 0 ? (
          <EmptyResults
            title={searchTerm ? `Nada encontrado para “${searchTerm}”.` : 'Nenhum item neste filtro.'}
            onClear={() => { setSearchTerm(''); setChip('all'); }}
          />
        ) : view === 'grid' ? (
          <CardGrid>
            {shown.map(product => {
              const counting = countingOf(product);
              return (
                <GridCard
                  key={product.id}
                  label={`Abrir ${product.baseName}`}
                  isOpen={openId === product.id}
                  isSelected={selectedProducts.has(product.id)}
                  isMuted={!!product.isArchived}
                  onOpen={() => setOpenId(product.id)}
                >
                  <div className="relative -mx-[18px] -mt-[18px] flex h-[110px] items-end justify-between overflow-hidden rounded-t-[20px] bg-[repeating-linear-gradient(135deg,#f1efe9_0_10px,#e9e6df_10px_20px)] px-3.5 py-3">
                    {product.imageUrl ? (
                      <Image src={product.imageUrl} alt="" fill sizes="270px" className="object-cover" />
                    ) : null}
                    <span className="relative rounded-lg bg-[#15151c] px-2 py-1 text-[11px] font-extrabold tracking-[0.06em] text-white">{packOf(product)}</span>
                    <span className="relative">
                      <SelectBox
                        checked={selectedProducts.has(product.id)}
                        onToggle={() => setSelectedProducts(toggleInSet(selectedProducts, product.id))}
                        label={`Selecionar ${product.baseName}`}
                      />
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="break-words text-[17px] font-extrabold leading-[1.2] tracking-[-0.02em]">{product.baseName}</span>
                    <span className="truncate text-xs text-[#8a8f99]">{subOf(product)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-[#f4f2ed] px-2.5 py-[3px] text-[11.5px] font-bold text-[#4a4f57]">{product.operationalCategoryName || 'Sem categoria'}</span>
                    <span className="rounded-full bg-[#fbe7ef] px-2.5 py-[3px] text-[11.5px] font-bold text-[#a6325b]">{controlOf(product)}</span>
                  </div>
                  <div className="mt-auto flex justify-between gap-2.5 border-t border-[#f0ede7] pt-3 text-xs">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <CardFooterLabel>Base</CardFooterLabel>
                      <span className="truncate font-mono text-[11.5px]">{product.baseProductId ? baseProductMap.get(product.baseProductId)?.name ?? '—' : '—'}</span>
                    </div>
                    <div className="flex min-w-0 flex-col items-end gap-0.5">
                      <CardFooterLabel>Contagem</CardFooterLabel>
                      <span className="whitespace-nowrap font-bold">{counting.unit}</span>
                    </div>
                  </div>
                </GridCard>
              );
            })}
          </CardGrid>
        ) : (
          <ListShell>
            <ListHead template={LIST_TEMPLATE}>
              <SelectBox
                checked={allShownSelected}
                onToggle={() => setSelectedProducts(toggleAllInSet(selectedProducts, shown.map(p => p.id), !allShownSelected))}
                label="Selecionar todos os itens visíveis"
              />
              <span>Insumo</span><span>Insumo base</span><span>Categoria</span><span>Embalagem</span><span>Contagem</span><span />
            </ListHead>
            {shown.map((product, index) => {
              const counting = countingOf(product);
              return (
                <ListRow
                  key={product.id}
                  template={LIST_TEMPLATE}
                  isFirst={index === 0}
                  isOpen={openId === product.id}
                  isSelected={selectedProducts.has(product.id)}
                  isMuted={!!product.isArchived}
                  label={`Abrir ${product.baseName}`}
                  onOpen={() => setOpenId(product.id)}
                >
                  <SelectBox
                    checked={selectedProducts.has(product.id)}
                    onToggle={() => setSelectedProducts(toggleInSet(selectedProducts, product.id))}
                    label={`Selecionar ${product.baseName}`}
                  />
                  <div className="flex min-w-0 items-center gap-2.5">
                    {product.imageUrl ? (
                      <Image src={product.imageUrl} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-[9px] border border-[#e3dfd6] object-cover" />
                    ) : (
                      <div className="h-9 w-9 shrink-0 rounded-[9px] border border-[#e3dfd6] bg-[repeating-linear-gradient(135deg,#f4f2ed_0_6px,#ece9e2_6px_12px)]" />
                    )}
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[13.5px] font-bold">{product.baseName}</span>
                      <span className="truncate text-[11.5px] text-[#8a8f99]">{subOf(product)}</span>
                    </div>
                  </div>
                  <span className="truncate font-mono text-[11.5px] text-[#4a4f57]">
                    {product.baseProductId ? baseProductMap.get(product.baseProductId)?.name ?? '—' : '—'}
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[12.5px] font-semibold">{product.operationalCategoryName || 'Sem categoria'}</span>
                    <span className="text-[11px] text-[#8a8f99]">{controlOf(product)}</span>
                  </div>
                  <span className="whitespace-nowrap text-[12.5px] text-[#4a4f57]">{packOf(product)}</span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[12.5px] font-semibold">{counting.unit}</span>
                    <span className="truncate text-[11px] text-[#8a8f99]">{counting.mode}</span>
                  </div>
                  <Chevron />
                </ListRow>
              );
            })}
          </ListShell>
        )}
      </div>

      <ProductFichaModal
        key={opened?.id ?? 'closed-product-ficha'}
        open={!!opened}
        onOpenChange={(nextOpen) => { if (!nextOpen) closeFicha(); }}
        product={opened}
        baseProduct={openedBase ?? null}
        onEdit={(step) => { if (opened) handleEdit(opened, step); }}
        actions={opened ? [
          { label: opened.isArchived ? 'Desarquivar' : 'Arquivar', onClick: () => void handleArchiveToggle(opened), disabled: isBusy },
          { label: 'Excluir', onClick: () => handleDeleteOne(opened), tone: 'danger' },
        ] : []}
      />

      <BulkBar
        count={visibleSelected.length}
        onClear={() => setSelectedProducts(new Set())}
        actions={[
          { label: 'Alterar em lote', onClick: () => setIsBulkEditOpen(true) },
          { label: 'Excluir', isDanger: true, onClick: handleBulkDeleteClick },
        ]}
      />

      <AddEditProductModal
        open={isModalOpen}
        onOpenChange={(nextOpen) => {
          setIsModalOpen(nextOpen);
          if (!nextOpen) setEditInitialStep(1);
        }}
        productToEdit={productToEdit}
        initialStep={editInitialStep}
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

      {productsToDelete.length > 0 && (
        <DeleteConfirmationDialog
            open={productsToDelete.length > 0}
            isDeleting={isDeleting}
            onOpenChange={(isOpen) => { if (!isOpen) setProductsToDelete([]); }}
            onConfirm={handleDeleteMultipleConfirm}
            itemName={productsToDelete.length > 1 ? `os ${productsToDelete.length} insumos selecionados` : `o insumo "${getProductFullName(productsToDelete[0])}"`}
        />
      )}
    </>
  );
}
