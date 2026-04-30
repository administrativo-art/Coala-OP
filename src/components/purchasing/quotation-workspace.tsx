"use client";

import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CheckCircle2,
  XCircle,
  Trash2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Loader2,
  RotateCcw,
  ShoppingCart,
  Link2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { QuotationItemForm } from './quotation-item-form';
import { NormalizeItemModal } from './normalize-item-modal';
import { FinalizeQuotationModal } from './finalize-quotation-modal';
import { useQuotations } from '@/hooks/use-quotations';
import { useQuotationItems } from '@/hooks/use-quotation-items';
import { useEntities } from '@/hooks/use-entities';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useAuth } from '@/hooks/use-auth';
import {
  canCreatePurchase as canCreatePurchasePermission,
  canCreateQuotation,
  canFinalizeQuotation,
} from '@/lib/purchasing-permissions';
import { type Quotation, type QuotationItem } from '@/types';
import { cn } from '@/lib/utils';

const STATUS_CONFIG: Record<
  Quotation['status'],
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  draft: { label: 'Rascunho', variant: 'secondary' },
  quoted: { label: 'Finalizada', variant: 'default' },
  partially_converted: { label: 'Parcialmente convertida', variant: 'outline' },
  converted: { label: 'Convertida', variant: 'default' },
  archived: { label: 'Arquivada', variant: 'outline' },
  expired: { label: 'Expirada', variant: 'destructive' },
  cancelled: { label: 'Cancelada', variant: 'destructive' },
};

const CONVERSION_CONFIG: Record<
  QuotationItem['conversionStatus'],
  { label: string; color: string }
> = {
  pending: { label: 'Pendente', color: 'text-muted-foreground' },
  selected: { label: 'Selecionado', color: 'text-blue-600' },
  converted: { label: 'Comprado', color: 'text-green-600' },
  discarded: { label: 'Descartado', color: 'text-red-500' },
};

