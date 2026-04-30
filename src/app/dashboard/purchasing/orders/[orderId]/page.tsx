"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  CreditCard,
  Loader2,
  Pencil,
  ReceiptText,
  Scale,
  ShoppingCart,
  Truck,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PermissionGuard } from '@/components/permission-guard';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { CurrencyInput } from '@/components/ui/currency-input';
import { AccountPlanTreeSelect } from '@/components/purchasing/account-plan-tree-select';
import { ManageOrderItemsModal } from '@/components/purchasing/manage-order-items-modal';
import { useAuth } from '@/hooks/use-auth';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { useEntities } from '@/hooks/use-entities';
import { usePurchaseFinancials } from '@/hooks/use-purchase-financials';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { useQuotationItems } from '@/hooks/use-quotation-items';
import { usePurchasingFinancialOptions } from '@/hooks/use-purchasing-financial-options';
import {
  canCancelPurchase,
  canCreatePurchase,
  canManagePurchaseFinancials,
  canReceivePurchase,
  canViewPurchasing,
} from '@/lib/purchasing-permissions';
import { type PaymentMethod, type PurchaseFinancialStatus, type PurchaseOrderItem, type PurchasePaymentCondition } from '@/types';

const RECEIPT_LABELS: Record<string, string> = {
  future_delivery: 'Entrega futura',
  immediate_pickup: 'Retirada imediata',
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  pix: 'Pix',
  card_credit: 'Cartão de crédito',
  card_debit: 'Cartão de débito',
  cash: 'Dinheiro',
  boleto: 'Boleto',
  term: 'A prazo',
};

const PAYMENT_METHODS: PaymentMethod[] = ['pix', 'card_credit', 'card_debit', 'cash', 'boleto', 'term'];
const PAYMENT_CONDITION_LABELS: Record<PurchasePaymentCondition, string> = {
  cash: 'À vista',
  installments: 'Parcelado',
};

const FINANCIAL_STATUS_LABELS: Record<PurchaseFinancialStatus, string> = {
  forecasted: 'Previsto',
  confirmed: 'Confirmado',
  divergent: 'Divergente',
  paid: 'Pago',
  cancelled: 'Cancelado',
};

type EditForm = {
  paymentMethod: PaymentMethod;
  paymentCondition: PurchasePaymentCondition;
  installmentsCount: number;
  paymentDueDate: string;
  estimatedReceiptDate: string;
  deliveryFee: number;
  accountPlanId: string;
  freightAccountPlanId: string;
  resultCenterId: string;
  notes: string;
};

