"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addMonths, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import Image from "next/image";
import { BackButton } from "@/components/navigation/back-button";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CreditCard,
  Loader2,
  Pencil,
  ReceiptText,
  RotateCcw,
  Scale,
  ShoppingCart,
  Truck,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PermissionGuard } from "@/components/permission-guard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyInput } from "@/components/ui/currency-input";
import { AccountPlanTreeSelect } from "@/components/purchasing/account-plan-tree-select";
import { ResultCenterSelect } from "@/components/purchasing/result-center-select";
import { InstallmentPlanDialog } from "@/components/purchasing/installment-plan-dialog";
import { ManageOrderItemsModal } from "@/components/purchasing/manage-order-items-modal";
import { useAuth } from "@/hooks/use-auth";
import { useBaseProducts } from "@/hooks/use-base-products";
import { useCompanySettings } from "@/hooks/use-company-settings";
import { useEntities } from "@/hooks/use-entities";
import { useProducts } from "@/hooks/use-products";
import { usePurchaseFinancials } from "@/hooks/use-purchase-financials";
import { usePurchaseOrders } from "@/hooks/use-purchase-orders";
import { usePurchaseReceipts } from "@/hooks/use-purchase-receipts";
import { useQuotationItems } from "@/hooks/use-quotation-items";
import { usePurchasingFinancialOptions } from "@/hooks/use-purchasing-financial-options";
import { PurchasingModuleNavigation } from "@/components/purchasing/purchasing-module-navigation";
import {
  canCancelPurchase,
  canCreatePurchase,
  canManagePurchaseFinancials,
  canReceivePurchase,
  canRevertPurchaseStage,
  canViewPurchasing,
} from "@/lib/purchasing-permissions";
import {
  type PaymentMethod,
  type PurchaseFinancialStatus,
  type PurchaseFreightPaymentMode,
  type PurchaseOrderItem,
  type PurchasePaymentCondition,
} from "@/types";
import { purchaseTreatmentSkipsOperationalEntry } from "@/lib/purchasing-item-treatment";
import { cn } from "@/lib/utils";
import {
  PurchasingPageFrame,
  PurchasingStatusBadge,
} from "@/components/purchasing/purchasing-ui";

const RECEIPT_LABELS: Record<string, string> = {
  future_delivery: "Entrega futura",
  immediate_pickup: "Retirada imediata",
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  pix: "Pix",
  card_credit: "Cartão de crédito",
  card_debit: "Cartão de débito",
  cash: "Dinheiro",
  boleto: "Boleto",
  term: "A prazo",
};

const PAYMENT_METHODS: PaymentMethod[] = [
  "pix",
  "card_credit",
  "card_debit",
  "cash",
  "boleto",
  "term",
];
const CANCELLATION_REASON_SUGGESTIONS = [
  "Fornecedor sem estoque",
  "Preço reajustado após o pedido",
  "Pedido duplicado",
  "Compra não autorizada",
] as const;
const RECEIVED_ELSEWHERE_NOTE_SUGGESTIONS = [
  "Entrada registrada direto no estoque pelo gerente",
  "Mercadoria entregue em outra unidade",
  "Consumo imediato, sem passar pelo estoque",
] as const;
const REVERSION_REASON_SUGGESTIONS = [
  "Corrigir itens ou valores do pedido",
  "Ajustar condição ou forma de pagamento",
  "Revisar dados de entrega ou frete",
] as const;

type OrderActionPanel = "confirm" | "revert" | "received-elsewhere" | "cancel";

const PAYMENT_CONDITION_LABELS: Record<PurchasePaymentCondition, string> = {
  cash: "À vista",
  installments: "Parcelado",
};

function getPaymentDateLabel(paymentMethod?: PaymentMethod) {
  return paymentMethod === "card_credit" || paymentMethod === "card_debit"
    ? "Data da compra"
    : "Vencimento";
}

const PENDING_FIELD_CLASS = "border-amber-400 dark:border-amber-600";
const MISSING_VALUE_CLASS =
  "inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400";

function RequiredMark() {
  return <span className="text-destructive"> *</span>;
}

const FREIGHT_PAYMENT_MODE_LABELS: Record<PurchaseFreightPaymentMode, string> =
  {
    included_with_goods: "Pago junto com a mercadoria",
    separate: "Pago em separado",
  };

const FINANCIAL_STATUS_LABELS: Record<PurchaseFinancialStatus, string> = {
  forecasted: "Previsto",
  confirmed: "Confirmado",
  divergent: "Divergente",
  paid: "Pago",
  cancelled: "Cancelado",
};

type EditForm = {
  paymentMethod: PaymentMethod;
  paymentCondition: PurchasePaymentCondition;
  installmentsCount: number;
  installmentDueDates: string[];
  paymentDueDate: string;
  estimatedReceiptDate: string;
  deliveryFee: number;
  accountPlanId: string;
  freightAccountPlanId: string;
  freightPaymentMode: PurchaseFreightPaymentMode;
  freightSupplierName: string;
  resultCenterId: string;
  paymentCardKey: string;
  trackingInfo: string;
  notes: string;
};