function formatCurrency(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

interface Props {
  quotation: Quotation;
}

export function QuotationWorkspace({ quotation }: Props) {
  const router = useRouter();
  const { permissions } = useAuth();
  const { entities } = useEntities();
  const { baseProducts } = useBaseProducts();
  const { finalizeQuotation, archiveQuotation, cancelQuotation, reopenQuotation, deleteItem } = useQuotations();
  const { items, loading: itemsLoading, refresh } = useQuotationItems(quotation.id);
  const [showForm, setShowForm] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [normalizeItem, setNormalizeItem] = useState<QuotationItem | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);

  const supplier = entities.find((e) => e.id === quotation.supplierId);
  const status = STATUS_CONFIG[quotation.status];
  const isDraft = quotation.status === 'draft';
  const isEditable = isDraft && canCreateQuotation(permissions);

  const hasNormalizedItems = useMemo(
    () => items.some((i) => !!i.baseItemId),
    [items],
  );

  const canFinalize = isDraft && hasNormalizedItems && canFinalizeQuotation(permissions);
  const canReopen =
    canFinalizeQuotation(permissions) &&
    (quotation.status === 'quoted' || quotation.status === 'expired' || quotation.status === 'archived');
  const canCreatePurchase =
    canCreatePurchasePermission(permissions) &&
    (quotation.status === 'quoted' || quotation.status === 'partially_converted') &&
    items.some((i) => i.conversionStatus === 'selected');
  const canArchive =
    canFinalizeQuotation(permissions) &&
    !isDraft &&
    quotation.status !== 'cancelled' &&
    quotation.status !== 'converted' &&
    quotation.status !== 'archived' &&
    !items.some((i) => i.conversionStatus === 'converted');

  const freeItems = items.filter((i) => !i.baseItemId);
  const totalEstimated = items.reduce((acc, i) => acc + i.totalPrice, 0);

  const getProductName = (baseItemId: string) =>
    baseProducts.find((bp) => bp.id === baseItemId)?.name ?? baseItemId;

  const handleCancel = async () => {
    setActionLoading('cancel');
    try {
      await cancelQuotation(quotation.id);
      router.push('/dashboard/purchasing');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReopen = async () => {
    setActionLoading('reopen');
    try {
      await reopenQuotation(quotation.id);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    await deleteItem(quotation.id, itemId);
    await refresh();
  };

  const handleArchive = async () => {
    setActionLoading('archive');
    try {
      await archiveQuotation(quotation.id);
      setFinalizeOpen(false);
    } finally {
      setActionLoading(null);
    }
  };

  const handleFinalize = async (selectedItemIds: string[]) => {
    await finalizeQuotation(quotation.id, selectedItemIds);
    setFinalizeOpen(false);
    await refresh();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold">
              {supplier?.fantasyName ?? supplier?.name ?? quotation.supplierId}
            </h1>
            <Badge variant={status.variant}>{status.label}</Badge>
            <Badge variant="outline" className="text-xs">
              {quotation.mode === 'remote' ? 'Remota' : 'In loco'}
            </Badge>
          </div>
          <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
            <span>Criada em {format(parseISO(quotation.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
            {quotation.validUntil && (
              <span>Válida até {format(parseISO(quotation.validUntil), 'dd/MM/yyyy', { locale: ptBR })}</span>
            )}
            {quotation.finalizedAt && (
              <span>Finalizada em {format(parseISO(quotation.finalizedAt), 'dd/MM/yyyy', { locale: ptBR })}</span>
            )}
          </div>
          {quotation.notes && (
            <p className="text-sm text-muted-foreground italic">{quotation.notes}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          {canCreatePurchase && (
            <Button size="sm" onClick={() => router.push(`/dashboard/purchasing/quotations/${quotation.id}/confirm-purchase`)}>
              <ShoppingCart className="mr-2 h-4 w-4" />
              Criar compra
            </Button>
          )}
          {canReopen && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReopen}
              disabled={actionLoading === 'reopen'}
            >
              {actionLoading === 'reopen' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-2 h-4 w-4" />
              )}
              Reabrir cotação
            </Button>
          )}
          {canArchive && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleArchive}
              disabled={actionLoading === 'archive'}
            >
              {actionLoading === 'archive' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="mr-2 h-4 w-4" />
              )}
              Arquivar
            </Button>
          )}
          {isEditable && (
            <>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={!!actionLoading}>
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancelar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancelar cotação?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação não pode ser desfeita. A cotação e seus itens serão marcados como cancelados.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Voltar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleCancel}>Cancelar cotação</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <Button
                size="sm"
                onClick={() => setFinalizeOpen(true)}
                disabled={!canFinalize || !!actionLoading}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Finalizar cotação
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Free items warning */}
      {freeItems.length > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-800 dark:text-amber-200">
              {freeItems.length} item{freeItems.length > 1 ? 's livres' : ' livre'} sem insumo vinculado
            </p>
            <p className="text-amber-700 dark:text-amber-300">
              Esses itens precisarão ser normalizados antes de virar uma compra.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Items list */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">
              Itens{' '}
              <span className="text-muted-foreground font-normal text-sm">
                ({items.length})
              </span>
            </h2>
            {totalEstimated > 0 && (
              <span className="text-sm font-medium">
                Total: {formatCurrency(totalEstimated)}
              </span>
            )}
          </div>

          <ScrollArea className="max-h-[460px]">
            <div className="space-y-2 pr-2">
              {itemsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))
              ) : items.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-12">
                  Nenhum item adicionado ainda.
                </div>
              ) : (
                items.map((item) => {
                  const base = baseProducts.find((bp) => bp.id === item.baseItemId);
                  const conv = CONVERSION_CONFIG[item.conversionStatus];
                  return (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-3 rounded-md border bg-card p-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">
                            {base?.name ?? item.freeText ?? '—'}
                          </span>
                          {!item.baseItemId && (
                            <Badge variant="outline" className="text-amber-600 border-amber-400 text-xs shrink-0">
                              Item livre
                            </Badge>
                          )}
                          <span className={cn('text-xs', conv.color)}>{conv.label}</span>
                        </div>
                        <div className="text-sm text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
                          <span>{item.quantity} {item.unit}</span>
                          <span>× {formatCurrency(item.unitPrice)}</span>
                          {(item.discount ?? 0) > 0 && (
                            <span>Desconto: {formatCurrency(item.discount ?? 0)}</span>
                          )}
                          <span className="font-medium text-foreground">
                            = {formatCurrency(item.totalPrice)}
                          </span>
                        </div>
                        {item.observation && (
                          <p className="text-xs text-muted-foreground italic mt-1">{item.observation}</p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {!item.baseItemId && (permissions?.purchasing?.manageBaseItems ?? false) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-amber-600 hover:text-amber-700"
                            title="Normalizar item livre"
                            onClick={() => setNormalizeItem(item)}
                          >
                            <Link2 className="h-4 w-4" />
                          </Button>
                        )}
                        {isEditable && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteItem(item.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Add item form */}
        {isEditable && (
          <div className="space-y-3">
            <button
              className="flex w-full items-center justify-between font-semibold text-sm"
              onClick={() => setShowForm((v) => !v)}
              type="button"
            >
              Adicionar item
              {showForm ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            <Separator />
            {showForm && (
              <QuotationItemForm
                quotationId={quotation.id}
                mode={quotation.mode}
                supplierId={quotation.supplierId}
                onAdded={() => void refresh()}
              />
            )}
          </div>
        )}
      </div>

      {normalizeItem && (
        <NormalizeItemModal
          open={!!normalizeItem}
          onOpenChange={(v) => { if (!v) setNormalizeItem(null); }}
          quotationId={quotation.id}
          item={normalizeItem}
        />
      )}

      <FinalizeQuotationModal
        open={finalizeOpen}
        onOpenChange={setFinalizeOpen}
        items={items}
        getProductName={getProductName}
        onConfirm={handleFinalize}
        onArchive={handleArchive}
      />
    </div>
  );
}
