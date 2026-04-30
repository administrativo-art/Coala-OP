"use client";

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ArrowLeft,
  AlertTriangle,
  Loader2,
  StickyNote,
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Truck,
  CreditCard,
  MessageSquare,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { CurrencyInput } from '@/components/ui/currency-input';
import { AccountPlanTreeSelect } from '@/components/purchasing/account-plan-tree-select';
import { PermissionGuard } from '@/components/permission-guard';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { useQuotations } from '@/hooks/use-quotations';
import { useQuotationItems } from '@/hooks/use-quotation-items';
import { useEntities } from '@/hooks/use-entities';
import { useBaseProducts } from '@/hooks/use-base-products';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { usePurchasingFinancialOptions } from '@/hooks/use-purchasing-financial-options';
import { canCreatePurchase, canViewPurchasing } from '@/lib/purchasing-permissions';
import { cn } from '@/lib/utils';
import { type PaymentMethod, type Quotation } from '@/types';
import { type PurchasePaymentCondition } from '@/types';

const PAYMENT_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'pix', label: 'Pix' },
  { value: 'card_credit', label: 'Cartão de crédito' },
  { value: 'card_debit', label: 'Cartão de débito' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'term', label: 'A prazo' },
];

const PAYMENT_CONDITION_OPTIONS: { value: PurchasePaymentCondition; label: string }[] = [
  { value: 'cash', label: 'À vista' },
  { value: 'installments', label: 'Parcelado' },
];

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function ConfirmPurchasePage() {
  const params = useParams<{ quotationId: string }>();
  const router = useRouter();
  const { permissions, firebaseUser } = useAuth();
  const { quotations, loading: quotationsLoading } = useQuotations();
  const { items, loading: itemsLoading } = useQuotationItems(params.quotationId);
  const { entities } = useEntities();
  const { baseProducts } = useBaseProducts();
  const { createPurchase } = usePurchaseOrders();
  const { purchasingDefaults } = useCompanySettings();
  const { accountPlans, flattenedAccountPlans, resultCenters, loading: classificationLoading } = usePurchasingFinancialOptions();
  const canView = canViewPurchasing(permissions);
  const canCreate = canCreatePurchase(permissions);

  const [fallbackQuotation, setFallbackQuotation] = useState<Quotation | null>(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (quotationsLoading || quotations.find((q) => q.id === params.quotationId) || !firebaseUser) return;
      setFallbackLoading(true);
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch(`/api/purchasing/quotations/${params.quotationId}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        setFallbackQuotation((await res.json()) as Quotation);
      } finally {
        if (!cancelled) setFallbackLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [firebaseUser, quotationsLoading, quotations, params.quotationId]);

  const quotation = useMemo(
    () => quotations.find((q) => q.id === params.quotationId) ?? fallbackQuotation,
    [quotations, fallbackQuotation, params.quotationId],
  );

  const supplier = useMemo(
    () => entities.find((e) => e.id === quotation?.supplierId),
    [entities, quotation],
  );

  const eligibleItems = useMemo(
    () => items.filter((i) => i.conversionStatus === 'selected'),
    [items],
  );

  const freeItems = useMemo(
    () => eligibleItems.filter((i) => !i.baseItemId),
    [eligibleItems],
  );

  const today = format(new Date(), 'yyyy-MM-dd');

  const [receiptMode, setReceiptMode] = useState<'immediate_pickup' | 'future_delivery'>('immediate_pickup');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix');
  const [paymentCondition, setPaymentCondition] = useState<PurchasePaymentCondition>('cash');
  const [installmentsCount, setInstallmentsCount] = useState(2);
  const [paymentDueDate, setPaymentDueDate] = useState(today);
  const [estimatedReceiptDate, setEstimatedReceiptDate] = useState(today);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [accountPlanId, setAccountPlanId] = useState('');
  const [resultCenterId, setResultCenterId] = useState('');
  const [freightAccountPlanId, setFreightAccountPlanId] = useState('');
  const [generalNotes, setGeneralNotes] = useState('');
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!accountPlanId && purchasingDefaults.goodsAccountPlanId) {
      setAccountPlanId(purchasingDefaults.goodsAccountPlanId);
    }
  }, [accountPlanId, purchasingDefaults.goodsAccountPlanId]);

  useEffect(() => {
    if (!freightAccountPlanId && purchasingDefaults.freightAccountPlanId) {
      setFreightAccountPlanId(purchasingDefaults.freightAccountPlanId);
    }
  }, [freightAccountPlanId, purchasingDefaults.freightAccountPlanId]);

  const toggleNote = (id: string) =>
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectedAccountPlan = useMemo(
    () => flattenedAccountPlans.find((plan) => plan.id === accountPlanId) ?? null,
    [flattenedAccountPlans, accountPlanId],
  );

  const selectedFreightAccountPlan = useMemo(
    () => flattenedAccountPlans.find((plan) => plan.id === freightAccountPlanId) ?? null,
    [flattenedAccountPlans, freightAccountPlanId],
  );

  const selectedResultCenter = useMemo(
    () => (resultCenters ?? []).find((center) => center.id === resultCenterId) ?? null,
    [resultCenters, resultCenterId],
  );

  const itemsSubtotal = useMemo(
    () => eligibleItems.filter((i) => !!i.baseItemId).reduce((s, i) => s + i.totalPrice, 0),
    [eligibleItems],
  );

  const grandTotal = itemsSubtotal + deliveryFee;
  const normalItems = eligibleItems.filter((i) => !!i.baseItemId);
  const canSubmit =
    normalItems.length > 0 &&
    !!paymentDueDate &&
    !!accountPlanId &&
    !!resultCenterId &&
    (deliveryFee <= 0 || !!freightAccountPlanId);

  const handleSubmit = async () => {
    if (!quotation || !canSubmit) return;
    setSubmitting(true);
    try {
      const orderId = await createPurchase({
        supplierId: quotation.supplierId,
        origin: 'quotation',
        quotationId: quotation.id,
        receiptMode,
        paymentMethod,
        paymentDueDate,
        paymentCondition,
        installmentsCount: paymentCondition === 'installments' ? installmentsCount : undefined,
        estimatedReceiptDate:
          receiptMode === 'immediate_pickup' ? new Date().toISOString() : estimatedReceiptDate,
        accountPlanId,
        accountPlanName: selectedAccountPlan?.name,
        freightAccountPlanId: deliveryFee > 0 ? freightAccountPlanId : undefined,
        freightAccountPlanName: deliveryFee > 0 ? selectedFreightAccountPlan?.name : undefined,
        resultCenterId,
        resultCenterName: selectedResultCenter?.name,
        deliveryFee,
        notes: generalNotes.trim() || undefined,
        items: normalItems.map((item) => ({
          baseItemId: item.baseItemId!,
          productId: item.productId,
          quotationItemId: item.id,
          unit: item.unit,
          purchaseUnitType: item.purchaseUnitType ?? 'content',
          purchaseUnitLabel: item.purchaseUnitLabel ?? item.unit,
          quantityOrdered: item.quantity,
          unitPriceOrdered: item.unitPrice,
          discountOrdered: item.discount ?? 0,
          notes: itemNotes[item.id]?.trim() || undefined,
        })),
      });

      if (orderId) {
        router.push(`/dashboard/purchasing/orders/${orderId}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isLoading =
    quotationsLoading ||
    fallbackLoading ||
    itemsLoading ||
    classificationLoading;

  if (isLoading) {
    return (
      <div className="container max-w-5xl py-8 space-y-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
          <div className="lg:col-span-2"><Skeleton className="h-80 w-full" /></div>
        </div>
      </div>
    );
  }

  if (!quotation) {
    return (
      <div className="container max-w-5xl py-8 space-y-4">
        <p className="text-muted-foreground">Cotação não encontrada.</p>
        <Button variant="outline" onClick={() => router.push('/dashboard/purchasing')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
        </Button>
      </div>
    );
  }

  return (
    <PermissionGuard allowed={canView && canCreate}>
      <div className="container max-w-5xl py-8 space-y-6">

        {/* Back */}
        <Button variant="ghost" size="sm" className="-ml-2"
          onClick={() => router.push(`/dashboard/purchasing/quotations/${quotation.id}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar à cotação
        </Button>

        {/* Supplier + quotation summary card */}
        <div className="rounded-xl border bg-card p-6 space-y-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold">
                  {supplier?.fantasyName ?? supplier?.name ?? quotation.supplierId}
                </h1>
                <Badge variant="secondary" className="text-xs">
                  {quotation.mode === 'remote' ? 'Cotação remota' : 'Cotação in loco'}
                </Badge>
              </div>
              <div className="flex gap-4 text-sm text-muted-foreground mt-1 flex-wrap">
                {quotation.finalizedAt && (
                  <span className="flex items-center gap-1">
                    <CalendarClock className="h-3.5 w-3.5" />
                    Finalizada em {format(parseISO(quotation.finalizedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </span>
                )}
                {quotation.validUntil && (
                  <span>Válida até {format(parseISO(quotation.validUntil), 'dd/MM/yyyy', { locale: ptBR })}</span>
                )}
              </div>
            </div>
          </div>

          {/* Item count + total summary */}
          <div className="grid grid-cols-3 gap-3 pt-1">
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-2xl font-bold">{normalItems.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {normalItems.length === 1 ? 'item selecionado' : 'itens selecionados'}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-2xl font-bold">{fmt(itemsSubtotal)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">subtotal de mercadorias</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-2xl font-bold">{fmt(grandTotal)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">total do pedido</p>
            </div>
          </div>
        </div>

        {/* Free items warning */}
        {freeItems.length > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-200">
                {freeItems.length} item{freeItems.length > 1 ? 's livres' : ' livre'} não pode{freeItems.length > 1 ? 'm' : ''} entrar no pedido
              </p>
              <p className="text-amber-700 dark:text-amber-300 text-xs mt-0.5">
                Normalize-os na cotação antes de confirmar.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">

          {/* ── Left: items ──────────────────────────────────────────── */}
          <div className="lg:col-span-3 space-y-3">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Itens do pedido
            </h2>

            {normalItems.length === 0 ? (
              <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                Nenhum item normalizado marcado para compra.
              </div>
            ) : (
              <div className="rounded-xl border divide-y overflow-hidden">
                {normalItems.map((item, idx) => {
                  const base = baseProducts.find((bp) => bp.id === item.baseItemId);
                  const noteOpen = expandedNotes.has(item.id);
                  const note = itemNotes[item.id] ?? '';

                  return (
                    <div key={item.id} className="bg-card">
                      <div className="flex items-center gap-4 px-5 py-4">
                        {/* index badge */}
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                          {idx + 1}
                        </span>

                        {/* name + details */}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate">{base?.name ?? item.baseItemId}</p>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {item.quantity} {item.unit}
                            <span className="mx-1.5 text-muted-foreground/50">×</span>
                            {fmt(item.unitPrice)}/{item.unit}
                          </p>
                          {item.observation && (
                            <p className="text-xs text-muted-foreground italic mt-1">
                              Obs. cotação: {item.observation}
                            </p>
                          )}
                        </div>

                        {/* subtotal */}
                        <div className="text-right shrink-0">
                          <p className="font-semibold">{fmt(item.totalPrice)}</p>
                          <button
                            type="button"
                            onClick={() => toggleNote(item.id)}
                            className={cn(
                              'mt-1 flex items-center gap-1 text-xs rounded-md px-2 py-0.5 transition-colors',
                              noteOpen || note
                                ? 'text-primary bg-primary/8 font-medium'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                            )}
                          >
                            <StickyNote className="h-3 w-3" />
                            Obs.
                            {noteOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </button>
                        </div>
                      </div>

                      {/* per-item note */}
                      {noteOpen && (
                        <div className="px-5 pb-4 pt-0">
                          <Textarea
                            placeholder="Observação para este item..."
                            className="text-sm resize-none h-16 bg-muted/30"
                            value={note}
                            onChange={(e) =>
                              setItemNotes((prev) => ({ ...prev, [item.id]: e.target.value }))
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Subtotal row */}
            {normalItems.length > 0 && (
              <div className="flex items-center justify-between rounded-lg bg-muted/40 px-5 py-3 text-sm font-medium">
                <span className="text-muted-foreground">Subtotal de mercadorias</span>
                <span>{fmt(itemsSubtotal)}</span>
              </div>
            )}
          </div>

          {/* ── Right: config + summary ───────────────────────────── */}
          <div className="lg:col-span-2 space-y-4 lg:sticky lg:top-6">

            {/* Recebimento */}
            <div className="rounded-xl border bg-card p-5 space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" />
                Recebimento
              </h3>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Tipo</Label>
                <Select value={receiptMode} onValueChange={(v) => setReceiptMode(v as typeof receiptMode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="immediate_pickup">Retirada imediata</SelectItem>
                    <SelectItem value="future_delivery">Entrega futura</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {receiptMode === 'future_delivery' && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Data estimada de entrega</Label>
                  <Input type="date" min={today} value={estimatedReceiptDate}
                    onChange={(e) => setEstimatedReceiptDate(e.target.value)} />
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Frete / entrega (opcional)</Label>
                <CurrencyInput value={deliveryFee} onChange={setDeliveryFee} />
              </div>
            </div>

            {/* Pagamento */}
            <div className="rounded-xl border bg-card p-5 space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                Pagamento
              </h3>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Forma de pagamento</Label>
                <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Condição de pagamento</Label>
                <Select value={paymentCondition} onValueChange={(v) => setPaymentCondition(v as PurchasePaymentCondition)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_CONDITION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Data do pagamento</Label>
                <Input type="date" value={paymentDueDate}
                  onChange={(e) => setPaymentDueDate(e.target.value)} />
              </div>

              {paymentCondition === 'installments' && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Parcelas para análise</Label>
                  <Input
                    type="number"
                    min={2}
                    value={installmentsCount}
                    onChange={(e) => setInstallmentsCount(Math.max(2, Number(e.target.value || 2)))}
                  />
                  <p className="text-xs text-muted-foreground">
                    O detalhamento das parcelas será tratado no financeiro. Aqui fica apenas a decisão geral do pedido.
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-xl border bg-card p-5 space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                Classificação financeira
              </h3>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Plano de contas da mercadoria</Label>
                <AccountPlanTreeSelect
                  value={accountPlanId}
                  onChange={setAccountPlanId}
                  options={accountPlans}
                  placeholder="Selecione o plano de contas"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Centro de resultado</Label>
                <Select value={resultCenterId} onValueChange={setResultCenterId}>
                  <SelectTrigger><SelectValue placeholder="Selecione o centro de resultado" /></SelectTrigger>
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
                <Label className="text-xs text-muted-foreground">Plano de contas do frete</Label>
                <AccountPlanTreeSelect
                  value={deliveryFee > 0 ? freightAccountPlanId : '__none__'}
                  onChange={(value) => setFreightAccountPlanId(value === '__none__' ? '' : value)}
                  options={accountPlans}
                  placeholder={deliveryFee > 0 ? 'Selecione o plano de contas do frete' : 'Informe frete para classificar'}
                  noneLabel="Sem frete"
                  allowNone
                  disabled={deliveryFee <= 0}
                />
                <p className="text-xs text-muted-foreground">
                  O frete será lançado no financeiro separado da mercadoria, com este plano de contas.
                </p>
              </div>
            </div>

            {/* Observações gerais */}
            <div className="rounded-xl border bg-card p-5 space-y-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                Observações gerais
              </h3>
              <Textarea placeholder="Informações adicionais sobre o pedido..."
                className="resize-none h-20 text-sm" value={generalNotes}
                onChange={(e) => setGeneralNotes(e.target.value)} />
            </div>

            {/* Summary + confirm */}
            <div className="rounded-xl border bg-muted/30 p-5 space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Mercadorias</span>
                  <span>{fmt(itemsSubtotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Frete / entrega</span>
                  <span>{fmt(deliveryFee)}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-bold text-base">
                  <span>Total do pedido</span>
                  <span>{fmt(grandTotal)}</span>
                </div>
              </div>

              <div className="rounded-lg border bg-background px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p>O pedido será gerado em revisão para conferência final.</p>
                <p>Depois, na tela do pedido, você confirma os dados antes de liberar recebimento e pagamento.</p>
              </div>

              <Button className="w-full" size="lg" disabled={submitting || !canSubmit} onClick={handleSubmit}>
                {submitting
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <CheckCircle2 className="mr-2 h-4 w-4" />
                }
                Gerar pedido para conferência
              </Button>

              {!canSubmit && (
                <p className="text-xs text-center text-muted-foreground">
                  {normalItems.length === 0
                    ? 'Nenhum item disponível para gerar o pedido.'
                    : 'Preencha pagamento, centro de resultado e plano(s) de contas para continuar.'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </PermissionGuard>
  );
}