function fmt(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function PurchaseOrderPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const { permissions, firebaseUser } = useAuth();
  const { orders, loading, cancelOrder, updateOrder, confirmOrder, fetchOrderItems } = usePurchaseOrders();
  const { financials, markAsPaid } = usePurchaseFinancials();
  const { entities } = useEntities();
  const { baseProducts } = useBaseProducts();
  const { purchasingDefaults } = useCompanySettings();
  const { accountPlans, flattenedAccountPlans, resultCenters, loading: classificationLoading } = usePurchasingFinancialOptions();
  const canView = canViewPurchasing(permissions);
  const canCancel = canCancelPurchase(permissions);
  const canEdit = canCreatePurchase(permissions);
  const canReceive = canReceivePurchase(permissions);
  const canManageFinancials = canManagePurchaseFinancials(permissions);

  const [items, setItems] = useState<PurchaseOrderItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [itemsEditOpen, setItemsEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncingExpense, setSyncingExpense] = useState(false);
  const expenseSyncAttemptedRef = useRef<string | null>(null);

  const order = useMemo(() => orders.find((o) => o.id === params.orderId), [orders, params.orderId]);
  const financial = useMemo(
    () => financials.find((entry) => entry.purchaseOrderId === params.orderId),
    [financials, params.orderId],
  );
  const { items: quotationItems } = useQuotationItems(order?.quotationId ?? null);
  const supplier = useMemo(
    () => entities.find((e) => e.id === order?.supplierId),
    [entities, order],
  );
  useEffect(() => {
    if (!params.orderId) return;
    let cancelled = false;
    setItemsLoading(true);
    fetchOrderItems(params.orderId).then((data) => {
      if (cancelled) return;
      setItems(data);
      setItemsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [params.orderId, fetchOrderItems]);

  useEffect(() => {
    let cancelled = false;

    async function ensureLinkedExpense() {
      if (!firebaseUser || !order || order.status !== 'confirmed' || order.linkedExpenseId || syncingExpense) {
        return;
      }
      if (expenseSyncAttemptedRef.current === order.id) return;

      expenseSyncAttemptedRef.current = order.id;
      setSyncingExpense(true);
      try {
        const token = await firebaseUser.getIdToken();
        const response = await fetch(`/api/purchasing/orders/${order.id}/sync-expense`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });
        if (!response.ok && !cancelled) {
          const payload = await response.json().catch(() => ({}));
          console.error('Falha ao sincronizar despesa da compra:', payload.error || response.statusText);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Falha ao sincronizar despesa da compra:', error);
        }
      } finally {
        if (!cancelled) setSyncingExpense(false);
      }
    }

    void ensureLinkedExpense();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, order, syncingExpense]);

  const displayItems = useMemo(
    () =>
      items.map((item) => {
        const quotationItem = item.quotationItemId
          ? quotationItems.find((entry) => entry.id === item.quotationItemId)
          : undefined;
        const fallbackDiscount = Number(quotationItem?.discount ?? 0);
        const effectiveDiscount = Number(item.discountOrdered ?? fallbackDiscount);
        const effectiveTotal =
          item.discountOrdered == null && fallbackDiscount > 0
            ? Math.max(Number(item.unitPriceOrdered ?? 0) * Number(item.quantityOrdered ?? 0) - fallbackDiscount, 0)
            : Number(item.totalOrdered ?? 0);

        return {
          ...item,
          discountOrdered: effectiveDiscount,
          totalOrdered: effectiveTotal,
        };
      }),
    [items, quotationItems],
  );

  const goodsSubtotal = useMemo(
    () => displayItems.reduce((sum, item) => sum + Number(item.totalOrdered ?? 0), 0),
    [displayItems],
  );
  const goodsGrossSubtotal = useMemo(
    () =>
      displayItems.reduce(
        (sum, item) => sum + Number(item.quantityOrdered ?? 0) * Number(item.unitPriceOrdered ?? 0),
        0,
      ),
    [displayItems],
  );
  const effectiveOrderTotal = useMemo(
    () => goodsSubtotal + Number(order?.deliveryFee ?? 0),
    [goodsSubtotal, order?.deliveryFee],
  );

  const isCancelled = order?.status === 'cancelled';
  const isCreated = order?.status === 'created';
  const isReceived = !!order?.receivedAt;
  const isReadyForConfirmation =
    !!order?.paymentDueDate &&
    !!order?.paymentMethod &&
    !!order?.accountPlanId &&
    !!order?.resultCenterId &&
    ((order?.deliveryFee ?? 0) <= 0 || !!order?.freightAccountPlanId);
  const canEditOrder = !!order && canEdit && !isCancelled && !isReceived;
  const canConfirmOrder = !!order && isCreated && canEdit && !isCancelled;
  const canRegisterPayment =
    !!financial &&
    canManageFinancials &&
    (financial.status === 'confirmed' || financial.status === 'divergent');

  const handleCancel = async () => {
    if (!order || !cancelReason.trim()) return;
    setCancelling(true);
    try {
      await cancelOrder(order.id, cancelReason);
    } finally {
      setCancelling(false);
    }
  };

  const openEdit = () => {
    if (!order) return;
    setEditForm({
      paymentMethod: order.paymentMethod,
      paymentCondition: order.paymentCondition ?? 'cash',
      installmentsCount: order.installmentsCount ?? 2,
      paymentDueDate: order.paymentDueDate.slice(0, 10),
      estimatedReceiptDate: order.estimatedReceiptDate.slice(0, 10),
      deliveryFee: order.deliveryFee ?? 0,
      accountPlanId: order.accountPlanId ?? purchasingDefaults.goodsAccountPlanId ?? '',
      freightAccountPlanId: order.freightAccountPlanId ?? purchasingDefaults.freightAccountPlanId ?? '',
      resultCenterId: order.resultCenterId ?? '',
      notes: order.notes ?? '',
    });
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!order || !editForm) return;
    const selectedAccountPlan = flattenedAccountPlans.find((plan) => plan.id === editForm.accountPlanId);
    const selectedFreightAccountPlan =
      flattenedAccountPlans.find((plan) => plan.id === editForm.freightAccountPlanId);
    const selectedResultCenter = (resultCenters ?? []).find((center) => center.id === editForm.resultCenterId);

    setSaving(true);
    try {
      await updateOrder(order.id, {
        paymentMethod: editForm.paymentMethod,
        paymentCondition: editForm.paymentCondition,
        installmentsCount: editForm.paymentCondition === 'installments' ? editForm.installmentsCount : undefined,
        paymentDueDate: editForm.paymentDueDate,
        estimatedReceiptDate: order.receiptMode === 'future_delivery' ? editForm.estimatedReceiptDate : undefined,
        deliveryFee: editForm.deliveryFee,
        accountPlanId: editForm.accountPlanId,
        accountPlanName: selectedAccountPlan?.name,
        freightAccountPlanId: editForm.deliveryFee > 0 ? editForm.freightAccountPlanId : '',
        freightAccountPlanName: editForm.deliveryFee > 0 ? selectedFreightAccountPlan?.name : '',
        resultCenterId: editForm.resultCenterId,
        resultCenterName: selectedResultCenter?.name,
        notes: editForm.notes,
      });
      setEditOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmOrder = async () => {
    if (!order) return;
    setConfirming(true);
    try {
      await confirmOrder(order.id);
    } finally {
      setConfirming(false);
    }
  };

  const handleMarkAsPaid = async () => {
    if (!financial) return;
    setMarkingPaid(true);
    try {
      await markAsPaid(financial.id);
    } finally {
      setMarkingPaid(false);
    }
  };

  if (loading || classificationLoading) {
    return (
      <div className="container max-w-6xl py-8 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-6">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="container max-w-3xl py-8 space-y-4">
        <p className="text-muted-foreground">Compra não encontrada.</p>
        <Button variant="outline" onClick={() => router.push('/dashboard/purchasing/orders')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <PermissionGuard allowed={canView}>
      <div className="container max-w-6xl py-8 space-y-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/dashboard/purchasing/orders')}
          className="-ml-2"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Compras
        </Button>

        <div className="rounded-2xl border bg-card p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-start gap-4">
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-3xl font-bold">
                  {supplier?.fantasyName ?? supplier?.name ?? '—'}
                </h1>
                <Badge variant={isCancelled ? 'destructive' : isCreated ? 'secondary' : 'default'}>
                  {isCancelled ? 'Cancelada' : isReceived ? 'Recebida' : isCreated ? 'Em revisão' : 'Confirmada'}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {RECEIPT_LABELS[order.receiptMode]}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {order.origin === 'direct' ? 'Compra direta' : 'Via cotação'}
                </Badge>
                {financial && (
                  <Badge variant="outline" className="text-xs">
                    Financeiro: {FINANCIAL_STATUS_LABELS[financial.status]}
                  </Badge>
                )}
              </div>

              <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
                <span>Criada em {format(parseISO(order.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
                {order.confirmedAt && (
                  <span>Confirmada em {format(parseISO(order.confirmedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
                )}
                <span>Pagamento: {PAYMENT_LABELS[order.paymentMethod]}</span>
                <span>Condição: {PAYMENT_CONDITION_LABELS[order.paymentCondition ?? 'cash']}</span>
                <span>Data do pagamento: {format(parseISO(order.paymentDueDate), 'dd/MM/yyyy')}</span>
                {order.receiptMode === 'future_delivery' && (
                  <span>Entrega prevista: {format(parseISO(order.estimatedReceiptDate), 'dd/MM/yyyy')}</span>
                )}
              </div>

              {order.quotationId && (
                <div className="flex flex-wrap gap-3">
                  <Link
                    href={`/dashboard/purchasing/quotations/${order.quotationId}`}
                    className="inline-flex text-xs text-primary hover:underline"
                  >
                    Ver cotação de origem
                  </Link>
                  {order.linkedExpenseId && (
                    <Link
                      href={`/dashboard/financial/expenses/new?edit=${order.linkedExpenseId}`}
                      className="inline-flex text-xs text-primary hover:underline"
                    >
                      Abrir despesa no financeiro
                    </Link>
                  )}
                </div>
              )}

              {isCreated && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <p className="font-medium">Pedido aguardando conferência final.</p>
                      <p>
                        Revise itens, frete, plano de contas, centro de resultado e forma de pagamento.
                        Depois confirme o pedido para liberar recebimento e acompanhamento financeiro.
                      </p>
                      {!isReadyForConfirmation && (
                        <p className="font-medium">
                          Ainda faltam classificações financeiras obrigatórias para confirmar o pedido.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {isCancelled && order.cancelReason && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                  Cancelada: {order.cancelReason}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {canEditOrder && (
                <Button variant="outline" onClick={openEdit}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar dados
                </Button>
              )}
              {canConfirmOrder && (
                <Button onClick={handleConfirmOrder} disabled={confirming || !isReadyForConfirmation}>
                  {confirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {!confirming && <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Confirmar pedido
                </Button>
              )}
              {canRegisterPayment && (
                <Button variant="outline" onClick={handleMarkAsPaid} disabled={markingPaid}>
                  {markingPaid && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {!markingPaid && <CreditCard className="mr-2 h-4 w-4" />}
                  Registrar pagamento
                </Button>
              )}
              {!isCancelled && !isReceived && canCancel && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="text-destructive border-destructive/50 hover:bg-destructive/5">
                      <XCircle className="mr-2 h-4 w-4" />
                      Cancelar compra
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Cancelar compra?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Informe o motivo do cancelamento. Esta ação não pode ser desfeita.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <Input
                      placeholder="Motivo do cancelamento..."
                      value={cancelReason}
                      onChange={(event) => setCancelReason(event.target.value)}
                    />
                    <AlertDialogFooter>
                      <AlertDialogCancel>Voltar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleCancel}
                        disabled={cancelling || !cancelReason.trim()}
                        className="bg-destructive hover:bg-destructive/90"
                      >
                        {cancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Cancelar compra
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Mercadorias</p>
              <p className="mt-1 text-2xl font-semibold">{fmt(goodsGrossSubtotal)}</p>
            </div>
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Frete</p>
              <p className="mt-1 text-2xl font-semibold">{fmt(order.deliveryFee ?? 0)}</p>
            </div>
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total do pedido</p>
              <p className="mt-1 text-2xl font-semibold">{fmt(effectiveOrderTotal)}</p>
            </div>
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Situação financeira</p>
              <p className="mt-1 text-lg font-semibold">
                {financial ? FINANCIAL_STATUS_LABELS[financial.status] : 'Sem título'}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-6 items-start">
          <div className="space-y-4">
            <div className="rounded-2xl border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-semibold">Itens do pedido</h2>
                </div>
                <div className="flex items-center gap-3">
                  {isCreated && canEdit && (
                    <Button variant="ghost" size="sm" onClick={() => setItemsEditOpen(true)}>
                      <Pencil className="mr-2 h-3 w-3" />
                      Editar itens
                    </Button>
                  )}
                  <span className="text-sm text-muted-foreground">{items.length} item(ns)</span>
                </div>
              </div>

              {itemsLoading ? (
                <div className="p-5 space-y-3">
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-20 w-full" />
                  ))}
                </div>
              ) : (
                <div className="divide-y">
                  {displayItems.map((item) => {
                    const base = baseProducts.find((bp) => bp.id === item.baseItemId);
                    return (
                      <div key={item.id} className="px-5 py-4 space-y-2">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="font-semibold truncate">{base?.name ?? item.baseItemId}</p>
                            <p className="text-sm text-muted-foreground">
                              {item.quantityOrdered} {item.purchaseUnitLabel ?? item.unit} x {fmt(item.unitPriceOrdered)}
                            </p>
                            {(item.discountOrdered ?? 0) > 0 && (
                              <p className="text-sm text-muted-foreground">
                                Desconto: {fmt(item.discountOrdered ?? 0)}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm text-muted-foreground">Subtotal</p>
                            <p className="font-semibold">{fmt(item.totalOrdered)}</p>
                          </div>
                        </div>
                        {item.notes && (
                          <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                            {item.notes}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {order.status === 'confirmed' && !isReceived && canReceive && (
              <div className="rounded-2xl border-2 border-dashed p-6 text-center space-y-3">
                <p className="text-sm text-muted-foreground">
                  {order.receiptMode === 'future_delivery'
                    ? 'Pedido confirmado. Aguarde a entrega, faça a conferência e depois registre a entrada no estoque.'
                    : 'Pedido confirmado. A compra retirada pode seguir direto para a entrada no estoque.'}
                </p>
                <Button asChild>
                  <Link href={`/dashboard/purchasing/orders/${order.id}/receipt`}>
                    {order.receiptMode === 'future_delivery' ? 'Abrir recebimento' : 'Abrir entrada no estoque'}
                  </Link>
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-4 xl:sticky xl:top-6">
            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <ReceiptText className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold">Resumo financeiro</h3>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Condição</span>
                  <span>
                    {PAYMENT_CONDITION_LABELS[order.paymentCondition ?? 'cash']}
                    {order.paymentCondition === 'installments' && order.installmentsCount
                      ? ` · ${order.installmentsCount}x`
                      : ''}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Forma de pagamento</span>
                  <span>{PAYMENT_LABELS[order.paymentMethod]}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Data do pagamento</span>
                  <span>{format(parseISO(order.paymentDueDate), 'dd/MM/yyyy')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Valor previsto</span>
                  <span>{fmt(effectiveOrderTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Valor confirmado</span>
                  <span>{financial?.amountConfirmed != null ? fmt(financial.amountConfirmed) : 'Aguardando recebimento'}</span>
                </div>
                {financial?.paidAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pago em</span>
                    <span>{format(parseISO(financial.paidAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Scale className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold">Classificação</h3>
              </div>

              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Plano de contas da mercadoria</p>
                  <p className="font-medium">{order.accountPlanName ?? 'Não definido'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Centro de resultado</p>
                  <p className="font-medium">{order.resultCenterName ?? 'Não definido'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Plano de contas do frete</p>
                  <p className="font-medium">
                    {order.deliveryFee && order.deliveryFee > 0
                      ? order.freightAccountPlanName ?? 'Não definida'
                      : 'Sem frete'}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold">Recebimento</h3>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tipo</span>
                  <span>{RECEIPT_LABELS[order.receiptMode]}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Entrega prevista</span>
                  <span>{format(parseISO(order.estimatedReceiptDate), 'dd/MM/yyyy')}</span>
                </div>
              </div>
            </div>

            {order.notes && (
              <div className="rounded-2xl border bg-card p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold">Observações</h3>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{order.notes}</p>
              </div>
            )}
          </div>
        </div>

        {editForm && (
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Editar pedido</DialogTitle>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Forma de pagamento</Label>
                    <Select
                      value={editForm.paymentMethod}
                      onValueChange={(value) => setEditForm((current) => current && { ...current, paymentMethod: value as PaymentMethod })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map((method) => (
                          <SelectItem key={method} value={method}>
                            {PAYMENT_LABELS[method]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Condição de pagamento</Label>
                    <Select
                      value={editForm.paymentCondition}
                      onValueChange={(value) =>
                        setEditForm((current) =>
                          current
                            ? {
                                ...current,
                                paymentCondition: value as PurchasePaymentCondition,
                                installmentsCount:
                                  value === 'installments' ? Math.max(2, current.installmentsCount) : current.installmentsCount,
                              }
                            : current,
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">À vista</SelectItem>
                        <SelectItem value="installments">Parcelado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Data do pagamento</Label>
                    <Input
                      type="date"
                      value={editForm.paymentDueDate}
                      onChange={(event) => setEditForm((current) => current && { ...current, paymentDueDate: event.target.value })}
                    />
                  </div>

                  {editForm.paymentCondition === 'installments' && (
                    <div className="space-y-1.5">
                      <Label>Parcelas para análise</Label>
                      <Input
                        type="number"
                        min={2}
                        value={editForm.installmentsCount}
                        onChange={(event) =>
                          setEditForm((current) =>
                            current
                              ? { ...current, installmentsCount: Math.max(2, Number(event.target.value || 2)) }
                              : current,
                          )
                        }
                      />
                    </div>
                  )}

                  {order.receiptMode === 'future_delivery' && (
                    <div className="space-y-1.5">
                      <Label>Entrega prevista</Label>
                      <Input
                        type="date"
                        value={editForm.estimatedReceiptDate}
                        onChange={(event) => setEditForm((current) => current && { ...current, estimatedReceiptDate: event.target.value })}
                      />
                    </div>
                  )}

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Plano de contas da mercadoria</Label>
                    <AccountPlanTreeSelect
                      value={editForm.accountPlanId}
                      onChange={(value) => setEditForm((current) => current && { ...current, accountPlanId: value })}
                      options={accountPlans}
                      placeholder="Selecione o plano de contas"
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Centro de resultado</Label>
                    <Select
                      value={editForm.resultCenterId}
                      onValueChange={(value) => setEditForm((current) => current && { ...current, resultCenterId: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o centro de resultado" />
                      </SelectTrigger>
                      <SelectContent>
                        {(resultCenters ?? []).map((center) => (
                          <SelectItem key={center.id} value={center.id}>
                            {center.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Frete / entrega</Label>
                    <CurrencyInput
                      value={editForm.deliveryFee}
                      onChange={(value) => setEditForm((current) => current && { ...current, deliveryFee: value })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Plano de contas do frete</Label>
                    <AccountPlanTreeSelect
                      value={editForm.deliveryFee > 0 ? editForm.freightAccountPlanId : '__none__'}
                      onChange={(value) =>
                        setEditForm((current) =>
                          current
                            ? { ...current, freightAccountPlanId: value === '__none__' ? '' : value }
                            : current,
                        )
                      }
                      options={accountPlans}
                      placeholder={editForm.deliveryFee > 0 ? 'Selecione o plano de contas' : 'Sem frete'}
                      noneLabel="Sem frete"
                      allowNone
                      disabled={editForm.deliveryFee <= 0}
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Observações</Label>
                    <Textarea
                      rows={4}
                      placeholder="Observações sobre a compra..."
                      value={editForm.notes}
                      onChange={(event) => setEditForm((current) => current && { ...current, notes: event.target.value })}
                    />
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={
                    saving ||
                    !editForm.paymentDueDate ||
                    !editForm.accountPlanId ||
                    !editForm.resultCenterId ||
                    (editForm.deliveryFee > 0 && !editForm.freightAccountPlanId)
                  }
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        <ManageOrderItemsModal
          orderId={params.orderId}
          initialItems={items}
          open={itemsEditOpen}
          onOpenChange={setItemsEditOpen}
          onSuccess={() => {
            fetchOrderItems(params.orderId).then(setItems);
          }}
        />
      </div>
    </PermissionGuard>
  );
}
