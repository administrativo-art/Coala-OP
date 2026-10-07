

"use client"

import React, { useState, useMemo } from 'react';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { usePurchase } from '@/hooks/use-purchase';
import { Button } from "@/components/ui/button";
import { type BaseProduct } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { AddEditBaseProductModal } from './add-edit-base-product-modal';
import { BaseProductFichaModal } from './base-product-ficha-modal';
import { ClassificationManagementModal } from './classification-management-modal';
import { useToast } from '@/hooks/use-toast';
import {
  BulkBar,
  CardFooterLabel,
  CardGrid,
  CadastrosHero,
  Chevron,
  DetailDrawer,
  EmptyResults,
  GridCard,
  ListHead,
  ListRow,
  ListShell,
  ListSkeleton,
  Mono,
  ResultsBar,
  SelectBox,
  SoftPill,
  StatusDot,
  type CadastrosTabProps,
  type DrawerNotice,
} from '@/components/cadastros/cadastros-ui';
import {
  baseProductDeactivateBlock,
  baseProductDeleteBlock,
  bulkDeleteBlockedNames,
  buildChips,
  countByKey,
  formatCost,
  toggleAllInSet,
  toggleInSet,
  unitSignature,
  type CadastrosStatus,
} from '@/components/cadastros/cadastros-utils';
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

const LIST_TEMPLATE = '28px minmax(0,2.2fr) minmax(0,1.3fr) 70px 110px 80px 90px 20px';