function fmt(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtUnit(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}

function orderCode(id: string) {
  return `CMP-${id.slice(-8).toUpperCase()}`;
}

function lineGrossTotal(
  item: Pick<PurchaseOrderItem, "quantityOrdered" | "unitPriceOrdered">,
) {
  return Number(item.quantityOrdered ?? 0) * Number(item.unitPriceOrdered ?? 0);
}

function lineEffectiveUnitPrice(
  item: Pick<
    PurchaseOrderItem,
    "quantityOrdered" | "unitPriceOrdered" | "discountOrdered" | "totalOrdered"
  >,
) {
  const quantity = Number(item.quantityOrdered ?? 0);
  if (!(quantity > 0)) return Number(item.unitPriceOrdered ?? 0);
  const total =
    item.totalOrdered != null
      ? Number(item.totalOrdered ?? 0)
      : Math.max(lineGrossTotal(item) - Number(item.discountOrdered ?? 0), 0);
  return Number((total / quantity).toFixed(6));
}

function isCardPayment(paymentMethod?: PaymentMethod) {
  return paymentMethod === "card_credit" || paymentMethod === "card_debit";
}

function getOrderSupplierName(
  order?: { supplierName?: string; fiscal?: { issuerName?: string } } | null,
  fallback?: string,
) {
  return (
    order?.fiscal?.issuerName?.trim() ||
    order?.supplierName?.trim() ||
    fallback ||
    "—"
  );
}

function getPaymentCardKey(
  accountId?: string | null,
  methodId?: string | null,
) {
  return accountId && methodId ? `${accountId}::${methodId}` : "";
}

function buildMonthlyInstallmentDates(firstDueDate: string, count: number) {
  const parsed = parseISO(firstDueDate);
  if (Number.isNaN(parsed.getTime())) return [];
  return Array.from({ length: Math.max(2, count) }, (_, index) =>
    format(addMonths(parsed, index), "yyyy-MM-dd"),
  );
}

export default function PurchaseOrderPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const { permissions, firebaseUser, isDefaultAdmin } = useAuth();
  const {
    orders,
    loading,
    cancelOrder,
    updateOrder,
    confirmOrder,
    revertOrderStage,
    markReceivedElsewhere,
    fetchOrderItems,
  } = usePurchaseOrders();
  const { financials, markAsPaid } = usePurchaseFinancials();
  const { receipts } = usePurchaseReceipts();
  const { entities } = useEntities();
  const { baseProducts } = useBaseProducts();
  const { products, getProductFullName } = useProducts();
  const { purchasingDefaults } = useCompanySettings();
  const {
    accountPlans,
    flattenedAccountPlans,
    resultCenters,
    paymentCards,
    loading: classificationLoading,
  } = usePurchasingFinancialOptions();
  const canView = canViewPurchasing(permissions);
  const canCancel = canCancelPurchase(permissions);
  const canEdit = canCreatePurchase(permissions);
  const canReceive = canReceivePurchase(permissions);
  const canRevertStage = isDefaultAdmin || canRevertPurchaseStage(permissions);
  const canManageFinancials = canManagePurchaseFinancials(permissions);

  const [items, setItems] = useState<PurchaseOrderItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [revertReason, setRevertReason] = useState("");
  const [reversionError, setReversionError] = useState<string | null>(null);
  const [markingReceivedElsewhere, setMarkingReceivedElsewhere] =
    useState(false);
  const [receivedElsewhereNotes, setReceivedElsewhereNotes] = useState("");
  const [markingPaid, setMarkingPaid] = useState(false);
  const [actionPanel, setActionPanel] = useState<OrderActionPanel | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [installmentPlanOpen, setInstallmentPlanOpen] = useState(false);
  const [itemsEditOpen, setItemsEditOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncingExpense, setSyncingExpense] = useState(false);
  const expenseSyncAttemptedRef = useRef<string | null>(null);

  const order = useMemo(
    () => orders.find((o) => o.id === params.orderId),
    [orders, params.orderId],
  );
  const receipt = useMemo(
    () => receipts.find((entry) => entry.purchaseOrderId === params.orderId),
    [params.orderId, receipts],
  );
  const financial = useMemo(
    () =>
      financials.find(
        (entry) =>
          entry.purchaseOrderId === params.orderId &&
          entry.status !== "cancelled",
      ),
    [financials, params.orderId],
  );
  const { items: quotationItems } = useQuotationItems(
    order?.quotationId ?? null,
  );
  const supplier = useMemo(
    () => entities.find((e) => e.id === order?.supplierId),
    [entities, order],
  );
  const supplierDisplayName = getOrderSupplierName(
    order,
    supplier?.fantasyName ?? supplier?.name,
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
      if (
        !firebaseUser ||
        !order ||
        order.status !== "confirmed" ||
        order.linkedExpenseId ||
        order.archivedLinkedExpenseId ||
        order.financialExpenseArchivedAt ||
        syncingExpense
      ) {
        return;
      }
      if (expenseSyncAttemptedRef.current === order.id) return;

      expenseSyncAttemptedRef.current = order.id;
      setSyncingExpense(true);
      try {
        const token = await firebaseUser.getIdToken();
        const response = await fetch(
          `/api/purchasing/orders/${order.id}/sync-expense`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
          },
        );
        if (!response.ok && !cancelled) {
          const payload = await response.json().catch(() => ({}));
          console.error(
            "Falha ao sincronizar despesa da compra:",
            payload.error || response.statusText,
          );
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Falha ao sincronizar despesa da compra:", error);
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
        const effectiveDiscount = Number(
          item.discountOrdered ?? fallbackDiscount,
        );
        const grossTotal = lineGrossTotal(item);
        const effectiveTotal =
          item.discountOrdered == null && fallbackDiscount > 0
            ? Math.max(grossTotal - fallbackDiscount, 0)
            : Number(item.totalOrdered ?? 0);
        const effectiveUnitPrice = lineEffectiveUnitPrice({
          ...item,
          discountOrdered: effectiveDiscount,
          totalOrdered: effectiveTotal,
        });
        const hasLineDiscount =
          effectiveDiscount > 0 &&
          Math.abs(grossTotal - effectiveTotal) > 0.005;

        return {
          ...item,
          effectiveUnitPrice,
          discountOrdered: effectiveDiscount,
          grossTotal,
          hasLineDiscount,
          totalOrdered: effectiveTotal,
        };
      }),
    [items, quotationItems],
  );

  const goodsSubtotal = useMemo(
    () =>
      displayItems.reduce(
        (sum, item) => sum + Number(item.totalOrdered ?? 0),
        0,
      ),
    [displayItems],
  );
  const goodsGrossSubtotal = useMemo(
    () =>
      displayItems.reduce((sum, item) => sum + Number(item.grossTotal ?? 0), 0),
    [displayItems],
  );
  const goodsDiscountTotal = useMemo(
    () => Math.max(goodsGrossSubtotal - goodsSubtotal, 0),
    [goodsGrossSubtotal, goodsSubtotal],
  );
  const effectiveOrderTotal = useMemo(
    () => goodsSubtotal + Number(order?.deliveryFee ?? 0),
    [goodsSubtotal, order?.deliveryFee],
  );
  const unregisteredStockItems = useMemo(
    () =>
      displayItems.filter(
        (item) =>
          item.entryType !== "asset" &&
          // Componentes de patrimônio, despesas e serviços são compras avulsas:
          // não geram lote de estoque nem exigem cadastro de insumo.
          !purchaseTreatmentSkipsOperationalEntry(item.itemTreatment) &&
          (!item.productId || !item.baseItemId),
      ),
    [displayItems],
  );

  const isCancelled = order?.status === "cancelled";
  const isCreated = order?.status === "created";
  const isReceived = !!order?.receivedAt;
  const isFinancialReversalPending =
    order?.financialReversalStatus === "pending";
  const isReadyForConfirmation =
    !!order?.paymentDueDate &&
    !!order?.paymentMethod &&
    !!order?.accountPlanId &&
    !!order?.resultCenterId &&
    unregisteredStockItems.length === 0 &&
    ((order?.deliveryFee ?? 0) <= 0 ||
      (!!order?.freightAccountPlanId &&
        !!order?.freightPaymentMode &&
        (order.freightPaymentMode !== "separate" ||
          String(order.freightSupplierName || "").trim().length >= 2)));
  const canEditOrder =
    !!order &&
    canEdit &&
    !isCancelled &&
    !isReceived &&
    !isFinancialReversalPending;
  const canConfirmOrder =
    !!order &&
    isCreated &&
    canEdit &&
    !isCancelled &&
    !isFinancialReversalPending;
  const canRevertOrder =
    !!order &&
    canRevertStage &&
    !isReceived &&
    (order.status === "confirmed" || isFinancialReversalPending);
  const canMarkReceivedElsewhere =
    !!order && order.status === "confirmed" && !isReceived && canReceive;
  const canRegisterPayment =
    !!financial &&
    canManageFinancials &&
    (financial.status === "confirmed" || financial.status === "divergent");
  const orderProgress = isReceived
    ? 8
    : receipt &&
        [
          "in_conference",
          "partially_stocked",
          "stocked_with_divergence",
        ].includes(receipt.status)
      ? 6
      : order?.status === "confirmed"
        ? 5
        : 2;
  const orderTimeline = [
    {
      label: order?.origin === "quotation" ? "Cotação" : "Compra direta",
      when: order?.quotationId ? "origem vinculada" : "origem direta",
    },
    {
      label: "Pedido emitido",
      when: order?.createdAt ? format(parseISO(order.createdAt), "dd/MM") : "—",
    },
    {
      label: "Confirmado",
      when: order?.confirmedAt
        ? format(parseISO(order.confirmedAt), "dd/MM")
        : "—",
    },
    {
      label: "Financeiro previsto",
      when: financial?.createdAt
        ? format(parseISO(financial.createdAt), "dd/MM")
        : "—",
    },
    {
      label: "Recebimento",
      when: receipt?.expectedDate
        ? `prev. ${format(parseISO(receipt.expectedDate), "dd/MM")}`
        : "—",
    },
    {
      label: "Conferido",
      when: receipt?.conferenceCompletedAt
        ? format(parseISO(receipt.conferenceCompletedAt), "dd/MM")
        : "—",
    },
    {
      label: "Estoque",
      when: receipt?.stockEnteredAt
        ? format(parseISO(receipt.stockEnteredAt), "dd/MM")
        : "—",
    },
    {
      label: "Custo efetivo",
      when: receipt?.stockEnteredAt
        ? format(parseISO(receipt.stockEnteredAt), "dd/MM")
        : "—",
    },
  ];

  const handleCancel = async () => {
    if (!order || cancelReason.trim().length < 3) return;
    setCancelling(true);
    try {
      await cancelOrder(order.id, cancelReason);
      setActionPanel(null);
      setCancelReason("");
    } finally {
      setCancelling(false);
    }
  };

  const openEdit = () => {
    if (!order) return;
    const installmentsCount = order.installmentsCount ?? 2;
    const installmentDueDates =
      order.installmentDueDates?.length === installmentsCount
        ? order.installmentDueDates
        : buildMonthlyInstallmentDates(
            order.paymentDueDate.slice(0, 10),
            installmentsCount,
          );
    setEditForm({
      paymentMethod: order.paymentMethod,
      paymentCondition: order.paymentCondition ?? "cash",
      installmentsCount,
      installmentDueDates,
      paymentDueDate: order.paymentDueDate.slice(0, 10),
      estimatedReceiptDate: order.estimatedReceiptDate.slice(0, 10),
      deliveryFee: order.deliveryFee ?? 0,
      accountPlanId:
        order.accountPlanId ?? purchasingDefaults.goodsAccountPlanId ?? "",
      freightAccountPlanId:
        order.freightAccountPlanId ??
        purchasingDefaults.freightAccountPlanId ??
        "",
      freightPaymentMode: order.freightPaymentMode ?? "separate",
      freightSupplierName: order.freightSupplierName ?? "",
      resultCenterId: order.resultCenterId ?? "",
      paymentCardKey: getPaymentCardKey(
        order.paymentAccountId,
        order.paymentMethodId,
      ),
      trackingInfo: order.trackingInfo ?? "",
      notes: order.notes ?? "",
    });
    setEditOpen(true);
  };

  const editPendingFields = useMemo(() => {
    if (!editForm) return [];
    const pending: string[] = [];
    if (!editForm.paymentDueDate)
      pending.push(getPaymentDateLabel(editForm.paymentMethod));
    if (
      editForm.paymentCondition === "installments" &&
      editForm.installmentDueDates.length < 2
    ) {
      pending.push("Parcelamento");
    }
    if (isCardPayment(editForm.paymentMethod) && !editForm.paymentCardKey)
      pending.push("Cartão da compra");
    if (!editForm.accountPlanId) pending.push("Plano de contas da mercadoria");
    if (!editForm.resultCenterId) pending.push("Centro de resultado");
    if (editForm.deliveryFee > 0 && !editForm.freightAccountPlanId)
      pending.push("Plano de contas do frete");
    if (
      editForm.deliveryFee > 0 &&
      editForm.freightPaymentMode === "separate" &&
      editForm.freightSupplierName.trim().length < 2
    ) {
      pending.push("Favorecido do frete");
    }
    return pending;
  }, [editForm]);

  const handleSave = async () => {
    if (!order || !editForm) return;
    const selectedAccountPlan = flattenedAccountPlans.find(
      (plan) => plan.id === editForm.accountPlanId,
    );
    const selectedFreightAccountPlan = flattenedAccountPlans.find(
      (plan) => plan.id === editForm.freightAccountPlanId,
    );
    const selectedResultCenter = (resultCenters ?? []).find(
      (center) => center.id === editForm.resultCenterId,
    );
    const selectedPaymentCard = paymentCards.find(
      (card) =>
        getPaymentCardKey(card.accountId, card.methodId) ===
        editForm.paymentCardKey,
    );

    setSaving(true);
    try {
      await updateOrder(order.id, {
        paymentMethod: editForm.paymentMethod,
        paymentAccountId: isCardPayment(editForm.paymentMethod)
          ? (selectedPaymentCard?.accountId ?? null)
          : null,
        paymentAccountName: isCardPayment(editForm.paymentMethod)
          ? (selectedPaymentCard?.accountName ?? null)
          : null,
        paymentMethodId: isCardPayment(editForm.paymentMethod)
          ? (selectedPaymentCard?.methodId ?? null)
          : null,
        paymentMethodLabel: isCardPayment(editForm.paymentMethod)
          ? (selectedPaymentCard?.methodLabel ?? null)
          : null,
        paymentCondition: editForm.paymentCondition,
        installmentsCount:
          editForm.paymentCondition === "installments"
            ? editForm.installmentsCount
            : undefined,
        installmentDueDates:
          editForm.paymentCondition === "installments"
            ? editForm.installmentDueDates
            : [],
        paymentDueDate:
          editForm.paymentCondition === "installments"
            ? editForm.installmentDueDates[0]
            : editForm.paymentDueDate,
        estimatedReceiptDate:
          order.receiptMode === "future_delivery"
            ? editForm.estimatedReceiptDate
            : undefined,
        deliveryFee: editForm.deliveryFee,
        accountPlanId: editForm.accountPlanId,
        accountPlanName: selectedAccountPlan?.name,
        freightAccountPlanId:
          editForm.deliveryFee > 0 ? editForm.freightAccountPlanId : "",
        freightAccountPlanName:
          editForm.deliveryFee > 0 ? selectedFreightAccountPlan?.name : "",
        freightPaymentMode:
          editForm.deliveryFee > 0 ? editForm.freightPaymentMode : undefined,
        freightSupplierName:
          editForm.deliveryFee > 0 && editForm.freightPaymentMode === "separate"
            ? editForm.freightSupplierName.trim()
            : null,
        resultCenterId: editForm.resultCenterId,
        resultCenterName: selectedResultCenter?.name,
        trackingInfo: editForm.trackingInfo,
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
      setActionPanel(null);
    } finally {
      setConfirming(false);
    }
  };

  const openReversionPanel = () => {
    setReversionError(null);
    setRevertReason(order?.lastStageReversion?.reason ?? "");
    setActionPanel("revert");
  };

  const handleRevertOrderStage = async () => {
    if (!order || revertReason.trim().length < 3) return;
    setReverting(true);
    setReversionError(null);
    try {
      const result = await revertOrderStage(order.id, revertReason);
      if (result.financialSyncPending) {
        setReversionError(
          result.warning ??
            "O pedido voltou para revisão, mas a compensação financeira ainda precisa ser concluída.",
        );
        return;
      }
      setActionPanel(null);
      setRevertReason("");
    } catch (error) {
      setReversionError(
        error instanceof Error
          ? error.message
          : "Falha ao retroceder a etapa do pedido.",
      );
    } finally {
      setReverting(false);
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

  const handleMarkReceivedElsewhere = async () => {
    if (!order) return;
    setMarkingReceivedElsewhere(true);
    try {
      await markReceivedElsewhere(
        order.id,
        receivedElsewhereNotes.trim() || undefined,
      );
      setActionPanel(null);
      setReceivedElsewhereNotes("");
    } finally {
      setMarkingReceivedElsewhere(false);
    }
  };

  if (loading || classificationLoading) {
    return (
      <PurchasingPageFrame>
        <PurchasingModuleNavigation activeTab="orders" activeStage="issued" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2.4fr)_minmax(340px,1fr)]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </PurchasingPageFrame>
    );
  }

  if (!order) {
    return (
      <PurchasingPageFrame>
        <PurchasingModuleNavigation activeTab="orders" activeStage="issued" />
        <p className="text-muted-foreground">Compra não encontrada.</p>
        <BackButton fallbackHref="/dashboard/purchasing/orders" />
      </PurchasingPageFrame>
    );
  }

  return (
    <PermissionGuard allowed={canView}>
      <PurchasingPageFrame>
        <PurchasingModuleNavigation
          activeTab="orders"
          activeStage={
            isReceived
              ? "costs"
              : receipt && receipt.status !== "awaiting_delivery"
                ? "receiving"
                : order.status === "confirmed"
                  ? "to_receive"
                  : "issued"
          }
        />
        <BackButton
          fallbackHref="/dashboard/purchasing/orders"
          label="Pedidos"
          variant="ghost"
          size="sm"
          className="-ml-2 mb-3"
        />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
          <div className="overflow-hidden rounded-[14px] border border-zinc-200 bg-white">
            <div className="border-b border-zinc-100 px-5 py-[18px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-extrabold text-zinc-500">
                  {orderCode(order.id)}
                </span>
                <PurchasingStatusBadge
                  label={
                    isCancelled
                      ? "Cancelada"
                      : isReceived
                        ? "Recebida"
                        : isCreated
                          ? "Pedido emitido"
                          : "Confirmado"
                  }
                  tone={
                    isCancelled
                      ? "rose"
                      : isReceived
                        ? "green"
                        : isCreated
                          ? "blue"
                          : "purple"
                  }
                />
                <span className="rounded-[6px] bg-zinc-100 px-2 py-1 text-[10px] font-black uppercase tracking-[0.05em] text-zinc-600">
                  {order.origin === "direct" ? "Compra direta" : "Via cotação"}
                </span>
              </div>
              <h1 className="mt-3 text-[25px] font-black leading-tight tracking-[-0.045em] text-zinc-950">
                {supplierDisplayName}
              </h1>
              <p className="mt-1.5 text-[13px] text-zinc-500">
                {order.origin === "direct"
                  ? "Compra direta"
                  : "Compra via cotação"}{" "}
                · criada em{" "}
                {format(parseISO(order.createdAt), "dd/MM/yyyy 'às' HH:mm", {
                  locale: ptBR,
                })}{" "}
                · {RECEIPT_LABELS[order.receiptMode]}
              </p>
              {order.quotationId ||
              order.linkedExpenseId ||
              order.linkedFreightExpenseId ? (
                <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold text-violet-700">
                  {order.quotationId ? (
                    <Link
                      href={`/dashboard/purchasing/quotations/${order.quotationId}`}
                    >
                      Ver cotação de origem
                    </Link>
                  ) : null}
                  {order.linkedExpenseId ? (
                    <Link
                      href={`/dashboard/financial/expenses/new?edit=${order.linkedExpenseId}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`}
                    >
                      Abrir despesa da mercadoria
                    </Link>
                  ) : null}
                  {order.linkedFreightExpenseId ? (
                    <Link
                      href={`/dashboard/financial/expenses/new?edit=${order.linkedFreightExpenseId}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`}
                    >
                      Abrir despesa do frete
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="overflow-x-auto px-5 py-4">
              <div className="flex min-w-[760px]">
                {orderTimeline.map((step, index) => {
                  const done = index < orderProgress;
                  const current = index === orderProgress - 1;
                  return (
                    <div key={step.label} className="min-w-[95px] flex-1">
                      <div className="flex items-center">
                        <span
                          className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[10px] font-black ${done ? (current ? "bg-violet-600 text-white" : "bg-zinc-950 text-white") : "bg-zinc-200 text-zinc-500"}`}
                        >
                          {index + 1}
                        </span>
                        {index < orderTimeline.length - 1 ? (
                          <span
                            className={`h-0.5 flex-1 ${index < orderProgress - 1 ? "bg-zinc-950" : "bg-zinc-200"}`}
                          />
                        ) : null}
                      </div>
                      <p
                        className={`mt-2 pr-2 text-[11.5px] font-extrabold leading-tight ${done ? "text-zinc-950" : "text-zinc-500"}`}
                      >
                        {step.label}
                      </p>
                      <p className="mt-1 text-[10.5px] text-zinc-500">
                        {step.when}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="rounded-[14px] border border-zinc-200 bg-white p-4 xl:sticky xl:top-4">
            <h2 className="mb-3 text-[13px] font-black uppercase tracking-[0.08em] text-zinc-500">
              Ações
            </h2>
            <div className="space-y-2">
              {canEditOrder ? (
                <Button
                  variant="outline"
                  onClick={openEdit}
                  className="w-full justify-between rounded-[9px]"
                >
                  <span>Editar pedido</span>
                  <Pencil className="h-4 w-4" />
                </Button>
              ) : null}
              {canConfirmOrder ? (
                <Button
                  onClick={() => setActionPanel("confirm")}
                  disabled={!isReadyForConfirmation}
                  title={
                    !isReadyForConfirmation
                      ? "Complete os dados obrigatórios antes de confirmar."
                      : undefined
                  }
                  className="w-full justify-between rounded-[9px] bg-violet-600 hover:bg-violet-700"
                >
                  <span>Confirmar pedido</span>
                  <CheckCircle2 className="h-4 w-4" />
                </Button>
              ) : null}
              {canRegisterPayment ? (
                <Button
                  variant="outline"
                  onClick={handleMarkAsPaid}
                  disabled={markingPaid}
                  className="w-full justify-between rounded-[9px]"
                >
                  <span>Registrar pagamento</span>
                  {markingPaid ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CreditCard className="h-4 w-4" />
                  )}
                </Button>
              ) : null}
              {canMarkReceivedElsewhere ? (
                <Button
                  variant="outline"
                  onClick={() => setActionPanel("received-elsewhere")}
                  className="w-full justify-between rounded-[9px]"
                >
                  <span>Recebida em outro lugar</span>
                  <CheckCircle2 className="h-4 w-4" />
                </Button>
              ) : null}
              {canRevertOrder && !isFinancialReversalPending ? (
                <Button
                  variant="outline"
                  onClick={openReversionPanel}
                  className="w-full justify-between rounded-[9px]"
                >
                  <span>Retroceder etapa</span>
                  <RotateCcw className="h-4 w-4" />
                </Button>
              ) : null}
              {!isCancelled &&
              !isReceived &&
              !isFinancialReversalPending &&
              canCancel ? (
                <Button
                  variant="outline"
                  className="w-full justify-between rounded-[9px] border-rose-200 text-rose-700 hover:bg-rose-50"
                  onClick={() => setActionPanel("cancel")}
                >
                  <span>Cancelar pedido</span>
                  <XCircle className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
              Ações sensíveis respeitam o perfil de acesso e ficam registradas
              no histórico do pedido.
            </p>
          </div>
        </div>

        {isFinancialReversalPending ? (
          <div className="mt-4 flex gap-3 rounded-[12px] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-extrabold">
                O pedido voltou para revisão, mas a compensação financeira está
                pendente.
              </p>
              <p className="mt-1">
                {order.financialReversalError ??
                  "Conclua o retrocesso antes de editar ou confirmar novamente."}
              </p>
            </div>
          </div>
        ) : null}

        {isCreated && !isFinancialReversalPending ? (
          <div className="mt-4 flex gap-3 rounded-[12px] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-extrabold">
                Pedido aguardando conferência final.
              </p>
              <p className="mt-1">
                Revise itens, frete, classificação e pagamento antes de
                confirmar.
              </p>
            </div>
          </div>
        ) : null}

        {isCancelled && order.cancelReason ? (
          <div className="mt-4 rounded-[12px] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Cancelada: {order.cancelReason}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-[14px] border border-zinc-200 bg-white">
              <div className="flex items-center justify-between border-b border-zinc-100 px-[18px] py-3.5">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-black tracking-[-0.02em] text-zinc-950">
                    Itens do pedido
                  </h2>
                </div>
                <div className="flex items-center gap-3">
                  {isCreated && canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingItemId(null);
                        setItemsEditOpen(true);
                      }}
                    >
                      <Pencil className="mr-2 h-3 w-3" />
                      Gerenciar itens
                    </Button>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {items.length} item(ns)
                  </span>
                </div>
              </div>

              {itemsLoading ? (
                <div className="p-5 space-y-3">
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-20 w-full" />
                  ))}
                </div>
              ) : (
                <div className="divide-y divide-zinc-100">
                  {displayItems.map((item) => {
                    const base = baseProducts.find(
                      (bp) => bp.id === item.baseItemId,
                    );
                    const product = products.find(
                      (p) => p.id === item.productId,
                    );
                    const displayName =
                      (product ? getProductFullName(product) : "") ||
                      item.itemName ||
                      base?.name ||
                      item.baseItemId;
                    return (
                      <div key={item.id} className="space-y-2 px-[18px] py-3.5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex min-w-0 items-start gap-3">
                            {product?.imageUrl && (
                              <Image
                                src={product.imageUrl}
                                alt={displayName}
                                width={44}
                                height={44}
                                className="h-11 w-11 shrink-0 rounded-md border object-cover"
                              />
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-[13.5px] font-bold text-zinc-950">
                                {displayName}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {item.quantityOrdered}{" "}
                                {item.purchaseUnitLabel ?? item.unit} x{" "}
                                {fmtUnit(
                                  item.hasLineDiscount
                                    ? item.effectiveUnitPrice
                                    : item.unitPriceOrdered,
                                )}
                                {item.hasLineDiscount ? " líquido" : ""}
                              </p>
                              {item.hasLineDiscount && (
                                <p className="text-xs text-muted-foreground">
                                  Bruto: {item.quantityOrdered}{" "}
                                  {item.purchaseUnitLabel ?? item.unit} x{" "}
                                  {fmtUnit(item.unitPriceOrdered)} ={" "}
                                  {fmt(item.grossTotal)}
                                </p>
                              )}
                              {base && base.name !== displayName && (
                                <p className="text-xs text-muted-foreground">
                                  Insumo base: {base.name}
                                </p>
                              )}
                              {(item.discountOrdered ?? 0) > 0 && (
                                <p className="text-sm text-muted-foreground">
                                  Desconto: {fmt(item.discountOrdered ?? 0)}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-start gap-3">
                            {isCreated && canEdit ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingItemId(item.id);
                                  setItemsEditOpen(true);
                                }}
                              >
                                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                Editar
                              </Button>
                            ) : null}
                            <div className="text-right">
                              <p className="text-sm text-muted-foreground">
                                Subtotal
                              </p>
                              <p className="font-mono text-[13px] font-extrabold">
                                {fmt(item.totalOrdered)}
                              </p>
                            </div>
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
              <div className="flex flex-wrap justify-end gap-9 border-t border-zinc-200 bg-zinc-50 px-[18px] py-3.5">
                <div className="text-right">
                  <p className="text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500">
                    Mercadoria
                  </p>
                  <p className="mt-1 font-mono text-[13.5px] font-extrabold text-zinc-800">
                    {fmt(goodsSubtotal)}
                  </p>
                  {goodsDiscountTotal > 0 ? (
                    <p className="mt-0.5 text-[10.5px] text-zinc-500">
                      desconto {fmt(goodsDiscountTotal)}
                    </p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500">
                    Frete
                  </p>
                  <p className="mt-1 font-mono text-[13.5px] font-extrabold text-zinc-800">
                    {fmt(order.deliveryFee ?? 0)}
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-zinc-500">
                    {order.freightAccountPlanName || "Sem frete"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500">
                    Total do pedido
                  </p>
                  <p className="mt-1 font-mono text-[19px] font-black tracking-[-0.04em] text-zinc-950">
                    {fmt(effectiveOrderTotal)}
                  </p>
                </div>
              </div>
            </div>

            {order.status === "confirmed" && !isReceived && canReceive && (
              <div className="space-y-3 rounded-[14px] border border-dashed border-zinc-300 bg-white p-5 text-center">
                <p className="text-sm text-muted-foreground">
                  {order.receiptMode === "future_delivery"
                    ? "Pedido confirmado. Aguarde a entrega, faça a conferência e depois registre a entrada no estoque."
                    : "Pedido confirmado. A compra retirada pode seguir direto para a entrada no estoque."}
                </p>
                <Button
                  asChild
                  className="rounded-[9px] bg-zinc-950 hover:bg-zinc-800"
                >
                  <Link
                    href={`/dashboard/purchasing/orders/${order.id}/receipt`}
                  >
                    {order.receiptMode === "future_delivery"
                      ? "Abrir recebimento"
                      : "Abrir entrada no estoque"}
                  </Link>
                </Button>
              </div>
            )}

            <div className="rounded-[14px] border border-zinc-200 bg-white p-[18px]">
              <h2 className="mb-3 text-sm font-black tracking-[-0.02em] text-zinc-950">
                Histórico
              </h2>
              <div>
                {[
                  order.lastStageReversion
                    ? {
                        title: "Etapa do pedido retrocedida",
                        meta: `${format(parseISO(order.lastStageReversion.at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })} · ${order.lastStageReversion.reason}`,
                        dot: "bg-amber-500",
                      }
                    : null,
                  order.confirmedAt
                    ? {
                        title: "Pedido confirmado com o fornecedor",
                        meta: format(
                          parseISO(order.confirmedAt),
                          "dd/MM/yyyy 'às' HH:mm",
                          { locale: ptBR },
                        ),
                        dot: "bg-violet-600",
                      }
                    : null,
                  financial
                    ? {
                        title: `Financeiro ${FINANCIAL_STATUS_LABELS[financial.status].toLowerCase()} — ${fmt(financial.amountEstimated)}`,
                        meta: `${format(parseISO(financial.createdAt), "dd/MM/yyyy")} · ${PAYMENT_LABELS[financial.paymentMethod]}`,
                        dot: "bg-emerald-500",
                      }
                    : null,
                  {
                    title:
                      order.origin === "quotation"
                        ? "Pedido gerado a partir da cotação"
                        : "Pedido criado como compra direta",
                    meta: format(
                      parseISO(order.createdAt),
                      "dd/MM/yyyy 'às' HH:mm",
                      { locale: ptBR },
                    ),
                    dot: "bg-blue-600",
                  },
                ]
                  .filter(Boolean)
                  .map((event, index) =>
                    event ? (
                      <div
                        key={`${event.title}-${index}`}
                        className="grid grid-cols-[16px_1fr] gap-3"
                      >
                        <div className="flex flex-col items-center">
                          <span
                            className={`mt-1.5 h-2.5 w-2.5 rounded-full ${event.dot}`}
                          />
                          {index < 3 ? (
                            <span className="w-0.5 flex-1 bg-zinc-100" />
                          ) : null}
                        </div>
                        <div className="pb-3.5">
                          <p className="text-[13px] font-bold text-zinc-950">
                            {event.title}
                          </p>
                          <p className="mt-0.5 text-[11.5px] text-zinc-500">
                            {event.meta}
                          </p>
                        </div>
                      </div>
                    ) : null,
                  )}
              </div>
            </div>
          </div>

          <div className="space-y-3 xl:sticky xl:top-4">
            <div className="space-y-4 rounded-[14px] border border-zinc-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <ReceiptText className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-[13px] font-black uppercase tracking-[0.02em] text-zinc-800">
                  Resumo financeiro
                </h3>
              </div>

              <div className="space-y-3">
                <DetailSummaryRow label="Condição">
                  {PAYMENT_CONDITION_LABELS[order.paymentCondition ?? "cash"]}
                  {order.paymentCondition === "installments" &&
                  order.installmentsCount
                    ? ` · ${order.installmentsCount}x`
                    : ""}
                </DetailSummaryRow>
                <DetailSummaryRow label="Forma de pagamento">
                  {PAYMENT_LABELS[order.paymentMethod]}
                </DetailSummaryRow>
                {isCardPayment(order.paymentMethod) && (
                  <DetailSummaryRow label="Cartão da compra">
                    {order.paymentMethodLabel ||
                      order.paymentAccountName ||
                      "Não vinculado"}
                  </DetailSummaryRow>
                )}
                {order.paymentCondition === "installments" ? (
                  <div className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-3">
                    <span className="text-[11.5px] leading-snug text-zinc-500">
                      Vencimentos
                    </span>
                    <div className="space-y-1 text-right text-[12.5px] font-bold leading-snug text-zinc-900">
                      {(order.installmentDueDates?.length
                        ? order.installmentDueDates
                        : buildMonthlyInstallmentDates(
                            order.paymentDueDate,
                            order.installmentsCount ?? 2,
                          )
                      ).map((date, index) => (
                        <p key={`${date}-${index}`}>
                          {index + 1}ª · {format(parseISO(date), "dd/MM/yyyy")}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : (
                  <DetailSummaryRow
                    label={getPaymentDateLabel(order.paymentMethod)}
                  >
                    {format(parseISO(order.paymentDueDate), "dd/MM/yyyy")}
                  </DetailSummaryRow>
                )}
                <DetailSummaryRow label="Valor previsto">
                  {fmt(effectiveOrderTotal)}
                </DetailSummaryRow>
                {(order.deliveryFee ?? 0) > 0 && (
                  <DetailSummaryRow label="Liquidação do frete">
                    {
                      FREIGHT_PAYMENT_MODE_LABELS[
                        order.freightPaymentMode ?? "separate"
                      ]
                    }
                  </DetailSummaryRow>
                )}
                <DetailSummaryRow label="Valor confirmado">
                  {financial?.amountConfirmed != null
                    ? fmt(financial.amountConfirmed)
                    : "Aguardando recebimento"}
                </DetailSummaryRow>
                {financial?.paidAt && (
                  <DetailSummaryRow label="Pago em">
                    {format(
                      parseISO(financial.paidAt),
                      "dd/MM/yyyy 'às' HH:mm",
                      { locale: ptBR },
                    )}
                  </DetailSummaryRow>
                )}
              </div>
            </div>

            <div className="space-y-4 rounded-[14px] border border-zinc-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Scale className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-[13px] font-black uppercase tracking-[0.02em] text-zinc-800">
                    Classificação
                  </h3>
                </div>
                {isCreated && canEditOrder && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-my-1 h-7 px-2 text-xs"
                    onClick={openEdit}
                  >
                    <Pencil className="mr-1.5 h-3 w-3" />
                    Definir
                  </Button>
                )}
              </div>

              <div className="space-y-3.5 text-[12.5px] leading-snug">
                <div>
                  <p className="mb-1 text-[11.5px] text-zinc-500">
                    Plano de contas da mercadoria
                  </p>
                  {order.accountPlanName ? (
                    <p className="font-medium">{order.accountPlanName}</p>
                  ) : (
                    <p className={MISSING_VALUE_CLASS}>
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Não definido
                    </p>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-[11.5px] text-zinc-500">
                    Centro de resultado
                  </p>
                  {order.resultCenterName ? (
                    <p className="font-medium">{order.resultCenterName}</p>
                  ) : (
                    <p className={MISSING_VALUE_CLASS}>
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Não definido
                    </p>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-[11.5px] text-zinc-500">
                    Plano de contas do frete
                  </p>
                  {(order.deliveryFee ?? 0) > 0 ? (
                    order.freightAccountPlanName ? (
                      <p className="font-medium">
                        {order.freightAccountPlanName}
                      </p>
                    ) : (
                      <p className={MISSING_VALUE_CLASS}>
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Não definida
                      </p>
                    )
                  ) : (
                    <p className="font-medium">Sem frete</p>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-[11.5px] text-zinc-500">
                    Liquidação do frete
                  </p>
                  <p className="font-medium">
                    {(order.deliveryFee ?? 0) > 0
                      ? FREIGHT_PAYMENT_MODE_LABELS[
                          order.freightPaymentMode ?? "separate"
                        ]
                      : "Sem frete"}
                  </p>
                </div>
                {(order.deliveryFee ?? 0) > 0 &&
                  order.freightPaymentMode === "separate" && (
                    <div>
                      <p className="mb-1 text-[11.5px] text-zinc-500">
                        Favorecido do frete
                      </p>
                      {order.freightSupplierName ? (
                        <p className="font-medium">
                          {order.freightSupplierName}
                        </p>
                      ) : (
                        <p className={MISSING_VALUE_CLASS}>
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Não definido
                        </p>
                      )}
                    </div>
                  )}
              </div>
            </div>

            <div className="space-y-4 rounded-[14px] border border-zinc-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-[13px] font-black uppercase tracking-[0.02em] text-zinc-800">
                  Recebimento
                </h3>
              </div>

              <div className="space-y-3">
                <DetailSummaryRow label="Tipo">
                  {RECEIPT_LABELS[order.receiptMode]}
                </DetailSummaryRow>
                <DetailSummaryRow label="Entrega prevista">
                  {format(parseISO(order.estimatedReceiptDate), "dd/MM/yyyy")}
                </DetailSummaryRow>
                {order.trackingInfo && (
                  <div className="space-y-1.5 border-t border-zinc-100 pt-3">
                    <span className="text-[11.5px] text-zinc-500">
                      Rastreio
                    </span>
                    <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-zinc-800">
                      {order.trackingInfo}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {order.notes && (
              <div className="space-y-2 rounded-[14px] border border-zinc-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-[13px] font-black uppercase tracking-[0.02em] text-zinc-800">
                    Observações
                  </h3>
                </div>
                <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-zinc-600">
                  {order.notes}
                </p>
              </div>
            )}
          </div>
        </div>

        <Sheet
          open={actionPanel !== null}
          onOpenChange={(open) => {
            if (
              !open &&
              !confirming &&
              !reverting &&
              !markingReceivedElsewhere &&
              !cancelling
            ) {
              setActionPanel(null);
              setReversionError(null);
            }
          }}
        >
          <SheetContent
            side="right"
            className="font-purchasing flex h-full !w-full flex-col gap-0 overflow-hidden p-0 sm:!max-w-[520px]"
          >
            {actionPanel === "confirm" && (
              <>
                <SheetHeader className="shrink-0 border-b border-violet-200 bg-violet-50/80 px-6 py-5 pr-12 text-left">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
                      <CheckCircle2 className="h-4 w-4" />
                    </span>
                    <div>
                      <SheetTitle className="text-[19px] font-black tracking-[-0.035em] text-zinc-950">
                        Confirmar pedido com o fornecedor
                      </SheetTitle>
                      <SheetDescription className="mt-1 text-xs leading-relaxed text-zinc-600">
                        Confira o que foi combinado antes de avançar o pedido.
                      </SheetDescription>
                    </div>
                  </div>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto bg-[#f6f6f7] px-5 py-5 sm:px-6">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ActionSummaryItem
                      label="Fornecedor"
                      value={supplierDisplayName}
                      className="sm:col-span-2"
                    />
                    <ActionSummaryItem
                      label="Total do pedido"
                      value={fmt(effectiveOrderTotal)}
                    />
                    <ActionSummaryItem
                      label="Pagamento"
                      value={`${PAYMENT_LABELS[order.paymentMethod]} · ${PAYMENT_CONDITION_LABELS[order.paymentCondition ?? "cash"]}${order.paymentCondition === "installments" && order.installmentsCount ? ` em ${order.installmentsCount}x` : ""}`}
                    />
                    <ActionSummaryItem
                      label={
                        order.paymentCondition === "installments"
                          ? "Primeiro vencimento"
                          : getPaymentDateLabel(order.paymentMethod)
                      }
                      value={format(
                        parseISO(order.paymentDueDate),
                        "dd/MM/yyyy",
                      )}
                    />
                    <ActionSummaryItem
                      label="Entrega prevista"
                      value={
                        order.receiptMode === "future_delivery"
                          ? format(
                              parseISO(order.estimatedReceiptDate),
                              "dd/MM/yyyy",
                            )
                          : "Retirada imediata"
                      }
                    />
                  </div>

                  <div className="mt-4 space-y-3 rounded-[14px] border border-zinc-200 bg-white p-4 shadow-[0_1px_2px_rgba(24,24,27,0.03)]">
                    <ActionEffect number="1">
                      Cria o recebimento pendente com todos os itens do pedido.
                    </ActionEffect>
                    <ActionEffect number="2">
                      Registra o previsto financeiro e sincroniza a despesa
                      vinculada.
                    </ActionEffect>
                    <ActionEffect number="3">
                      Os itens deixam de ser editáveis; ajustes financeiros
                      continuam disponíveis até o recebimento.
                    </ActionEffect>
                  </div>
                </div>

                <SheetFooter className="shrink-0 border-t border-zinc-200 bg-white px-6 py-4 shadow-[0_-10px_30px_rgba(24,24,27,0.04)] sm:items-center">
                  <Button
                    className="rounded-[9px]"
                    variant="outline"
                    onClick={() => setActionPanel(null)}
                    disabled={confirming}
                  >
                    Voltar
                  </Button>
                  <Button
                    className="rounded-[9px] bg-violet-600 hover:bg-violet-700"
                    onClick={handleConfirmOrder}
                    disabled={confirming}
                  >
                    {confirming ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Confirmar pedido
                  </Button>
                </SheetFooter>
              </>
            )}

            {actionPanel === "revert" && (
              <>
                <SheetHeader className="shrink-0 border-b border-orange-200 bg-orange-50/80 px-6 py-5 pr-12 text-left">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-600 text-white shadow-sm">
                      <RotateCcw className="h-4 w-4" />
                    </span>
                    <div>
                      <SheetTitle className="text-[19px] font-black tracking-[-0.035em] text-zinc-950">
                        {isFinancialReversalPending
                          ? "Concluir retrocesso do pedido"
                          : "Retroceder pedido para revisão"}
                      </SheetTitle>
                      <SheetDescription className="mt-1 text-xs leading-relaxed text-zinc-600">
                        {isFinancialReversalPending
                          ? "A etapa operacional já voltou; falta concluir a compensação financeira."
                          : "Esta ação devolve o pedido confirmado para a etapa anterior."}
                      </SheetDescription>
                    </div>
                  </div>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto bg-[#f6f6f7] px-5 py-5 sm:px-6">
                  <div className="rounded-[14px] border border-orange-200 bg-orange-50 p-4 text-sm leading-relaxed text-orange-950 shadow-sm">
                    O retrocesso só é permitido antes do início da conferência,
                    da entrada no estoque e do pagamento. A ação fica registrada
                    com usuário, data e motivo.
                  </div>

                  <div className="mt-4 space-y-3 rounded-[14px] border border-zinc-200 bg-white p-4 shadow-[0_1px_2px_rgba(24,24,27,0.03)]">
                    <ActionEffect number="1">
                      O pedido volta para “Em revisão” e os itens ficam
                      editáveis novamente.
                    </ActionEffect>
                    <ActionEffect number="2">
                      O recebimento pendente e sua tarefa de acompanhamento são
                      cancelados.
                    </ActionEffect>
                    <ActionEffect number="3">
                      A previsão financeira e as despesas vinculadas à
                      confirmação são compensadas.
                    </ActionEffect>
                  </div>

                  <div className="mt-4 space-y-3 rounded-[14px] border border-zinc-200 bg-white p-4 shadow-[0_1px_2px_rgba(24,24,27,0.03)]">
                    <Label className="text-[12px] font-bold text-zinc-700">
                      Motivos frequentes
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {REVERSION_REASON_SUGGESTIONS.map((reason) => (
                        <Button
                          key={reason}
                          type="button"
                          variant="outline"
                          size="sm"
                          className={cn(
                            "h-auto rounded-[9px] whitespace-normal py-2 text-left",
                            revertReason === reason &&
                              "border-orange-500 bg-orange-50 text-orange-950",
                          )}
                          onClick={() => setRevertReason(reason)}
                        >
                          {reason}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 space-y-2 rounded-[14px] border border-zinc-200 bg-white p-4 shadow-[0_1px_2px_rgba(24,24,27,0.03)]">
                    <Label
                      className="text-[12px] font-bold text-zinc-700"
                      htmlFor="purchase-revert-reason"
                    >
                      Motivo do retrocesso
                    </Label>
                    <Textarea
                      id="purchase-revert-reason"
                      rows={4}
                      maxLength={500}
                      className="min-h-28 rounded-[9px] border-zinc-200 bg-zinc-50 shadow-none"
                      placeholder="Informe por que o pedido precisa voltar para revisão..."
                      value={revertReason}
                      onChange={(event) => setRevertReason(event.target.value)}
                    />
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span
                        className={
                          revertReason.trim().length < 3
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }
                      >
                        {revertReason.trim().length < 3
                          ? "Informe pelo menos 3 caracteres."
                          : "O motivo ficará no histórico do pedido."}
                      </span>
                      <span className="text-muted-foreground">
                        {revertReason.length}/500
                      </span>
                    </div>
                  </div>

                  {reversionError && (
                    <div
                      role="alert"
                      className="mt-4 rounded-[14px] border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
                    >
                      {reversionError}
                    </div>
                  )}
                </div>

                <SheetFooter className="shrink-0 border-t border-zinc-200 bg-white px-6 py-4 shadow-[0_-10px_30px_rgba(24,24,27,0.04)] sm:items-center">
                  <Button
                    className="rounded-[9px]"
                    variant="outline"
                    onClick={() => setActionPanel(null)}
                    disabled={reverting}
                  >
                    Voltar
                  </Button>
                  <Button
                    className="rounded-[9px] bg-orange-600 text-white hover:bg-orange-700"
                    onClick={handleRevertOrderStage}
                    disabled={reverting || revertReason.trim().length < 3}
                  >
                    {reverting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="mr-2 h-4 w-4" />
                    )}
                    {isFinancialReversalPending
                      ? "Concluir retrocesso"
                      : "Retroceder para revisão"}
                  </Button>
                </SheetFooter>
              </>
            )}

            {actionPanel === "received-elsewhere" && (
              <>
                <SheetHeader className="shrink-0 border-b border-amber-200 bg-amber-50/80 px-6 py-5 pr-12 text-left">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-600 text-white shadow-sm">
                      <Truck className="h-4 w-4" />
                    </span>
                    <div>
                      <SheetTitle className="text-[19px] font-black tracking-[-0.035em] text-zinc-950">
                        Recebida em outro lugar
                      </SheetTitle>
                      <SheetDescription className="mt-1 text-xs leading-relaxed text-zinc-600">
                        Use quando a entrada já foi registrada fora deste
                        recebimento.
                      </SheetDescription>
                    </div>
                  </div>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto bg-[#f6f6f7] px-5 py-5 sm:px-6">
                  <div className="rounded-[14px] border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950 shadow-sm">
                    O pedido será encerrado sem criar lote, patrimônio ou
                    movimentação de estoque por este fluxo. O financeiro será
                    confirmado pelo valor do pedido.
                  </div>

                  <div className="mt-4 space-y-3 rounded-[14px] border border-zinc-200 bg-white p-4 shadow-[0_1px_2px_rgba(24,24,27,0.03)]">
                    <Label className="text-[12px] font-bold text-zinc-700">
                      Onde a entrada foi registrada?
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {RECEIVED_ELSEWHERE_NOTE_SUGGESTIONS.map((note) => (
                        <Button
                          key={note}
                          type="button"
                          variant="outline"
                          size="sm"
                          className={cn(
                            "h-auto rounded-[9px] whitespace-normal py-2 text-left",
                            receivedElsewhereNotes === note &&
                              "border-amber-500 bg-amber-50 text-amber-900",
                          )}
                          onClick={() => setReceivedElsewhereNotes(note)}
                        >
                          {note}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 space-y-2 rounded-[14px] border border-zinc-200 bg-white p-4 shadow-[0_1px_2px_rgba(24,24,27,0.03)]">
                    <Label
                      className="text-[12px] font-bold text-zinc-700"
                      htmlFor="received-elsewhere-notes"
                    >
                      Observação
                    </Label>
                    <Textarea
                      id="received-elsewhere-notes"
                      rows={4}
                      className="min-h-28 rounded-[9px] border-zinc-200 bg-zinc-50 shadow-none"
                      placeholder="Descreva onde ou como a entrada foi registrada..."
                      value={receivedElsewhereNotes}
                      onChange={(event) =>
                        setReceivedElsewhereNotes(event.target.value)
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Opcional, mas recomendado para manter a rastreabilidade.
                    </p>
                  </div>
                </div>

                <SheetFooter className="shrink-0 border-t border-zinc-200 bg-white px-6 py-4 shadow-[0_-10px_30px_rgba(24,24,27,0.04)] sm:items-center">
                  <Button
                    className="rounded-[9px]"
                    variant="outline"
                    onClick={() => setActionPanel(null)}
                    disabled={markingReceivedElsewhere}
                  >
                    Voltar
                  </Button>
                  <Button
                    className="rounded-[9px] bg-amber-600 hover:bg-amber-700"
                    onClick={handleMarkReceivedElsewhere}
                    disabled={markingReceivedElsewhere}
                  >
                    {markingReceivedElsewhere ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Confirmar baixa
                  </Button>
                </SheetFooter>
              </>
            )}

            {actionPanel === "cancel" && (
              <>
                <SheetHeader className="shrink-0 border-b border-rose-200 bg-rose-50/80 px-6 py-5 pr-12 text-left">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white shadow-sm">
                      <XCircle className="h-4 w-4" />
                    </span>
                    <div>
                      <SheetTitle className="text-[19px] font-black tracking-[-0.035em] text-zinc-950">
                        Cancelar pedido
                      </SheetTitle>
                      <SheetDescription className="mt-1 text-xs leading-relaxed text-zinc-600">
                        Esta ação não pode ser desfeita. Informe o motivo para
                        continuar.
                      </SheetDescription>
                    </div>
                  </div>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto bg-[#f6f6f7] px-5 py-5 sm:px-6">
                  <div className="rounded-[14px] border border-rose-200 bg-rose-50 p-4 text-sm leading-relaxed text-rose-950 shadow-sm">
                    O recebimento pendente e os registros financeiros vinculados
                    serão cancelados. Compras que já geraram entrada no estoque
                    não podem ser canceladas por aqui.
                  </div>

                  <div className="mt-4 space-y-3 rounded-[14px] border border-zinc-200 bg-white p-4 shadow-[0_1px_2px_rgba(24,24,27,0.03)]">
                    <Label className="text-[12px] font-bold text-zinc-700">
                      Motivos frequentes
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {CANCELLATION_REASON_SUGGESTIONS.map((reason) => (
                        <Button
                          key={reason}
                          type="button"
                          variant="outline"
                          size="sm"
                          className={cn(
                            "h-auto rounded-[9px] whitespace-normal py-2 text-left",
                            cancelReason === reason &&
                              "border-rose-500 bg-rose-50 text-rose-900",
                          )}
                          onClick={() => setCancelReason(reason)}
                        >
                          {reason}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 space-y-2 rounded-[14px] border border-zinc-200 bg-white p-4 shadow-[0_1px_2px_rgba(24,24,27,0.03)]">
                    <Label
                      className="text-[12px] font-bold text-zinc-700"
                      htmlFor="purchase-cancel-reason"
                    >
                      Motivo do cancelamento
                    </Label>
                    <Textarea
                      id="purchase-cancel-reason"
                      rows={4}
                      maxLength={500}
                      className="min-h-28 rounded-[9px] border-zinc-200 bg-zinc-50 shadow-none"
                      placeholder="Informe o motivo do cancelamento..."
                      value={cancelReason}
                      onChange={(event) => setCancelReason(event.target.value)}
                    />
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span
                        className={
                          cancelReason.trim().length < 3
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }
                      >
                        {cancelReason.trim().length < 3
                          ? "Informe pelo menos 3 caracteres."
                          : "O motivo ficará registrado no pedido."}
                      </span>
                      <span className="text-muted-foreground">
                        {cancelReason.length}/500
                      </span>
                    </div>
                  </div>
                </div>

                <SheetFooter className="shrink-0 border-t border-zinc-200 bg-white px-6 py-4 shadow-[0_-10px_30px_rgba(24,24,27,0.04)] sm:items-center">
                  <Button
                    className="rounded-[9px]"
                    variant="outline"
                    onClick={() => setActionPanel(null)}
                    disabled={cancelling}
                  >
                    Voltar
                  </Button>
                  <Button
                    className="rounded-[9px]"
                    variant="destructive"
                    onClick={handleCancel}
                    disabled={cancelling || cancelReason.trim().length < 3}
                  >
                    {cancelling ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <XCircle className="mr-2 h-4 w-4" />
                    )}
                    Cancelar pedido
                  </Button>
                </SheetFooter>
              </>
            )}
          </SheetContent>
        </Sheet>

        {editForm && (
          <Sheet open={editOpen} onOpenChange={setEditOpen}>
            <SheetContent
              side="right"
              className="font-purchasing flex h-full !w-full flex-col gap-0 overflow-hidden p-0 sm:!max-w-[720px]"
            >
              <SheetHeader className="shrink-0 border-b border-violet-200 bg-violet-50/80 px-6 py-5 pr-12 text-left">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
                    <Pencil className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <SheetTitle className="text-[19px] font-black tracking-[-0.035em] text-zinc-950">
                      Editar pedido
                    </SheetTitle>
                    <SheetDescription className="mt-1 text-xs leading-relaxed text-zinc-600">
                      {orderCode(order.id)} · Atualize pagamento, classificação,
                      frete e entrega.
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto bg-[#f6f6f7] px-5 py-5 sm:px-6">
                {editPendingFields.length > 0 && (
                  <div className="mb-4 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm">
                    <p className="font-bold">
                      {editPendingFields.length === 1
                        ? "1 campo obrigatório pendente"
                        : `${editPendingFields.length} campos obrigatórios pendentes`}
                    </p>
                    <p className="mt-0.5 text-amber-800">
                      {editPendingFields.join(" · ")}
                    </p>
                  </div>
                )}

                <div className="space-y-4">
                  <EditSectionCard
                    icon={CreditCard}
                    title="Pagamento"
                    description="Forma, condição e vencimento da compra."
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-[12px] font-bold text-zinc-700">
                          Forma de pagamento
                        </Label>
                        <Select
                          value={editForm.paymentMethod}
                          onValueChange={(value) =>
                            setEditForm(
                              (current) =>
                                current && {
                                  ...current,
                                  paymentMethod: value as PaymentMethod,
                                },
                            )
                          }
                        >
                          <SelectTrigger className="h-10 rounded-[9px] border-zinc-200 bg-zinc-50 shadow-none">
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
                        <Label className="text-[12px] font-bold text-zinc-700">
                          Condição de pagamento
                        </Label>
                        <Select
                          value={editForm.paymentCondition}
                          onValueChange={(value) =>
                            setEditForm((current) =>
                              current
                                ? {
                                    ...current,
                                    paymentCondition:
                                      value as PurchasePaymentCondition,
                                    installmentsCount:
                                      value === "installments"
                                        ? Math.max(2, current.installmentsCount)
                                        : current.installmentsCount,
                                    installmentDueDates:
                                      value === "installments" &&
                                      current.installmentDueDates.length < 2
                                        ? buildMonthlyInstallmentDates(
                                            current.paymentDueDate,
                                            Math.max(
                                              2,
                                              current.installmentsCount,
                                            ),
                                          )
                                        : current.installmentDueDates,
                                  }
                                : current,
                            )
                          }
                        >
                          <SelectTrigger className="h-10 rounded-[9px] border-zinc-200 bg-zinc-50 shadow-none">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cash">À vista</SelectItem>
                            <SelectItem value="installments">
                              Parcelado
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {editForm.paymentCondition === "installments" ? (
                        <div className="space-y-1.5">
                          <Label className="text-[12px] font-bold text-zinc-700">
                            Parcelamento
                            <RequiredMark />
                          </Label>
                          <Button
                            type="button"
                            variant="outline"
                            className={cn(
                              "h-10 w-full justify-start rounded-[9px] border-zinc-200 bg-zinc-50 font-normal shadow-none",
                              editForm.installmentDueDates.length < 2 &&
                                PENDING_FIELD_CLASS,
                            )}
                            onClick={() => setInstallmentPlanOpen(true)}
                          >
                            {editForm.installmentDueDates.length >= 2
                              ? `${editForm.installmentDueDates.length}x · ${format(parseISO(editForm.installmentDueDates[0]), "dd/MM/yyyy")} a ${format(parseISO(editForm.installmentDueDates[editForm.installmentDueDates.length - 1]), "dd/MM/yyyy")}`
                              : "Definir parcelas e vencimentos"}
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <Label className="text-[12px] font-bold text-zinc-700">
                            {getPaymentDateLabel(editForm.paymentMethod)}
                            <RequiredMark />
                          </Label>
                          <Input
                            type="date"
                            className={cn(
                              "h-10 rounded-[9px] border-zinc-200 bg-zinc-50 shadow-none",
                              !editForm.paymentDueDate && PENDING_FIELD_CLASS,
                            )}
                            value={editForm.paymentDueDate}
                            onChange={(event) =>
                              setEditForm(
                                (current) =>
                                  current && {
                                    ...current,
                                    paymentDueDate: event.target.value,
                                  },
                              )
                            }
                          />
                        </div>
                      )}

                      {isCardPayment(editForm.paymentMethod) && (
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label className="text-[12px] font-bold text-zinc-700">
                            Cartão da compra
                            <RequiredMark />
                          </Label>
                          <Select
                            value={editForm.paymentCardKey || "__none__"}
                            onValueChange={(value) =>
                              setEditForm(
                                (current) =>
                                  current && {
                                    ...current,
                                    paymentCardKey:
                                      value === "__none__" ? "" : value,
                                  },
                              )
                            }
                          >
                            <SelectTrigger
                              className={cn(
                                "h-10 rounded-[9px] border-zinc-200 bg-zinc-50 shadow-none",
                                !editForm.paymentCardKey && PENDING_FIELD_CLASS,
                              )}
                            >
                              <SelectValue placeholder="Selecione o cartão" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">
                                Sem cartão vinculado
                              </SelectItem>
                              {paymentCards.map((card) => (
                                <SelectItem
                                  key={getPaymentCardKey(
                                    card.accountId,
                                    card.methodId,
                                  )}
                                  value={getPaymentCardKey(
                                    card.accountId,
                                    card.methodId,
                                  )}
                                >
                                  {card.methodLabel}
                                  {card.lastDigits
                                    ? ` final ${card.lastDigits}`
                                    : ""}{" "}
                                  · {card.accountName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </EditSectionCard>

                  <EditSectionCard
                    icon={Scale}
                    title="Classificação financeira"
                    description="Destinos contábeis usados na integração financeira."
                  >
                    <div className="grid gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-[12px] font-bold text-zinc-700">
                          Plano de contas da mercadoria
                          <RequiredMark />
                        </Label>
                        <AccountPlanTreeSelect
                          value={editForm.accountPlanId}
                          onChange={(value) =>
                            setEditForm(
                              (current) =>
                                current && { ...current, accountPlanId: value },
                            )
                          }
                          options={accountPlans}
                          placeholder="Selecione o plano de contas"
                          triggerClassName={cn(
                            "h-10 rounded-[9px] border-zinc-200 bg-zinc-50 shadow-none",
                            !editForm.accountPlanId && PENDING_FIELD_CLASS,
                          )}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-[12px] font-bold text-zinc-700">
                          Centro de resultado
                          <RequiredMark />
                        </Label>
                        <ResultCenterSelect
                          value={editForm.resultCenterId}
                          onChange={(value) =>
                            setEditForm(
                              (current) =>
                                current && {
                                  ...current,
                                  resultCenterId: value,
                                },
                            )
                          }
                          options={resultCenters ?? []}
                          placeholder="Selecione o centro de resultado"
                          triggerClassName={cn(
                            "h-10 rounded-[9px] border-zinc-200 bg-zinc-50 shadow-none",
                            !editForm.resultCenterId && PENDING_FIELD_CLASS,
                          )}
                        />
                      </div>
                    </div>
                  </EditSectionCard>

                  <EditSectionCard
                    icon={Truck}
                    title="Frete"
                    description="Valor, classificação e forma de liquidação da entrega."
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-[12px] font-bold text-zinc-700">
                          Frete / entrega
                        </Label>
                        <CurrencyInput
                          className="h-10 rounded-[9px] border-zinc-200 bg-zinc-50 shadow-none"
                          value={editForm.deliveryFee}
                          onChange={(value) =>
                            setEditForm(
                              (current) =>
                                current && { ...current, deliveryFee: value },
                            )
                          }
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-[12px] font-bold text-zinc-700">
                          Plano de contas do frete
                          {editForm.deliveryFee > 0 && <RequiredMark />}
                        </Label>
                        <AccountPlanTreeSelect
                          value={
                            editForm.deliveryFee > 0
                              ? editForm.freightAccountPlanId
                              : "__none__"
                          }
                          onChange={(value) =>
                            setEditForm((current) =>
                              current
                                ? {
                                    ...current,
                                    freightAccountPlanId:
                                      value === "__none__" ? "" : value,
                                  }
                                : current,
                            )
                          }
                          options={accountPlans}
                          placeholder={
                            editForm.deliveryFee > 0
                              ? "Selecione o plano de contas"
                              : "Sem frete"
                          }
                          noneLabel="Sem frete"
                          allowNone
                          disabled={editForm.deliveryFee <= 0}
                          triggerClassName={cn(
                            "h-10 rounded-[9px] border-zinc-200 bg-zinc-50 shadow-none",
                            editForm.deliveryFee > 0 &&
                              !editForm.freightAccountPlanId &&
                              PENDING_FIELD_CLASS,
                          )}
                        />
                      </div>

                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-[12px] font-bold text-zinc-700">
                          Liquidação do frete
                        </Label>
                        <Select
                          value={
                            editForm.deliveryFee > 0
                              ? editForm.freightPaymentMode
                              : "separate"
                          }
                          onValueChange={(value) =>
                            setEditForm((current) =>
                              current
                                ? {
                                    ...current,
                                    freightPaymentMode:
                                      value as PurchaseFreightPaymentMode,
                                  }
                                : current,
                            )
                          }
                          disabled={editForm.deliveryFee <= 0}
                        >
                          <SelectTrigger className="h-10 rounded-[9px] border-zinc-200 bg-zinc-50 shadow-none">
                            <SelectValue placeholder="Selecione como o frete será quitado" />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(FREIGHT_PAYMENT_MODE_LABELS).map(
                              ([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] leading-relaxed text-zinc-500">
                          Use "junto" quando o pagamento cobrir mercadoria e
                          frete no mesmo lançamento bancário.
                        </p>
                      </div>

                      {editForm.deliveryFee > 0 &&
                        editForm.freightPaymentMode === "separate" && (
                          <div className="space-y-1.5 sm:col-span-2">
                            <Label className="text-[12px] font-bold text-zinc-700">
                              Favorecido do frete
                            </Label>
                            <Input
                              value={editForm.freightSupplierName}
                              onChange={(event) =>
                                setEditForm(
                                  (current) =>
                                    current && {
                                      ...current,
                                      freightSupplierName: event.target.value,
                                    },
                                )
                              }
                              placeholder="Ex.: transportadora ou motorista"
                              className={cn(
                                "h-10 rounded-[9px] border-zinc-200 bg-zinc-50 shadow-none",
                                editForm.freightSupplierName.trim().length <
                                  2 && PENDING_FIELD_CLASS,
                              )}
                            />
                            <p className="text-[11px] leading-relaxed text-zinc-500">
                              O financeiro criará uma despesa própria para o
                              frete, vinculada à despesa da mercadoria.
                            </p>
                          </div>
                        )}
                    </div>
                  </EditSectionCard>

                  <EditSectionCard
                    icon={ReceiptText}
                    title="Entrega e rastreio"
                    description="Previsão e referências para acompanhar o recebimento."
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      {order.receiptMode === "future_delivery" && (
                        <div className="space-y-1.5">
                          <Label className="text-[12px] font-bold text-zinc-700">
                            Entrega prevista
                          </Label>
                          <Input
                            type="date"
                            className="h-10 rounded-[9px] border-zinc-200 bg-zinc-50 shadow-none"
                            value={editForm.estimatedReceiptDate}
                            onChange={(event) =>
                              setEditForm(
                                (current) =>
                                  current && {
                                    ...current,
                                    estimatedReceiptDate: event.target.value,
                                  },
                              )
                            }
                          />
                        </div>
                      )}

                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-[12px] font-bold text-zinc-700">
                          Informações de rastreio
                        </Label>
                        <Textarea
                          className="min-h-24 rounded-[9px] border-zinc-200 bg-zinc-50 shadow-none"
                          rows={3}
                          placeholder="Código, transportadora, prazo ou link de acompanhamento..."
                          value={editForm.trackingInfo}
                          onChange={(event) =>
                            setEditForm(
                              (current) =>
                                current && {
                                  ...current,
                                  trackingInfo: event.target.value,
                                },
                            )
                          }
                        />
                      </div>
                    </div>
                  </EditSectionCard>

                  <EditSectionCard
                    icon={Building2}
                    title="Observações"
                    description="Contexto adicional que ficará registrado no pedido."
                  >
                    <Textarea
                      className="min-h-28 rounded-[9px] border-zinc-200 bg-zinc-50 shadow-none"
                      rows={4}
                      placeholder="Observações sobre a compra..."
                      value={editForm.notes}
                      onChange={(event) =>
                        setEditForm(
                          (current) =>
                            current && {
                              ...current,
                              notes: event.target.value,
                            },
                        )
                      }
                    />
                  </EditSectionCard>
                </div>
              </div>

              <SheetFooter className="shrink-0 border-t border-zinc-200 bg-white px-6 py-4 shadow-[0_-10px_30px_rgba(24,24,27,0.04)] sm:items-center">
                {editPendingFields.length > 0 && (
                  <p className="text-xs text-muted-foreground sm:mr-auto">
                    Preencha os campos obrigatórios (
                    <span className="text-destructive">*</span>) para salvar.
                  </p>
                )}
                <Button
                  className="rounded-[9px]"
                  variant="outline"
                  onClick={() => setEditOpen(false)}
                  disabled={saving}
                >
                  Cancelar
                </Button>
                <Button
                  className="rounded-[9px] bg-violet-600 hover:bg-violet-700"
                  onClick={handleSave}
                  disabled={saving || editPendingFields.length > 0}
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        )}

        {editForm && (
          <InstallmentPlanDialog
            open={installmentPlanOpen}
            onOpenChange={setInstallmentPlanOpen}
            dueDates={editForm.installmentDueDates}
            fallbackStartDate={editForm.paymentDueDate}
            onSave={(dueDates) =>
              setEditForm((current) =>
                current
                  ? {
                      ...current,
                      installmentsCount: dueDates.length,
                      installmentDueDates: dueDates,
                      paymentDueDate: dueDates[0],
                    }
                  : current,
              )
            }
          />
        )}

        <ManageOrderItemsModal
          orderId={params.orderId}
          initialItems={items}
          initialItemId={editingItemId}
          deliveryFee={order?.deliveryFee ?? 0}
          open={itemsEditOpen}
          onOpenChange={(nextOpen) => {
            setItemsEditOpen(nextOpen);
            if (!nextOpen) setEditingItemId(null);
          }}
          onSuccess={() => {
            fetchOrderItems(params.orderId).then(setItems);
          }}
        />
      </PurchasingPageFrame>
    </PermissionGuard>
  );
}

function DetailSummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-3">
      <span className="text-[11.5px] leading-snug text-zinc-500">{label}</span>
      <span className="break-words text-right text-[12.5px] font-bold leading-snug text-zinc-900">
        {children}
      </span>
    </div>
  );
}

function EditSectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-zinc-200 bg-white p-4 shadow-[0_1px_2px_rgba(24,24,27,0.03)] sm:p-5">
      <div className="mb-4 flex items-start gap-3 border-b border-zinc-100 pb-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-violet-100 text-violet-700">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-[12px] font-black uppercase tracking-[0.08em] text-zinc-900">
            {title}
          </h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            {description}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

function ActionSummaryItem({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[14px] border border-zinc-200 bg-white p-3 shadow-[0_1px_2px_rgba(24,24,27,0.03)]",
        className,
      )}
    >
      <p className="text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-black text-zinc-900">{value}</p>
    </div>
  );
}

function ActionEffect({
  number,
  children,
}: {
  number: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-violet-100 text-[10px] font-bold text-violet-700 dark:bg-violet-900/60 dark:text-violet-300">
        {number}
      </span>
      <p className="text-sm leading-5 text-zinc-600">{children}</p>
    </div>
  );
}