export function BaseProductManagement({ tabs, view, onViewChange }: CadastrosTabProps) {
  const { baseProducts, loading: loadingBase, updateBaseProduct, updateMultipleBaseProducts, deleteMultipleBaseProducts } = useBaseProducts();
  const { products, updateMultipleProducts } = useProducts();
  const { lots } = useExpiryProducts();
  const { classifications } = useClassifications();
  const { loading: loadingHistory } = usePurchase();
  const { toast } = useToast();
  const loading = loadingBase || loadingHistory;

  const [productsToDelete, setProductsToDelete] = useState<BaseProduct[]>([]);
  const [productToEditId, setProductToEditId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [fichaProduct, setFichaProduct] = useState<BaseProduct | null>(null);
  const [isClassificationModalOpen, setIsClassificationModalOpen] = useState(false);
  const [isBulkEditModalOpen, setIsBulkEditModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [status, setStatus] = useState<CadastrosStatus>('active');
  const [chip, setChip] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<DrawerNotice | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const classificationMap = useMemo(() => new Map(classifications.map(c => [c.id, c.name])), [classifications]);
  const derivedCount = useMemo(
    () => countByKey(products.filter(p => p.baseProductId), p => p.baseProductId as string),
    [products],
  );
  const classificationName = (product: BaseProduct) =>
    product.classification ? (classificationMap.get(product.classification) || '') : '';

  const hasStock = (bp: BaseProduct) => {
    const derivedIds = new Set(products.filter(p => p.baseProductId === bp.id).map(p => p.id));
    return lots.some(l => derivedIds.has(l.productId) && l.quantity > 0);
  };

  const isArchivedStatus = status === 'inactive';
  const inStatus = useMemo(
    () => baseProducts.filter(p => (isArchivedStatus ? !!p.isArchived : !p.isArchived)),
    [baseProducts, isArchivedStatus],
  );
  const searchLower = searchTerm.trim().toLowerCase();
  const matchesSearch = (p: BaseProduct) =>
    !searchLower ||
    p.name.toLowerCase().includes(searchLower) ||
    p.id.toLowerCase().includes(searchLower) ||
    classificationName(p).toLowerCase().includes(searchLower);
  const chipKeyOf = (p: BaseProduct) => p.classification || 'none';

  const searched = useMemo(
    () => inStatus.filter(matchesSearch),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inStatus, searchLower, classificationMap],
  );
  const shown = useMemo(
    () => searched.filter(p => chip === 'all' || chipKeyOf(p) === chip),
    [searched, chip],
  );

  const chips = useMemo(() => {
    const counts = countByKey(searched, chipKeyOf);
    const entries = classifications
      .map(c => ({ id: c.id, label: c.name, count: counts.get(c.id) ?? 0 }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
    entries.push({ id: 'none', label: 'Sem classificação', count: counts.get('none') ?? 0 });
    return buildChips(searched.length, entries, chip);
  }, [searched, classifications, chip]);

  const activeCount = baseProducts.filter(p => !p.isArchived).length;
  const inactiveCount = baseProducts.length - activeCount;

  const visibleSelected = useMemo(() => shown.filter(p => selected.has(p.id)), [shown, selected]);
  const allShownSelected = shown.length > 0 && visibleSelected.length === shown.length;
  const opened = openId ? baseProducts.find(p => p.id === openId) ?? null : null;

  const closeDrawer = () => { setOpenId(null); setNotice(null); };
  const changeStatus = (next: CadastrosStatus) => { setStatus(next); setChip('all'); setSelected(new Set()); closeDrawer(); };

  const handleAddNew = () => { setProductToEditId(null); setIsModalOpen(true); };
  const handleEdit = (product: BaseProduct) => { closeDrawer(); setProductToEditId(product.id); setIsModalOpen(true); };

  const handleToggleActive = async (bp: BaseProduct, activate: boolean) => {
    if (!activate) {
      const block = baseProductDeactivateBlock(bp.name, hasStock(bp));
      if (block) { setNotice({ kind: 'block', text: block }); return; }
    }
    setIsBusy(true);
    try {
      await updateBaseProduct({ ...bp, isArchived: !activate });
      const derived = products.filter(p => p.baseProductId === bp.id);
      if (derived.length > 0) {
        await updateMultipleProducts(derived.map(p => ({ id: p.id, isArchived: !activate })));
      }
      toast({
        title: activate ? `${bp.name} reativado.` : `${bp.name} desativado.`,
        description: derived.length > 0
          ? (activate ? `${derived.length} derivado(s) reativado(s) junto.` : 'Os derivados também foram desativados.')
          : undefined,
      });
      setNotice(null);
    } catch (error) {
      toast({ title: 'Não foi possível atualizar o insumo base.', description: error instanceof Error ? error.message : 'Tente novamente.', variant: 'destructive' });
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteOne = (bp: BaseProduct) => {
    const block = baseProductDeleteBlock(bp.name, derivedCount.get(bp.id) ?? 0);
    if (block) { setNotice({ kind: 'block', text: block }); return; }
    setNotice({
      kind: 'confirm',
      text: `Excluir “${bp.name}”? Essa ação não pode ser desfeita.`,
      onConfirm: async () => {
        setIsBusy(true);
        try {
          await deleteMultipleBaseProducts([bp.id]);
          closeDrawer();
          toast({ title: `${bp.name} excluído.` });
        } catch (error) {
          toast({ title: 'Não foi possível excluir.', description: error instanceof Error ? error.message : 'Tente novamente.', variant: 'destructive' });
        } finally {
          setIsBusy(false);
        }
      },
    });
  };

  const handleBulkDeleteClick = () => {
    const targets = baseProducts.filter(p => selected.has(p.id));
    const blocked = bulkDeleteBlockedNames(targets.filter(p => (derivedCount.get(p.id) ?? 0) > 0).map(p => p.name));
    if (blocked) { toast({ title: 'Exclusão bloqueada', description: blocked, variant: 'destructive' }); return; }
    setProductsToDelete(targets);
  };

  const handleBulkEditConfirm = async (classificationId: string) => {
    const productsToUpdate = baseProducts
      .filter(p => selected.has(p.id))
      .map(p => ({ ...p, classification: classificationId === 'none' ? '' : classificationId }));
    await updateMultipleBaseProducts(productsToUpdate);
    setIsBulkEditModalOpen(false);
    setSelected(new Set());
    toast({ title: 'Classificação alterada.', description: `${productsToUpdate.length} insumo(s) atualizado(s).` });
  };

  const handleDeleteMultipleConfirm = async () => {
    if (productsToDelete.length === 0) return;
    const idsToDelete = productsToDelete.map(p => p.id);
    const withLinks = idsToDelete.filter(id => (derivedCount.get(id) ?? 0) > 0);
    if (withLinks.length > 0) {
      const names = withLinks.map(id => baseProducts.find(bp => bp.id === id)?.name).filter(Boolean) as string[];
      toast({ title: 'Exclusão bloqueada', description: bulkDeleteBlockedNames(names) ?? undefined, variant: 'destructive' });
      setProductsToDelete([]);
      return;
    }
    setIsDeleting(true);
    try {
      await deleteMultipleBaseProducts(idsToDelete);
      setSelected(new Set());
      setProductsToDelete([]);
      toast({ title: `${idsToDelete.length} insumo(s) excluído(s).` });
    } finally { setIsDeleting(false); }
  };

  const linkedDerived = opened ? products.filter(p => p.baseProductId === opened.id) : [];
  const openedCost = opened ? (opened.lastEffectivePrice?.pricePerUnit ?? opened.initialCostPerUnit ?? 0) : 0;

  return (
    <>
      <div className="flex flex-col gap-4">
        <CadastrosHero
          kicker="Cadastros operacionais"
          tabs={tabs}
          search={{ value: searchTerm, onChange: setSearchTerm, placeholder: 'Buscar por nome, código ou classificação' }}
          status={{ value: status, onChange: changeStatus, activeCount, inactiveCount, inactiveLabel: 'Inativos' }}
          manage={{ label: 'Classificações', onClick: () => setIsClassificationModalOpen(true) }}
          primary={{ label: 'Adicionar insumo base', onClick: handleAddNew }}
          chips={chips}
          activeChip={chip}
          onChip={(id) => { setChip(id); setSelected(new Set()); }}
        />

        <ResultsBar
          shown={shown.length}
          total={inStatus.length}
          noun="insumos"
          selectAll={shown.length > 0 ? {
            label: allShownSelected ? 'Desmarcar todos' : 'Selecionar todos',
            onClick: () => setSelected(toggleAllInSet(selected, shown.map(p => p.id), !allShownSelected)),
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
              const cost = product.lastEffectivePrice?.pricePerUnit ?? product.initialCostPerUnit ?? 0;
              return (
                <GridCard
                  key={product.id}
                  label={`Abrir ${product.name}`}
                  isOpen={openId === product.id}
                  isSelected={selected.has(product.id)}
                  isMuted={!!product.isArchived}
                  onOpen={() => { setOpenId(product.id); setNotice(null); }}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex h-[58px] w-[58px] items-center justify-center rounded-2xl bg-[#15151c] text-2xl font-extrabold tracking-[-0.04em] text-[#b9b9ff]">
                      {unitSignature(product.unit)}
                    </div>
                    <div className="flex items-center gap-2.5">
                      <StatusDot isActive={!product.isArchived} />
                      <SelectBox
                        checked={selected.has(product.id)}
                        onToggle={() => setSelected(toggleInSet(selected, product.id))}
                        label={`Selecionar ${product.name}`}
                      />
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="break-words text-[19px] font-extrabold leading-[1.15] tracking-[-0.02em]">{product.name}</span>
                    <Mono className="text-[11px] uppercase text-[#9a9ba1]">{product.id.slice(0, 8)}</Mono>
                  </div>
                  <SoftPill isEmpty={!classificationName(product)}>{classificationName(product) || 'Sem classificação'}</SoftPill>
                  <div className="mt-auto flex items-end justify-between gap-2.5 border-t border-[#f0ede7] pt-3">
                    <div className="flex flex-col gap-0.5">
                      <CardFooterLabel>Custo médio</CardFooterLabel>
                      <Mono className="whitespace-nowrap text-base font-bold">
                        {formatCost(cost)}<span className="text-[11px] text-[#9a9ba1]"> /{product.unit}</span>
                      </Mono>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <CardFooterLabel>Derivados</CardFooterLabel>
                      <span className="text-base font-extrabold">{derivedCount.get(product.id) ?? 0}</span>
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
                onToggle={() => setSelected(toggleAllInSet(selected, shown.map(p => p.id), !allShownSelected))}
                label="Selecionar todos os itens visíveis"
              />
              <span>Insumo base</span><span>Classificação</span><span>Unidade</span>
              <span className="text-right">Custo médio</span><span className="text-right">Derivados</span><span>Status</span><span />
            </ListHead>
            {shown.map((product, index) => {
              const cost = product.lastEffectivePrice?.pricePerUnit ?? product.initialCostPerUnit ?? 0;
              return (
                <ListRow
                  key={product.id}
                  template={LIST_TEMPLATE}
                  isFirst={index === 0}
                  isOpen={openId === product.id}
                  isSelected={selected.has(product.id)}
                  isMuted={!!product.isArchived}
                  label={`Abrir ${product.name}`}
                  onOpen={() => { setOpenId(product.id); setNotice(null); }}
                >
                  <SelectBox
                    checked={selected.has(product.id)}
                    onToggle={() => setSelected(toggleInSet(selected, product.id))}
                    label={`Selecionar ${product.name}`}
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[13.5px] font-bold">{product.name}</span>
                    <Mono className="text-[11px] uppercase text-[#9a9ba1]">{product.id.slice(0, 8)}</Mono>
                  </div>
                  <SoftPill isEmpty={!classificationName(product)}>{classificationName(product) || 'Sem classificação'}</SoftPill>
                  <span className="text-[13px] text-[#4a4f57]">{product.unit}</span>
                  <Mono className="whitespace-nowrap text-right text-[12.5px]">{formatCost(cost)}</Mono>
                  <span className="text-right text-[13px] tabular-nums text-[#4a4f57]">{derivedCount.get(product.id) ?? 0}</span>
                  <StatusDot isActive={!product.isArchived} />
                  <Chevron />
                </ListRow>
              );
            })}
          </ListShell>
        )}
      </div>

      <DetailDrawer
        open={!!opened}
        onClose={closeDrawer}
        kicker={opened ? `Insumo base · ${opened.id.slice(0, 8).toUpperCase()}` : ''}
        title={opened?.name ?? ''}
        chips={opened ? [
          { label: classificationName(opened) || 'Sem classificação' },
          { label: opened.isArchived ? 'Inativo' : 'Ativo', tone: opened.isArchived ? 'off' : 'pink' },
        ] : []}
        hero={opened ? { sig: unitSignature(opened.unit), label: `Custo médio por ${opened.unit}`, value: formatCost(openedCost) } : undefined}
        fields={opened ? [
          ['Unidade de referência', opened.unit],
          ['Classificação', classificationName(opened) || '—'],
          ['Insumos derivados', String(derivedCount.get(opened.id) ?? 0)],
        ] : []}
        list={opened && linkedDerived.length > 0 ? {
          title: 'Derivados vinculados',
          more: linkedDerived.length > 4 ? `+${linkedDerived.length - 4} na ficha` : undefined,
          rows: linkedDerived.slice(0, 4).map(p => [p.baseName, [p.brand, `${p.packageSize} ${p.unit}`].filter(Boolean).join(' · ')] as [string, string]),
        } : undefined}
        notice={notice}
        onCancelNotice={() => setNotice(null)}
        isBusy={isBusy}
        onFicha={opened ? () => { const bp = opened; closeDrawer(); setFichaProduct(bp); } : undefined}
        onEdit={opened ? () => handleEdit(opened) : undefined}
        actions={opened ? [
          { label: opened.isArchived ? 'Reativar' : 'Desativar', onClick: () => void handleToggleActive(opened, !!opened.isArchived) },
          { label: 'Excluir', isDanger: true, onClick: () => handleDeleteOne(opened) },
        ] : []}
      />

      <BulkBar
        count={visibleSelected.length}
        onClear={() => setSelected(new Set())}
        actions={[
          { label: 'Alterar classificação', onClick: () => setIsBulkEditModalOpen(true) },
          { label: 'Excluir', isDanger: true, onClick: handleBulkDeleteClick },
        ]}
      />

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
        selectedCount={visibleSelected.length}
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
